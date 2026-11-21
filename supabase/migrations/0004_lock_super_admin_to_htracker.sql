-- Revoke the named former admin and register the one configured admin when
-- that Auth account already exists. This migration leaves business ownership
-- and business memberships unchanged.
delete from public.platform_admins
where lower(email) = 'aryanbiju5@gmail.com';

insert into public.platform_admins(user_id, email)
select id, 'htracker92@gmail.com'
from auth.users
where lower(email) = 'htracker92@gmail.com'
on conflict (user_id) do update set email = excluded.email;

create or replace function public.claim_first_platform_admin(p_user_id uuid, p_email text)
returns boolean language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.role() <> 'service_role'
    or p_user_id is null
    or lower(trim(coalesce(p_email, ''))) <> 'htracker92@gmail.com'
    or not exists (
      select 1 from auth.users u
      where u.id = p_user_id and lower(u.email) = 'htracker92@gmail.com'
    )
  then raise exception 'not allowed'; end if;

  if exists (
    select 1 from public.platform_admins a
    where a.user_id = p_user_id and lower(a.email) = 'htracker92@gmail.com'
  ) then return true; end if;

  insert into public.platform_admins(user_id, email)
  values (p_user_id, 'htracker92@gmail.com')
  on conflict do nothing;

  return exists (
    select 1 from public.platform_admins a
    where a.user_id = p_user_id and lower(a.email) = 'htracker92@gmail.com'
  );
end;
$body$;
revoke all on function public.claim_first_platform_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_first_platform_admin(uuid, text) to service_role;
