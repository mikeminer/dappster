begin;

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

  update profiles
    set credits = credits - p_amount
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

revoke all on function public.spend_burned_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.spend_burned_credits(uuid, integer, text, text) to service_role;

commit;
