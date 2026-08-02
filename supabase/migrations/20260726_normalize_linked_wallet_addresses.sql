begin;

update public.account_wallets
set wallet_address = case
  when chain = 'evm' then regexp_replace(btrim(wallet_address), '^web3:ethereum:', '', 'i')
  when chain = 'solana' then regexp_replace(btrim(wallet_address), '^web3:solana:', '', 'i')
  else btrim(wallet_address)
end
where wallet_address ~* '^web3:(ethereum|solana):';

update public.profiles
set wallet_address = case
  when chain = 'evm' then regexp_replace(btrim(wallet_address), '^web3:ethereum:', '', 'i')
  when chain = 'solana' then regexp_replace(btrim(wallet_address), '^web3:solana:', '', 'i')
  else btrim(wallet_address)
end
where wallet_address ~* '^web3:(ethereum|solana):';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  address text;
  wallet_chain text;
begin
  address := btrim(coalesce(new.raw_user_meta_data->>'wallet_address', new.raw_user_meta_data->>'sub', new.id::text));
  wallet_chain := case when coalesce(new.raw_user_meta_data->>'chain', '') = 'solana' then 'solana' else 'evm' end;
  if wallet_chain = 'evm' then
    address := regexp_replace(address, '^web3:ethereum:', '', 'i');
  else
    address := regexp_replace(address, '^web3:solana:', '', 'i');
  end if;
  insert into public.profiles (id, wallet_address, chain) values (new.id, address, wallet_chain)
  on conflict (id) do nothing;
  insert into public.account_wallets (auth_user_id, account_id, wallet_address, chain)
  select new.id, new.id, profile.wallet_address, profile.chain from public.profiles profile where profile.id = new.id
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

commit;
