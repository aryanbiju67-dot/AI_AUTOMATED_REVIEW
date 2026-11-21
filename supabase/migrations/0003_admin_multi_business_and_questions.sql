-- One email allowlisted by the deployment becomes the platform admin.
-- Admin access is granted only by the server after checking the authenticated email.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;
grant all on public.platform_admins to service_role;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $body$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$body$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

create or replace function public.claim_first_platform_admin(p_user_id uuid, p_email text)
returns boolean language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.role() <> 'service_role' or p_user_id is null or p_email is null or length(trim(p_email)) > 320 then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id and lower(email) = lower(trim(p_email))) then
    return true;
  end if;
  if exists (select 1 from public.platform_admins) then
    return false;
  end if;
  insert into public.platform_admins(user_id, email) values (p_user_id, lower(trim(p_email)))
  on conflict do nothing;
  return exists (select 1 from public.platform_admins where user_id = p_user_id and lower(email) = lower(trim(p_email)));
end;
$body$;
revoke all on function public.claim_first_platform_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_first_platform_admin(uuid, text) to service_role;

alter table public.questions drop constraint if exists questions_sort_order_check;
alter table public.questions drop constraint if exists questions_sort_order_range_check;
alter table public.questions add constraint questions_sort_order_range_check check (sort_order between 0 and 19);
alter table public.questions drop constraint if exists questions_text_check;
alter table public.questions drop constraint if exists questions_text_length_check;
alter table public.questions add constraint questions_text_length_check check (char_length(text) between 3 and 100);

create or replace function public.save_business_settings(
  p_business_id uuid,p_name text,p_category text,p_welcome_message text,p_brand_color text,
  p_google_review_url text,p_logo_path text,p_questions jsonb
)
returns void language plpgsql security definer set search_path = ''
as $body$
declare
  item jsonb;
  question_id uuid;
  question_text text;
  question_enabled boolean;
  question_required boolean;
  question_answer_type text;
  question_options jsonb;
  retained uuid[] := '{}';
  next_order integer := 0;
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin()
    or not public.is_business_owner(p_business_id)
    or char_length(trim(p_name)) not between 2 and 100
    or p_category not in ('general','restaurant','cafe','salon','retail','clinic','automotive','other')
    or char_length(p_welcome_message) > 180
    or p_brand_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_google_review_url !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/'
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 20
  then raise exception 'invalid settings'; end if;
  if not exists (select 1 from jsonb_array_elements(p_questions) q where coalesce((q->>'enabled')::boolean,false)) then
    raise exception 'at least one question must be enabled';
  end if;

  if p_logo_path is not null and p_logo_path !~ ('^' || p_business_id::text || '/[A-Za-z0-9-]+[.](png|jpg|webp)$') then raise exception 'invalid logo'; end if;
  update public.businesses set name=trim(p_name),category=p_category,welcome_message=trim(p_welcome_message),brand_color=p_brand_color,google_review_url=p_google_review_url,logo_path=p_logo_path,updated_at=now()
  where id=p_business_id;
  for item in select value from jsonb_array_elements(p_questions) loop
    question_text := trim(item->>'text');
    question_enabled := coalesce((item->>'enabled')::boolean,false);
    question_required := coalesce((item->>'required')::boolean,false);
    question_answer_type := item->>'answer_type';
    question_options := item->'options';
    question_id := nullif(item->>'id','')::uuid;
    if char_length(question_text) not between 3 and 100
      or question_answer_type not in ('rating','choice','text')
      or jsonb_typeof(question_options) <> 'array'
      or jsonb_array_length(question_options) > 8
    then raise exception 'invalid question'; end if;
    if question_answer_type = 'rating' then
      question_options := '["Good","Average","Bad"]'::jsonb;
    elsif question_answer_type = 'choice' then
      if jsonb_array_length(question_options) not between 2 and 8
        or exists (select 1 from jsonb_array_elements(question_options) option_value where jsonb_typeof(option_value) <> 'string' or char_length(trim(option_value#>>'{}')) not between 1 and 50)
      then raise exception 'invalid choice options'; end if;
    else
      question_options := '[]'::jsonb;
    end if;

    if question_id is null then
      insert into public.questions(business_id,text,enabled,required,answer_type,options,sort_order)
      values(p_business_id,question_text,question_enabled,question_required,question_answer_type,question_options,next_order)
      returning id into question_id;
    else
      if question_id = any(retained) then raise exception 'duplicate question'; end if;
      update public.questions set text=question_text,enabled=question_enabled,required=question_required,answer_type=question_answer_type,options=question_options,sort_order=next_order
      where id=question_id and business_id=p_business_id;
      if not found then raise exception 'invalid question'; end if;
    end if;
    retained := array_append(retained,question_id);
    next_order := next_order+1;
  end loop;
  delete from public.questions where business_id=p_business_id and not (id=any(retained));
end;
$body$;
revoke all on function public.save_business_settings(uuid,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.save_business_settings(uuid,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.create_business_setup(
  p_name text,p_category text,p_welcome_message text,p_brand_color text,p_google_review_url text,p_token_hash text,p_token_value text
)
returns uuid language plpgsql security definer set search_path = ''
as $body$
declare new_business_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before creating a business.'; end if;
  if not public.is_verified_user() then raise exception 'Confirm your account email before creating a business.'; end if;
  if not public.is_platform_admin() then raise exception 'This account does not have super admin access.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 100 then raise exception 'Business name must be between 2 and 100 characters.'; end if;
  if p_category is null or p_category not in ('general','restaurant','cafe','salon','retail','clinic','automotive','other') then raise exception 'Choose a valid business type.'; end if;
  if p_welcome_message is null or char_length(p_welcome_message) > 180 then raise exception 'Welcome message must be 180 characters or fewer.'; end if;
  if p_brand_color is null or p_brand_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Choose a valid accent colour.'; end if;
  if p_google_review_url is null or p_google_review_url !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/' then raise exception 'Use a secure Google Maps, Google review, or g.page link.'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_value is null or p_token_value !~ '^[A-Za-z0-9_-]{28,40}$' then raise exception 'The QR code could not be prepared. Please try again.'; end if;
  insert into public.businesses(created_by,name,category,welcome_message,brand_color,google_review_url,status)
  values(auth.uid(),trim(p_name),p_category,trim(p_welcome_message),p_brand_color,p_google_review_url,'active')
  returning id into new_business_id;
  insert into public.business_users(business_id,user_id,role) values(new_business_id,auth.uid(),'owner');
  insert into public.questions(business_id,text,enabled,required,answer_type,options,sort_order) values
    (new_business_id,'How was your overall experience?',true,true,'rating','["Good","Average","Bad"]'::jsonb,0),
    (new_business_id,'What stood out during your visit?',true,false,'text','[]'::jsonb,1);
  insert into public.qr_codes(business_id,token_hash,token_value,label) values(new_business_id,p_token_hash,p_token_value,'Main QR');
  return new_business_id;
end;
$body$;
revoke all on function public.create_business_setup(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_business_setup(text,text,text,text,text,text,text) to authenticated;

create or replace function public.rotate_business_qr(p_business_id uuid,p_token_hash text,p_token_value text)
returns void language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin() or not public.is_business_owner(p_business_id)
    or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_value !~ '^[A-Za-z0-9_-]{28,40}$'
  then raise exception 'invalid QR rotation'; end if;
  update public.qr_codes set active=false,rotated_at=now() where business_id=p_business_id and active;
  insert into public.qr_codes(business_id,token_hash,token_value,label) values(p_business_id,p_token_hash,p_token_value,'Main QR');
end;
$body$;
revoke all on function public.rotate_business_qr(uuid,text,text) from public,anon;
grant execute on function public.rotate_business_qr(uuid,text,text) to authenticated;
