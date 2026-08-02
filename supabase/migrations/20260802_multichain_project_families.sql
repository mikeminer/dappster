begin;

alter table public.dapps drop constraint if exists dapps_chain_check;
alter table public.dapps add constraint dapps_chain_check
  check (chain in ('evm', 'solana', 'sui', 'aptos', 'cosmos', 'ton', 'near', 'starknet', 'algorand'));

alter table public.audits drop constraint if exists audits_chain_check;
alter table public.audits add constraint audits_chain_check
  check (chain in ('evm', 'solana', 'sui', 'aptos', 'cosmos', 'ton', 'near', 'starknet', 'algorand'));

comment on column public.dapps.chain is
  'Smart-contract ecosystem. Wallet identities remain separately limited to supported authentication wallet families.';

commit;
