begin;

alter table public.dapps
  add column if not exists base_payout_address text,
  add column if not exists solana_payout_address text;

comment on column public.dapps.base_payout_address is
  'Creator EVM payout address for Base marketplace sales.';
comment on column public.dapps.solana_payout_address is
  'Creator Solana payout address for Solana marketplace sales.';

commit;

-- Ask PostgREST to refresh its schema cache immediately after the DDL change.
notify pgrst, 'reload schema';
