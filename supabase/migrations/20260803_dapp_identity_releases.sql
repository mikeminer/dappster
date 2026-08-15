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

create index if not exists dapp_releases_dapp_idx on public.dapp_releases(dapp_id, created_at desc);
create index if not exists dapp_releases_owner_idx on public.dapp_releases(owner_id, created_at desc);

alter table public.dapp_releases enable row level security;
create policy "Anyone sees confirmed dApp releases" on public.dapp_releases
  for select using (status = 'confirmed' or auth.uid() = owner_id);

revoke all on public.dapp_releases from anon, authenticated;
grant select on public.dapp_releases to anon, authenticated;
grant all on public.dapp_releases to service_role;

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
