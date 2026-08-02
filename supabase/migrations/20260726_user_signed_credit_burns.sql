begin;

create or replace function public.spend_burned_credits(
  p_user_id uuid,
  p_amount integer,
  p_description text,
  p_burn_id text
)
returns table(credits_remaining integer)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden'; end if;
  if p_amount <= 0 or p_burn_id is null or p_burn_id = '' then raise exception 'Invalid credit burn'; end if;

  update profiles
    set credits = credits - p_amount
    where id = p_user_id and credits >= p_amount
    returning credits into credits_remaining;
  if not found then raise exception 'Insufficient credits'; end if;

  insert into credit_transactions(user_id, amount, type, description, payment_id)
  values (p_user_id, -p_amount, 'spend', p_description, p_burn_id);
  return next;
exception
  when unique_violation then raise exception 'This on-chain credit burn has already been used';
end;
$$;

revoke all on function public.spend_burned_credits(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.spend_burned_credits(uuid, integer, text, text) to service_role;

commit;
