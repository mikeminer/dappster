begin;

drop policy if exists "Users create own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- raw_user_meta_data is user-editable and must never establish wallet ownership.
  insert into public.profiles (id, wallet_address, chain)
  values (new.id, new.id::text, 'evm')
  on conflict (id) do nothing;

  insert into public.account_wallets as wallet (auth_user_id, account_id, wallet_address, chain)
  select new.id, new.id, profile.wallet_address, profile.chain
  from public.profiles profile
  where profile.id = new.id
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

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

commit;
