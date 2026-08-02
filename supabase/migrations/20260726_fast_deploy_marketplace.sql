begin;

alter table public.dapps add column if not exists deploy_visibility text not null default 'private';
alter table public.dapps drop constraint if exists dapps_deploy_visibility_check;
alter table public.dapps add constraint dapps_deploy_visibility_check check (deploy_visibility in ('private', 'free', 'paid'));
alter table public.dapps add column if not exists deploy_price_usdc numeric(12,2) not null default 10;
alter table public.dapps drop constraint if exists dapps_deploy_price_usdc_check;
alter table public.dapps add constraint dapps_deploy_price_usdc_check check (deploy_price_usdc >= 1);
alter table public.dapps add column if not exists source_dapp_id uuid references public.dapps(id) on delete set null;

alter table public.marketplace_purchases drop constraint if exists marketplace_purchases_asset_type_check;
alter table public.marketplace_purchases add constraint marketplace_purchases_asset_type_check
  check (asset_type in ('source', 'frontend', 'audit', 'deploy'));

create index if not exists dapps_source_dapp_idx on public.dapps(source_dapp_id, owner_id);

commit;
