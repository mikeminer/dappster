-- Public publisher names are resolved by trusted API routes. This view was not
-- used by the application and bypassed the profiles table RLS as its owner.
do $$
begin
  if to_regclass('public.public_profiles') is not null then
    revoke all privileges on table public.public_profiles from anon, authenticated, service_role;
    drop view public.public_profiles;
  end if;
end
$$;
