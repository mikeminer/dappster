alter table public.dapps
  add column if not exists contract_network text;

comment on column public.dapps.contract_network is
  'Non-EVM deployment network identifier, for example devnet, mainnet-beta, sui-testnet, or aptos-devnet.';
