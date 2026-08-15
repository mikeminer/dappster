create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  wallet_address text unique not null,
  chain text not null check (chain in ('evm', 'solana')),
  username text unique,
  credits integer not null default 0 check (credits >= 0),
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- A Dappster account can be authenticated by multiple independently verified wallets.
-- Credits, projects and subscriptions live on account_id (the canonical profile).
create table if not exists public.account_wallets (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid not null references public.profiles(id) on delete cascade,
  wallet_address text not null,
  chain text not null check (chain in ('evm', 'solana')),
  created_at timestamptz not null default now(),
  unique (chain, wallet_address)
);

insert into public.account_wallets (auth_user_id, account_id, wallet_address, chain)
select id, id, wallet_address, chain from public.profiles
on conflict (auth_user_id) do nothing;

create index if not exists account_wallets_account_idx on public.account_wallets(account_id, created_at);

create table if not exists public.dapps (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  chain text not null check (chain in ('evm', 'solana', 'sui', 'aptos', 'cosmos', 'ton', 'near', 'starknet', 'algorand')),
  contract_code text,
  frontend_code text,
  contract_address text,
  contract_tx_hash text,
  contract_chain_id bigint,
  contract_network text,
  contract_deployed_at timestamptz,
  ipfs_hash text,
  ipfs_url text,
  app_visibility boolean not null default true,
  deploy_status text not null default 'draft' check (deploy_status in ('draft', 'deploying', 'live', 'failed')),
  is_listed boolean not null default false,
  is_featured boolean not null default false,
  tags text[] not null default '{}',
  screenshot_url text,
  audit_status text not null default 'none' check (audit_status in ('none', 'pending', 'completed')),
  source_visibility text not null default 'private' check (source_visibility in ('private', 'free', 'paid')),
  frontend_visibility text not null default 'private' check (frontend_visibility in ('private', 'free', 'paid')),
  audit_visibility text not null default 'private' check (audit_visibility in ('private', 'free', 'paid')),
  deploy_visibility text not null default 'private' check (deploy_visibility in ('private', 'free', 'paid')),
  source_price_usdc numeric(12,2) not null default 5 check (source_price_usdc >= 1),
  frontend_price_usdc numeric(12,2) not null default 5 check (frontend_price_usdc >= 1),
  audit_price_usdc numeric(12,2) not null default 5 check (audit_price_usdc >= 1),
  deploy_price_usdc numeric(12,2) not null default 10 check (deploy_price_usdc >= 1),
  source_dapp_id uuid references public.dapps(id) on delete set null,
  base_payout_address text,
  solana_payout_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles alter column credits set default 0;

alter table public.dapps add column if not exists contract_tx_hash text;
alter table public.dapps add column if not exists contract_chain_id bigint;
alter table public.dapps add column if not exists contract_network text;
alter table public.dapps add column if not exists contract_deployed_at timestamptz;
alter table public.dapps add column if not exists app_visibility boolean not null default true;
alter table public.dapps add column if not exists source_visibility text not null default 'private' check (source_visibility in ('private', 'free', 'paid'));
alter table public.dapps add column if not exists frontend_visibility text not null default 'private' check (frontend_visibility in ('private', 'free', 'paid'));
alter table public.dapps add column if not exists audit_visibility text not null default 'private' check (audit_visibility in ('private', 'free', 'paid'));
alter table public.dapps add column if not exists deploy_visibility text not null default 'private' check (deploy_visibility in ('private', 'free', 'paid'));
alter table public.dapps add column if not exists source_price_usdc numeric(12,2) not null default 5 check (source_price_usdc >= 1);
alter table public.dapps add column if not exists frontend_price_usdc numeric(12,2) not null default 5 check (frontend_price_usdc >= 1);
alter table public.dapps add column if not exists audit_price_usdc numeric(12,2) not null default 5 check (audit_price_usdc >= 1);
alter table public.dapps add column if not exists deploy_price_usdc numeric(12,2) not null default 10 check (deploy_price_usdc >= 1);
alter table public.dapps add column if not exists source_dapp_id uuid references public.dapps(id) on delete set null;
alter table public.dapps add column if not exists base_payout_address text;
alter table public.dapps add column if not exists solana_payout_address text;

create table if not exists public.audits (
  id uuid default gen_random_uuid() primary key,
  dapp_id uuid references public.dapps(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  contract_code text not null,
  chain text not null check (chain in ('evm', 'solana', 'sui', 'aptos', 'cosmos', 'ton', 'near', 'starknet', 'algorand')),
  report jsonb,
  severity_counts jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  credits_used integer not null default 25,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount integer not null,
  type text not null check (type in ('purchase', 'spend', 'bonus')),
  description text,
  payment_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_purchases (
  id uuid default gen_random_uuid() primary key,
  buyer_id uuid references public.profiles(id) on delete cascade not null,
  dapp_id uuid references public.dapps(id) on delete cascade not null,
  asset_type text not null check (asset_type in ('source', 'frontend', 'audit', 'deploy')),
  network text not null check (network in ('base', 'solana')),
  payer_address text not null,
  creator_address text not null,
  amount_usdc numeric(12,2) not null check (amount_usdc > 0),
  creator_amount_usdc numeric(12,2) not null check (creator_amount_usdc >= 0),
  platform_amount_usdc numeric(12,2) not null check (platform_amount_usdc >= 0),
  payment_reference text unique not null,
  created_at timestamptz not null default now(),
  unique (buyer_id, dapp_id, asset_type)
);

create table if not exists public.dapp_releases (
  id uuid default gen_random_uuid() primary key,
  dapp_id uuid references public.dapps(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  publisher_address text not null,
  contract_address text not null,
  contract_chain_id bigint not null check (contract_chain_id = 8453),
  deployment_tx_hash text not null,
  deployment_block bigint not null check (deployment_block >= 0),
  creation_code_hash text not null,
  runtime_code_hash text not null,
  source_hash text not null,
  frontend_cid_hash text not null,
  audit_report_hash text not null,
  manifest_hash text unique not null,
  manifest_cid text not null,
  manifest_url text not null,
  audit_score integer not null check (audit_score between 0 and 100),
  registry_address text not null,
  registry_tx_hash text unique,
  release_id text unique,
  registry_dapp_id text,
  release_version bigint,
  registered_block bigint,
  status text not null default 'prepared' check (status in ('prepared', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists public.solana_deploy_jobs (
  id uuid primary key,
  job_key text unique not null,
  dapp_id uuid references public.dapps(id) on delete cascade not null,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  cluster text not null check (cluster in ('devnet', 'mainnet-beta')),
  wallet_address text not null,
  payer_address text not null,
  source_hash text not null,
  program_id text not null,
  byte_length integer not null check (byte_length > 0),
  rent_lamports bigint not null check (rent_lamports >= 0),
  network_fee_lamports bigint not null check (network_fee_lamports >= 0),
  required_lamports bigint not null check (required_lamports > 0),
  funding_memo text unique not null,
  funding_signature text unique,
  funded_lamports bigint check (funded_lamports is null or funded_lamports >= required_lamports),
  status text not null default 'quoted' check (status in ('quoted', 'funded', 'deploying', 'confirmed', 'failed')),
  worker_token uuid,
  lease_expires_at timestamptz,
  error text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists public.solana_deploy_locks (
  cluster text primary key check (cluster in ('devnet', 'mainnet-beta')),
  job_id uuid references public.solana_deploy_jobs(id) on delete cascade not null,
  worker_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists credit_transactions_payment_id_key on public.credit_transactions(payment_id) where payment_id is not null;
create index if not exists dapps_directory_idx on public.dapps(is_listed, is_featured desc, created_at desc);
create index if not exists dapps_owner_idx on public.dapps(owner_id, updated_at desc);
create index if not exists dapps_dappster_points_idx on public.dapps(owner_id, created_at desc) where is_listed = true and deploy_status = 'live' and contract_address is not null and (ipfs_hash is not null or ipfs_url is not null);
create index if not exists marketplace_purchases_buyer_idx on public.marketplace_purchases(buyer_id, created_at desc);
create index if not exists marketplace_purchases_creator_idx on public.marketplace_purchases(dapp_id, created_at desc);
create index if not exists solana_deploy_jobs_queue_idx on public.solana_deploy_jobs(cluster, status, created_at);
create index if not exists solana_deploy_jobs_owner_idx on public.solana_deploy_jobs(owner_id, updated_at desc);
create index if not exists dapp_releases_dapp_idx on public.dapp_releases(dapp_id, created_at desc);
create index if not exists dapp_releases_owner_idx on public.dapp_releases(owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.account_wallets enable row level security;
alter table public.dapps enable row level security;
alter table public.audits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.marketplace_purchases enable row level security;
alter table public.solana_deploy_jobs enable row level security;
alter table public.solana_deploy_locks enable row level security;
alter table public.dapp_releases enable row level security;

create policy "Users see own profile" on public.profiles for select using (auth.uid() = id);
create policy "Anyone sees listed dapps" on public.dapps for select using (is_listed or auth.uid() = owner_id);
create policy "Users create own dapps" on public.dapps for insert with check (auth.uid() = owner_id);
create policy "Users update own dapps" on public.dapps for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Users delete own dapps" on public.dapps for delete using (auth.uid() = owner_id);
create policy "Users see own audits" on public.audits for select using (auth.uid() = owner_id);
create policy "Users create own audits" on public.audits for insert with check (auth.uid() = owner_id);
create policy "Users see own transactions" on public.credit_transactions for select using (auth.uid() = user_id);
create policy "Buyers see own marketplace purchases" on public.marketplace_purchases for select using (auth.uid() = buyer_id);
create policy "Creators see marketplace purchases" on public.marketplace_purchases for select using (exists(select 1 from public.dapps where dapps.id = marketplace_purchases.dapp_id and dapps.owner_id = auth.uid()));
create policy "Users see own Solana deploy jobs" on public.solana_deploy_jobs for select using (auth.uid() = owner_id);
create policy "Anyone sees confirmed dApp releases" on public.dapp_releases for select using (status = 'confirmed' or auth.uid() = owner_id);

create or replace function public.sync_dapp_release_owner_on_account_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.account_id is distinct from new.account_id then
    update public.dapp_releases set owner_id = new.account_id where owner_id = old.account_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_dapp_release_owner_on_account_link() from public, anon, authenticated;
drop trigger if exists sync_dapp_release_owner_on_account_link on public.account_wallets;
create trigger sync_dapp_release_owner_on_account_link
after update of account_id on public.account_wallets
for each row execute procedure public.sync_dapp_release_owner_on_account_link();

create or replace function public.create_or_get_solana_deploy_job(
  p_id uuid,
  p_job_key text,
  p_dapp_id uuid,
  p_owner_id uuid,
  p_cluster text,
  p_wallet_address text,
  p_payer_address text,
  p_source_hash text,
  p_program_id text,
  p_byte_length integer,
  p_rent_lamports bigint,
  p_network_fee_lamports bigint,
  p_required_lamports bigint,
  p_funding_memo text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.solana_deploy_jobs%rowtype;
begin
  if not exists(select 1 from public.dapps where id = p_dapp_id and owner_id = p_owner_id and chain = 'solana') then
    raise exception 'Solana dApp not found';
  end if;
  insert into public.solana_deploy_jobs (
    id, job_key, dapp_id, owner_id, cluster, wallet_address, payer_address, source_hash,
    program_id, byte_length, rent_lamports, network_fee_lamports, required_lamports, funding_memo
  ) values (
    p_id, p_job_key, p_dapp_id, p_owner_id, p_cluster, p_wallet_address, p_payer_address, p_source_hash,
    p_program_id, p_byte_length, p_rent_lamports, p_network_fee_lamports, p_required_lamports, p_funding_memo
  )
  on conflict (job_key) do update set updated_at = public.solana_deploy_jobs.updated_at
  returning * into v_job;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.fund_and_claim_solana_deploy_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_funding_signature text,
  p_funded_lamports bigint,
  p_worker_token uuid,
  p_lease_seconds integer default 3000
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.solana_deploy_jobs%rowtype;
  v_claimed_cluster text;
begin
  update public.solana_deploy_jobs
    set status = case when attempt_count >= 3 then 'failed' else 'funded' end,
        worker_token = null, lease_expires_at = null,
        error = coalesce(error, 'Previous deployment worker lease expired'), updated_at = now()
    where status = 'deploying' and lease_expires_at <= now();
  delete from public.solana_deploy_locks where lease_expires_at <= now();

  select * into v_job from public.solana_deploy_jobs where id = p_job_id and owner_id = p_owner_id for update;
  if not found then raise exception 'Solana deployment job not found'; end if;
  if v_job.status = 'confirmed' then
    return jsonb_build_object('acquired', false, 'job', to_jsonb(v_job));
  end if;
  if v_job.funding_signature is not null and v_job.funding_signature <> p_funding_signature then
    raise exception 'Deployment job already has a different funding transaction';
  end if;
  if exists(select 1 from public.solana_deploy_jobs where funding_signature = p_funding_signature and id <> p_job_id) then
    raise exception 'Funding transaction already used by another deployment job';
  end if;
  if p_funded_lamports < v_job.required_lamports then raise exception 'Insufficient deployment funding'; end if;

  update public.solana_deploy_jobs
    set funding_signature = p_funding_signature, funded_lamports = p_funded_lamports,
        status = case when status = 'deploying' then status else 'funded' end,
        error = null, updated_at = now()
    where id = p_job_id returning * into v_job;

  if v_job.status = 'deploying' then
    return jsonb_build_object('acquired', false, 'job', to_jsonb(v_job));
  end if;
  if exists (
    select 1 from public.solana_deploy_jobs queued
    where queued.cluster = v_job.cluster and queued.id <> v_job.id
      and queued.status in ('funded', 'deploying')
      and (queued.created_at, queued.id) < (v_job.created_at, v_job.id)
  ) then
    return jsonb_build_object('acquired', false, 'job', to_jsonb(v_job));
  end if;

  insert into public.solana_deploy_locks(cluster, job_id, worker_token, lease_expires_at)
  values (v_job.cluster, v_job.id, p_worker_token, now() + make_interval(secs => greatest(60, p_lease_seconds)))
  on conflict (cluster) do nothing
  returning cluster into v_claimed_cluster;
  if v_claimed_cluster is null then
    return jsonb_build_object('acquired', false, 'job', to_jsonb(v_job));
  end if;

  update public.solana_deploy_jobs
    set status = 'deploying', worker_token = p_worker_token,
        lease_expires_at = now() + make_interval(secs => greatest(60, p_lease_seconds)),
        attempt_count = attempt_count + 1, updated_at = now()
    where id = v_job.id returning * into v_job;
  return jsonb_build_object('acquired', true, 'job', to_jsonb(v_job));
end;
$$;

create or replace function public.claim_next_solana_deploy_job(p_cluster text, p_worker_token uuid, p_lease_seconds integer default 3000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.solana_deploy_jobs%rowtype;
  v_claimed_cluster text;
begin
  update public.solana_deploy_jobs
    set status = case when attempt_count >= 3 then 'failed' else 'funded' end,
        worker_token = null, lease_expires_at = null,
        error = coalesce(error, 'Previous deployment worker lease expired'), updated_at = now()
    where status = 'deploying' and lease_expires_at <= now();
  delete from public.solana_deploy_locks where lease_expires_at <= now();
  if exists(select 1 from public.solana_deploy_locks where cluster = p_cluster) then
    return jsonb_build_object('acquired', false, 'job', null);
  end if;

  select * into v_job from public.solana_deploy_jobs
    where cluster = p_cluster and status = 'funded'
    order by created_at, id for update skip locked limit 1;
  if not found then return jsonb_build_object('acquired', false, 'job', null); end if;

  insert into public.solana_deploy_locks(cluster, job_id, worker_token, lease_expires_at)
  values (p_cluster, v_job.id, p_worker_token, now() + make_interval(secs => greatest(60, p_lease_seconds)))
  on conflict (cluster) do nothing returning cluster into v_claimed_cluster;
  if v_claimed_cluster is null then return jsonb_build_object('acquired', false, 'job', null); end if;

  update public.solana_deploy_jobs set status = 'deploying', worker_token = p_worker_token,
    lease_expires_at = now() + make_interval(secs => greatest(60, p_lease_seconds)),
    attempt_count = attempt_count + 1, updated_at = now()
    where id = v_job.id returning * into v_job;
  return jsonb_build_object('acquired', true, 'job', to_jsonb(v_job));
end;
$$;

create or replace function public.complete_solana_deploy_job(p_job_id uuid, p_worker_token uuid, p_program_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.solana_deploy_jobs%rowtype;
begin
  select * into v_job from public.solana_deploy_jobs where id = p_job_id for update;
  if not found or v_job.worker_token is distinct from p_worker_token then raise exception 'Invalid Solana deployment lease'; end if;
  if v_job.program_id <> p_program_id then raise exception 'Unexpected Solana Program ID'; end if;
  update public.solana_deploy_jobs set status = 'confirmed', worker_token = null, lease_expires_at = null,
    error = null, confirmed_at = now(), updated_at = now() where id = p_job_id returning * into v_job;
  delete from public.solana_deploy_locks where job_id = p_job_id and worker_token = p_worker_token;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.release_solana_deploy_job(p_job_id uuid, p_worker_token uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.solana_deploy_jobs%rowtype;
begin
  select * into v_job from public.solana_deploy_jobs where id = p_job_id for update;
  if not found then raise exception 'Solana deployment job not found'; end if;
  if v_job.worker_token = p_worker_token then
    update public.solana_deploy_jobs set status = case when attempt_count >= 3 then 'failed' else 'funded' end,
      worker_token = null, lease_expires_at = null,
      error = left(p_error, 4000), updated_at = now() where id = p_job_id returning * into v_job;
    delete from public.solana_deploy_locks where job_id = p_job_id and worker_token = p_worker_token;
  end if;
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.create_or_get_solana_deploy_job(uuid, text, uuid, uuid, text, text, text, text, text, integer, bigint, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.fund_and_claim_solana_deploy_job(uuid, uuid, text, bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_next_solana_deploy_job(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_solana_deploy_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_solana_deploy_job(uuid, uuid, text) from public, anon, authenticated;

revoke all on public.profiles, public.dapps, public.audits, public.credit_transactions, public.marketplace_purchases,
  public.solana_deploy_jobs, public.solana_deploy_locks, public.account_wallets, public.dapp_releases from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles to authenticated;
grant select, insert on public.audits to authenticated;
grant select on public.credit_transactions, public.marketplace_purchases, public.solana_deploy_jobs to authenticated;
grant select on public.dapp_releases to anon, authenticated;
grant all on public.profiles, public.dapps, public.audits, public.credit_transactions, public.marketplace_purchases,
  public.solana_deploy_jobs, public.solana_deploy_locks, public.account_wallets, public.dapp_releases to service_role;
grant execute on function public.add_credits(uuid, integer, text, text) to service_role;
grant execute on function public.activate_plan(uuid, text, text, text) to service_role;
grant execute on function public.create_or_get_solana_deploy_job(uuid, text, uuid, uuid, text, text, text, text, text, integer, bigint, bigint, bigint, text) to service_role;
grant execute on function public.fund_and_claim_solana_deploy_job(uuid, uuid, text, bigint, uuid, integer) to service_role;
grant execute on function public.claim_next_solana_deploy_job(text, uuid, integer) to service_role;
grant execute on function public.complete_solana_deploy_job(uuid, uuid, text) to service_role;
grant execute on function public.release_solana_deploy_job(uuid, uuid, text) to service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Never trust raw_user_meta_data for wallet ownership. The browser completes
  -- the profile through bootstrap_web3_identity only after Supabase has verified
  -- the Web3 signature and the backend has matched the immutable identity.
  insert into public.profiles (id, wallet_address, chain) values (new.id, new.id::text, 'evm')
  on conflict (id) do nothing;
  insert into public.account_wallets as wallet (auth_user_id, account_id, wallet_address, chain)
  select new.id, new.id, profile.wallet_address, profile.chain from public.profiles profile where profile.id = new.id
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.bootstrap_web3_identity(
  p_auth_user_id uuid,
  p_wallet_address text,
  p_chain text
)
returns table(account_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_address text;
  v_account_id uuid;
begin
  if p_auth_user_id is null or p_chain not in ('evm', 'solana') then
    raise exception 'Invalid wallet identity';
  end if;

  v_address := btrim(p_wallet_address);
  if p_chain = 'evm' then
    v_address := lower(v_address);
    if v_address !~ '^0x[0-9a-f]{40}$' then raise exception 'Invalid EVM wallet address'; end if;
  elsif v_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    raise exception 'Invalid Solana wallet address';
  end if;

  insert into public.profiles (id, wallet_address, chain)
  values (p_auth_user_id, v_address, p_chain)
  on conflict (id) do update set wallet_address = excluded.wallet_address, chain = excluded.chain;

  insert into public.account_wallets as wallet (auth_user_id, account_id, wallet_address, chain)
  values (p_auth_user_id, p_auth_user_id, v_address, p_chain)
  on conflict (auth_user_id) do update
    set wallet_address = excluded.wallet_address, chain = excluded.chain
  returning wallet.account_id into v_account_id;

  return query select v_account_id;
end;
$$;

revoke all on function public.bootstrap_web3_identity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_web3_identity(uuid, text, text) to service_role;

create or replace function public.link_wallet_accounts(p_primary_auth_user uuid, p_secondary_auth_user uuid)
returns table(account_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_primary uuid;
  v_secondary uuid;
  v_secondary_credits integer;
  v_secondary_plan text;
  v_secondary_expiry timestamptz;
  v_secondary_username text;
begin
  select aw.account_id into v_primary from account_wallets aw where aw.auth_user_id = p_primary_auth_user;
  select aw.account_id into v_secondary from account_wallets aw where aw.auth_user_id = p_secondary_auth_user;
  if v_primary is null or v_secondary is null then raise exception 'Both wallets must sign in before they can be linked'; end if;
  if v_primary = v_secondary then return query select v_primary; return; end if;

  perform 1 from profiles where id in (v_primary, v_secondary) order by id for update;
  select credits, plan, plan_expires_at, username
    into v_secondary_credits, v_secondary_plan, v_secondary_expiry, v_secondary_username
    from profiles where id = v_secondary;

  -- Preserve every project and transaction created before the accounts were linked.
  update dapps set owner_id = v_primary where owner_id = v_secondary;
  update audits set owner_id = v_primary where owner_id = v_secondary;
  update credit_transactions set user_id = v_primary where user_id = v_secondary;
  delete from marketplace_purchases secondary_purchase
    using marketplace_purchases primary_purchase
    where secondary_purchase.buyer_id = v_secondary and primary_purchase.buyer_id = v_primary
      and secondary_purchase.dapp_id = primary_purchase.dapp_id
      and secondary_purchase.asset_type = primary_purchase.asset_type;
  update marketplace_purchases set buyer_id = v_primary where buyer_id = v_secondary;
  update solana_deploy_jobs set owner_id = v_primary where owner_id = v_secondary;

  if (select username from profiles where id = v_primary) is null and v_secondary_username is not null then
    update profiles set username = null where id = v_secondary;
    update profiles set username = v_secondary_username where id = v_primary;
  end if;
  update profiles set
    credits = credits + coalesce(v_secondary_credits, 0),
    plan = case when plan in ('pro', 'team') then plan when v_secondary_plan in ('pro', 'team') then v_secondary_plan else plan end,
    plan_expires_at = greatest(plan_expires_at, v_secondary_expiry)
    where id = v_primary;
  update profiles set credits = 0, plan = 'free', plan_expires_at = null where id = v_secondary;
  update account_wallets set account_id = v_primary where account_id = v_secondary;

  return query select v_primary;
end;
$$;

revoke all on function public.link_wallet_accounts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_wallet_accounts(uuid, uuid) to service_role;

create or replace function public.spend_credits(p_user_id uuid, p_amount integer, p_description text)
returns table(credits_remaining integer)
language plpgsql security definer set search_path = public as $$
declare
  current_plan text;
begin
  if p_user_id is null or p_amount is null or p_amount <= 0 then raise exception 'Invalid credit amount'; end if;
  select plan into current_plan from profiles where id = p_user_id for update;
  if current_plan = 'pro' and exists(select 1 from profiles where id = p_user_id and plan_expires_at > now()) then return query select credits from profiles where id = p_user_id; return; end if;
  if current_plan = 'pro' then update profiles set plan = 'free' where id = p_user_id; end if;
  update profiles set credits = credits - p_amount where id = p_user_id and credits >= p_amount returning credits into credits_remaining;
  if not found then raise exception 'Insufficient credits'; end if;
  insert into credit_transactions(user_id, amount, type, description) values (p_user_id, -p_amount, 'spend', p_description);
  return next;
end;
$$;

create or replace function public.add_credits(p_user_id uuid, p_amount integer, p_description text, p_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into credit_transactions(user_id, amount, type, description, payment_id)
  values (p_user_id, p_amount, 'purchase', p_description, p_payment_id)
  on conflict (payment_id) where payment_id is not null do nothing;
  if found then update profiles set credits = credits + p_amount where id = p_user_id; end if;
end;
$$;

create or replace function public.spend_burned_credits(
  p_user_id uuid,
  p_amount integer,
  p_description text,
  p_burn_id text
)
returns table(credits_remaining integer)
language plpgsql security definer set search_path = public as $$
declare
  existing_user_id uuid;
  existing_amount integer;
  existing_type text;
  existing_description text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden'; end if;
  if p_amount <= 0 or p_burn_id is null or p_burn_id = '' then raise exception 'Invalid credit burn'; end if;
  select user_id, amount, type, description
    into existing_user_id, existing_amount, existing_type, existing_description
    from credit_transactions where payment_id = p_burn_id;
  if found then
    if existing_user_id <> p_user_id or existing_amount <> -p_amount or existing_type <> 'spend' or existing_description <> p_description then
      raise exception 'This on-chain credit burn is already linked to a different action';
    end if;
    return query select credits from profiles where id = p_user_id;
    return;
  end if;
  update profiles set credits = credits - p_amount
    where id = p_user_id and credits >= p_amount
    returning credits into credits_remaining;
  if not found then raise exception 'Insufficient credits'; end if;
  insert into credit_transactions(user_id, amount, type, description, payment_id)
  values (p_user_id, -p_amount, 'spend', p_description, p_burn_id);
  return next;
exception
  when unique_violation then
    select user_id, amount, type, description
      into existing_user_id, existing_amount, existing_type, existing_description
      from credit_transactions where payment_id = p_burn_id;
    if not found or existing_user_id <> p_user_id or existing_amount <> -p_amount or existing_type <> 'spend' or existing_description <> p_description then
      raise exception 'This on-chain credit burn is already linked to a different action';
    end if;
    return query select credits from profiles where id = p_user_id;
    return;
end;
$$;

revoke all on function public.add_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.spend_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text) to service_role;
revoke all on function public.spend_burned_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.spend_burned_credits(uuid, integer, text, text) to service_role;

create or replace function public.activate_plan(p_user_id uuid, p_plan text, p_description text, p_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_plan not in ('pro', 'team') then raise exception 'Invalid plan'; end if;
  insert into credit_transactions(user_id, amount, type, description, payment_id)
  values (p_user_id, 0, 'purchase', p_description, p_payment_id)
  on conflict (payment_id) where payment_id is not null do nothing;
  if found then update profiles set plan = p_plan, plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '30 days' where id = p_user_id; end if;
end;
$$;

revoke all on function public.activate_plan(uuid, text, text, text) from public, anon, authenticated;

-- Future functions are private until explicitly granted to a database role.
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- Keep the bootstrap schema aligned with 20260803_distributed_ai_infrastructure.sql.
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
