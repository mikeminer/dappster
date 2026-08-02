begin;

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
alter table public.account_wallets enable row level security;
revoke all on public.account_wallets from anon, authenticated;
grant all on public.account_wallets to service_role;

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
  update account_wallets aw set account_id = v_primary where aw.account_id = v_secondary;

  return query select v_primary;
end;
$$;

revoke all on function public.link_wallet_accounts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_wallet_accounts(uuid, uuid) to service_role;

commit;
