begin;

create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount integer,
  p_description text
)
returns table(credits_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_plan text;
begin
  if p_user_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'Invalid credit amount';
  end if;

  select plan into current_plan
    from public.profiles
    where id = p_user_id
    for update;

  if current_plan = 'pro' and exists(
    select 1 from public.profiles where id = p_user_id and plan_expires_at > now()
  ) then
    return query select credits from public.profiles where id = p_user_id;
    return;
  end if;

  if current_plan = 'pro' then
    update public.profiles set plan = 'free' where id = p_user_id;
  end if;

  update public.profiles
    set credits = credits - p_amount
    where id = p_user_id and credits >= p_amount
    returning credits into credits_remaining;

  if not found then
    raise exception 'Insufficient credits';
  end if;

  insert into public.credit_transactions(user_id, amount, type, description)
  values (p_user_id, -p_amount, 'spend', left(coalesce(p_description, 'Credit spend'), 500));

  return next;
end;
$$;

revoke all on function public.spend_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text) to service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

commit;
