-- Durable, phase-based AI generation for Vercel Queues.
-- Each model call is leased independently and every phase is idempotent.

alter table public.ai_generation_jobs
  add column if not exists phase text,
  add column if not exists phase_attempt_count integer not null default 0,
  add column if not exists generation_payload jsonb;

update public.ai_generation_jobs
set phase = case when status = 'completed' then 'completed' else 'generation' end
where phase is null;

alter table public.ai_generation_jobs
  alter column phase set default 'submission',
  alter column phase set not null,
  alter column max_attempts set default 15;

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_max_attempts_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_max_attempts_check
  check (max_attempts between 1 and 30);

update public.ai_generation_jobs set max_attempts = 15 where max_attempts < 15;

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_phase_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_phase_check
  check (phase in ('submission', 'generation', 'review', 'repair', 'save', 'completed'));

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_phase_attempt_count_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_phase_attempt_count_check
  check (phase_attempt_count >= 0);

create index if not exists ai_generation_jobs_phase_ready_idx
  on public.ai_generation_jobs(phase, status, next_attempt_at, created_at);

create or replace function public.claim_ai_generation_phase(
  p_job_id uuid,
  p_owner_id uuid,
  p_phase text,
  p_worker_token uuid,
  p_lease_seconds integer default 300
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.ai_generation_jobs%rowtype;
begin
  if p_phase not in ('submission', 'generation', 'review', 'repair', 'save') then
    raise exception 'Invalid generation phase';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'Invalid lease'; end if;

  update public.ai_generation_jobs set
    status = 'processing',
    worker_token = p_worker_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1,
    phase_attempt_count = phase_attempt_count + 1,
    error = null,
    updated_at = now()
  where id = p_job_id
    and owner_id = p_owner_id
    and phase = p_phase
    and attempt_count < max_attempts
    and phase_attempt_count < 3
    and (
      (status in ('queued', 'failed') and next_attempt_at <= now())
      or (status = 'processing' and lease_expires_at < now())
    )
  returning * into v_job;

  return coalesce(to_jsonb(v_job), '{}'::jsonb);
end;
$$;

create or replace function public.advance_ai_generation_phase(
  p_job_id uuid,
  p_worker_token uuid,
  p_next_phase text,
  p_generation_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.ai_generation_jobs%rowtype;
begin
  if p_next_phase not in ('generation', 'review', 'repair', 'save') then
    raise exception 'Invalid next generation phase';
  end if;

  update public.ai_generation_jobs set
    status = 'queued',
    phase = p_next_phase,
    phase_attempt_count = 0,
    generation_payload = coalesce(p_generation_payload, generation_payload),
    worker_token = null,
    lease_expires_at = null,
    next_attempt_at = now(),
    error = null,
    updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing'
  returning * into v_job;

  if not found then raise exception 'Generation lease is no longer valid'; end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.fail_ai_generation_phase(
  p_job_id uuid,
  p_worker_token uuid,
  p_error text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.ai_generation_jobs%rowtype;
begin
  update public.ai_generation_jobs set
    status = case when phase_attempt_count >= 3 or attempt_count >= max_attempts then 'failed' else 'queued' end,
    worker_token = null,
    lease_expires_at = null,
    next_attempt_at = now() + make_interval(secs => least(120, greatest(5, phase_attempt_count * phase_attempt_count * 5))),
    error = left(coalesce(p_error, 'Generation phase failed'), 4000),
    updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing'
  returning * into v_job;

  if not found then raise exception 'Generation lease is no longer valid'; end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.complete_ai_generation_job(p_job_id uuid, p_worker_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_generation_jobs set
    status = 'completed',
    phase = 'completed',
    generation_payload = null,
    worker_token = null,
    lease_expires_at = null,
    error = null,
    completed_at = now(),
    updated_at = now()
  where id = p_job_id and worker_token = p_worker_token and status = 'processing';
  if not found then raise exception 'Generation lease is no longer valid'; end if;
end;
$$;

revoke all on function public.claim_ai_generation_phase(uuid, uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.advance_ai_generation_phase(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_ai_generation_phase(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_ai_generation_phase(uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.advance_ai_generation_phase(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_ai_generation_phase(uuid, uuid, text) to service_role;
