-- Distributed quota enforcement, durable AI work, and private source bundles.
-- Additive and safe to apply to existing Dappster projects.

alter table public.dapps
  add column if not exists source_bundle_path text,
  add column if not exists source_bundle_hash text,
  add column if not exists source_bundle_bytes integer check (source_bundle_bytes is null or source_bundle_bytes >= 0),
  add column if not exists source_storage_version smallint check (source_storage_version is null or source_storage_version = 1);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dapp-sources', 'dapp-sources', false, 10485760, array['application/gzip'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.rate_limit_buckets enable row level security;

-- Serialize the same logical bucket across serverless regions.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.rate_limit_buckets%rowtype;
begin
  if p_key is null or length(p_key) < 3 or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select * into v_row from public.rate_limit_buckets where bucket_key = p_key for update;

  if not found or v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    insert into public.rate_limit_buckets(bucket_key, window_started_at, request_count, updated_at)
    values (p_key, v_now, 1, v_now)
    on conflict (bucket_key) do update
      set window_started_at = excluded.window_started_at, request_count = 1, updated_at = excluded.updated_at
    returning * into v_row;
    allowed := true;
  elsif v_row.request_count >= p_limit then
    allowed := false;
  else
    update public.rate_limit_buckets
      set request_count = request_count + 1, updated_at = v_now
      where bucket_key = p_key
      returning * into v_row;
    allowed := true;
  end if;

  remaining := greatest(0, p_limit - v_row.request_count);
  retry_after_seconds := greatest(1, ceil(extract(epoch from
    (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
  return next;
end;
$$;

create table if not exists public.ai_generation_jobs (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  dapp_id uuid not null references public.dapps(id) on delete cascade,
  chain text not null,
  evm_chain_id bigint,
  prompt text not null,
  idempotency_key text unique not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  credits_charged boolean not null default false,
  credits_remaining integer,
  worker_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_generation_jobs_ready_idx
  on public.ai_generation_jobs(status, next_attempt_at, created_at);
create index if not exists ai_generation_jobs_owner_idx
  on public.ai_generation_jobs(owner_id, created_at desc);
alter table public.ai_generation_jobs enable row level security;

drop policy if exists "Owners see their AI generation jobs" on public.ai_generation_jobs;
create policy "Owners see their AI generation jobs" on public.ai_generation_jobs
  for select using (auth.uid() = owner_id);

create or replace function public.create_or_get_ai_generation_job(
  p_owner_id uuid,
  p_dapp_id uuid,
  p_chain text,
  p_evm_chain_id bigint,
  p_prompt text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.ai_generation_jobs%rowtype;
begin
  if p_owner_id is null or p_dapp_id is null or p_idempotency_key is null or length(p_prompt) < 12 then
    raise exception 'Invalid generation job';
  end if;
  if not exists(select 1 from public.dapps where id = p_dapp_id and owner_id = p_owner_id) then
    raise exception 'dApp not found';
  end if;
  insert into public.ai_generation_jobs(owner_id, dapp_id, chain, evm_chain_id, prompt, idempotency_key)
  values (p_owner_id, p_dapp_id, p_chain, p_evm_chain_id, p_prompt, p_idempotency_key)
  on conflict (idempotency_key) do nothing;
  select * into v_job from public.ai_generation_jobs where idempotency_key = p_idempotency_key;
  if v_job.owner_id <> p_owner_id or v_job.dapp_id <> p_dapp_id or v_job.chain <> p_chain or v_job.prompt <> p_prompt then
    raise exception 'Generation idempotency key conflicts with another request';
  end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.claim_ai_generation_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_token uuid,
  p_lease_seconds integer default 300
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.ai_generation_jobs%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'Invalid lease'; end if;
  update public.ai_generation_jobs set
    status = 'processing',
    worker_token = p_worker_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1,
    error = null,
    updated_at = now()
  where id = p_job_id and owner_id = p_owner_id and attempt_count < max_attempts
    and (
      (status in ('queued', 'failed') and next_attempt_at <= now())
      or (status = 'processing' and lease_expires_at < now())
    )
  returning * into v_job;
  return coalesce(to_jsonb(v_job), '{}'::jsonb);
end;
$$;

create or replace function public.mark_ai_generation_job_charged(
  p_job_id uuid,
  p_worker_token uuid,
  p_credits_remaining integer
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_generation_jobs set
    credits_charged = true,
    credits_remaining = p_credits_remaining,
    updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing';
  if not found then raise exception 'Generation lease is no longer valid'; end if;
end;
$$;

create or replace function public.complete_ai_generation_job(p_job_id uuid, p_worker_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_generation_jobs set
    status = 'completed', worker_token = null, lease_expires_at = null,
    error = null, completed_at = now(), updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing';
  if not found then raise exception 'Generation lease is no longer valid'; end if;
end;
$$;

create or replace function public.fail_ai_generation_job(p_job_id uuid, p_worker_token uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_generation_jobs set
    status = case when attempt_count >= max_attempts then 'failed' else 'queued' end,
    worker_token = null,
    lease_expires_at = null,
    next_attempt_at = now() + make_interval(secs => least(60, greatest(2, attempt_count * attempt_count * 2))),
    error = left(coalesce(p_error, 'Generation failed'), 4000),
    updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing';
end;
$$;

revoke all on public.rate_limit_buckets, public.ai_generation_jobs from public, anon, authenticated;
grant all on public.rate_limit_buckets, public.ai_generation_jobs to service_role;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_or_get_ai_generation_job(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.claim_ai_generation_job(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_ai_generation_job_charged(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_ai_generation_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_ai_generation_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.create_or_get_ai_generation_job(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.claim_ai_generation_job(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.mark_ai_generation_job_charged(uuid, uuid, integer) to service_role;
grant execute on function public.complete_ai_generation_job(uuid, uuid) to service_role;
grant execute on function public.fail_ai_generation_job(uuid, uuid, text) to service_role;

create or replace function public.sync_ai_generation_job_owner_on_account_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.account_id is distinct from new.account_id then
    update public.ai_generation_jobs set owner_id = new.account_id where owner_id = old.account_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_ai_generation_job_owner_on_account_link() from public, anon, authenticated;
drop trigger if exists sync_ai_generation_job_owner_on_account_link on public.account_wallets;
create trigger sync_ai_generation_job_owner_on_account_link
after update of account_id on public.account_wallets
for each row execute procedure public.sync_ai_generation_job_owner_on_account_link();
