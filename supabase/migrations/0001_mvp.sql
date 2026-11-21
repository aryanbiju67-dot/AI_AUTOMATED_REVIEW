create extension if not exists pgcrypto with schema extensions;
create type public.business_status as enum ('pending','active','suspended');
create type public.business_role as enum ('owner','staff');
create type public.review_event_type as enum ('page_visit','feedback_submitted','draft_generated','copy_attempted','google_link_clicked');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 100),
  category text not null check (category in ('general','restaurant','cafe','salon','retail','clinic','automotive','other')),
  welcome_message text not null default '' check (char_length(welcome_message) <= 180),
  brand_color text not null default '#126B57' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  google_review_url text not null check (google_review_url ~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/'),
  logo_path text,
  status public.business_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.business_users (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.business_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  text text not null check (char_length(text) between 3 and 80),
  enabled boolean not null default true,
  sort_order smallint not null check (sort_order between 0 and 7),
  created_at timestamptz not null default now()
);
create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_value text not null unique check (token_value ~ '^[A-Za-z0-9_-]{28,40}$'),
  label text not null default 'Main QR' check (char_length(label) <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (id,business_id)
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  qr_code_id uuid not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) between 1 and 8),
  draft text check (draft is null or char_length(draft) <= 1200),
  ai_model text,
  ai_prompt_version text,
  ai_input_tokens integer check (ai_input_tokens is null or ai_input_tokens >= 0),
  ai_output_tokens integer check (ai_output_tokens is null or ai_output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key (qr_code_id,business_id) references public.qr_codes(id,business_id)
);
create table public.events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  qr_code_id uuid not null references public.qr_codes(id) on delete cascade,
  feedback_id uuid references public.feedback(id) on delete set null,
  event_type public.review_event_type not null,
  created_at timestamptz not null default now()
);
create table public.public_rate_limits (
  bucket_key text primary key check (char_length(bucket_key) = 64),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default now()
);

create index business_users_user_id_idx on public.business_users(user_id);
create index questions_business_order_idx on public.questions(business_id,sort_order) where enabled;
create index qr_codes_business_active_idx on public.qr_codes(business_id) where active;
create index feedback_business_created_idx on public.feedback(business_id,created_at desc);
create index events_business_type_created_idx on public.events(business_id,event_type,created_at desc);

create or replace function public.is_business_member(target_business_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $body$
  select exists (select 1 from public.business_users bu where bu.business_id = target_business_id and bu.user_id = (select auth.uid()));
$body$;
create or replace function public.is_business_owner(target_business_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $body$
  select exists (select 1 from public.business_users bu where bu.business_id = target_business_id and bu.user_id = (select auth.uid()) and bu.role = 'owner');
$body$;
create or replace function public.is_verified_user()
returns boolean language sql stable security definer set search_path = ''
as $body$
  select exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null);
$body$;
revoke all on function public.is_business_member(uuid), public.is_business_owner(uuid), public.is_verified_user() from public;
grant execute on function public.is_business_member(uuid), public.is_business_owner(uuid), public.is_verified_user() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('business-logos','business-logos',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy business_logo_upload_owner on storage.objects for insert to authenticated
  with check (bucket_id='business-logos' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid));
create policy business_logo_update_owner on storage.objects for update to authenticated
  using (bucket_id='business-logos' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid))
  with check (bucket_id='business-logos' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid));
create policy business_logo_delete_owner on storage.objects for delete to authenticated
  using (bucket_id='business-logos' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_business_owner(((storage.foldername(name))[1])::uuid));

alter table public.businesses enable row level security;
alter table public.business_users enable row level security;
alter table public.questions enable row level security;
alter table public.qr_codes enable row level security;
alter table public.feedback enable row level security;
alter table public.events enable row level security;
alter table public.public_rate_limits enable row level security;

create policy business_read_member on public.businesses for select to authenticated using (public.is_business_member(id));
create policy business_insert_creator on public.businesses for insert to authenticated with check (created_by = (select auth.uid()));
create policy business_update_owner on public.businesses for update to authenticated using (public.is_business_owner(id)) with check (public.is_business_owner(id));
create policy member_read_self_or_owner on public.business_users for select to authenticated using (user_id = (select auth.uid()) or public.is_business_owner(business_id));
create policy member_insert_creator on public.business_users for insert to authenticated with check (
  user_id = (select auth.uid()) and role = 'owner' and exists (select 1 from public.businesses b where b.id = business_id and b.created_by = (select auth.uid()))
);
create policy questions_read_member on public.questions for select to authenticated using (public.is_business_member(business_id));
create policy questions_insert_owner on public.questions for insert to authenticated with check (public.is_business_owner(business_id));
create policy questions_update_owner on public.questions for update to authenticated using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
create policy questions_delete_owner on public.questions for delete to authenticated using (public.is_business_owner(business_id));
create policy qr_read_member on public.qr_codes for select to authenticated using (public.is_business_member(business_id));
create policy qr_insert_owner on public.qr_codes for insert to authenticated with check (public.is_business_owner(business_id));
create policy qr_update_owner on public.qr_codes for update to authenticated using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
create policy feedback_read_member on public.feedback for select to authenticated using (public.is_business_member(business_id));
create policy events_read_member on public.events for select to authenticated using (public.is_business_member(business_id));

revoke all on public.businesses,public.business_users,public.questions,public.qr_codes,public.feedback,public.events,public.public_rate_limits from anon,authenticated;
grant select on public.businesses to authenticated;
grant select,insert on public.business_users to authenticated;
grant select on public.questions,public.qr_codes to authenticated;
grant select on public.feedback,public.events to authenticated;
grant all on public.businesses,public.business_users,public.questions,public.qr_codes,public.feedback,public.events,public.public_rate_limits to service_role;

create or replace function public.get_public_review_page(p_token_hash text)
returns jsonb language sql stable security definer set search_path = ''
as $body$
  select jsonb_build_object(
    'business',jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'welcome_message',b.welcome_message,'brand_color',b.brand_color,'logo_path',b.logo_path),
    'qr_code_id',q.id,
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',qu.id,'text',qu.text) order by qu.sort_order) from public.questions qu where qu.business_id=b.id and qu.enabled),'[]'::jsonb)
  )
  from public.qr_codes q join public.businesses b on b.id=q.business_id
  where q.token_hash=p_token_hash and q.active and b.status='active'
  limit 1;
$body$;
revoke all on function public.get_public_review_page(text) from public,anon,authenticated;
grant execute on function public.get_public_review_page(text) to service_role;

create or replace function public.save_business_settings(
  p_business_id uuid,p_name text,p_category text,p_welcome_message text,p_brand_color text,p_google_review_url text,p_logo_path text,p_questions jsonb
)
returns void language plpgsql security definer set search_path = ''
as $body$
declare item jsonb; question_id uuid; question_text text; question_enabled boolean; retained uuid[] := '{}'; next_order integer := 0;
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_business_owner(p_business_id)
    or char_length(trim(p_name)) not between 2 and 100
    or p_category not in ('general','restaurant','cafe','salon','retail','clinic','automotive','other')
    or char_length(p_welcome_message) > 180
    or p_brand_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_google_review_url !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/'
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 8
  then raise exception 'invalid settings'; end if;
  if not exists (select 1 from jsonb_array_elements(p_questions) q where (q->>'enabled')::boolean is true) then
    raise exception 'at least one question must be enabled';
  end if;

  if p_logo_path is not null and p_logo_path !~ ('^' || p_business_id::text || '/[A-Za-z0-9-]+[.](png|jpg|webp)$') then raise exception 'invalid logo'; end if;
  update public.businesses set name=trim(p_name),category=p_category,welcome_message=trim(p_welcome_message),brand_color=p_brand_color,google_review_url=p_google_review_url,logo_path=p_logo_path,updated_at=now()
  where id=p_business_id;
  for item in select value from jsonb_array_elements(p_questions) loop
    question_text := trim(item->>'text');
    question_enabled := (item->>'enabled')::boolean;
    question_id := nullif(item->>'id','')::uuid;
    if char_length(question_text) not between 3 and 80 then raise exception 'invalid question'; end if;
    if question_id is null then
      insert into public.questions(business_id,text,enabled,sort_order) values(p_business_id,question_text,question_enabled,next_order) returning id into question_id;
    else
      if question_id = any(retained) then raise exception 'duplicate question'; end if;
      update public.questions set text=question_text,enabled=question_enabled,sort_order=next_order where id=question_id and business_id=p_business_id;
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

create or replace function public.rotate_business_qr(p_business_id uuid,p_token_hash text,p_token_value text)
returns void language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_business_owner(p_business_id)
    or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_value !~ '^[A-Za-z0-9_-]{28,40}$'
  then raise exception 'invalid QR rotation'; end if;
  update public.qr_codes set active=false,rotated_at=now() where business_id=p_business_id and active;
  insert into public.qr_codes(business_id,token_hash,token_value,label) values(p_business_id,p_token_hash,p_token_value,'Main QR');
end;
$body$;
revoke all on function public.rotate_business_qr(uuid,text,text) from public,anon;
grant execute on function public.rotate_business_qr(uuid,text,text) to authenticated;

create or replace function public.check_public_rate_limit(p_bucket_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = ''
as $body$
declare current_count integer;
begin
  if auth.role() <> 'service_role' or length(p_bucket_key) <> 64 or p_limit < 1 or p_window_seconds < 1 then raise exception 'not allowed'; end if;
  insert into public.public_rate_limits(bucket_key,window_started_at,request_count) values(p_bucket_key,now(),1)
  on conflict(bucket_key) do update set
    window_started_at=case when public.public_rate_limits.window_started_at <= now()-make_interval(secs => p_window_seconds) then now() else public.public_rate_limits.window_started_at end,
    request_count=case when public.public_rate_limits.window_started_at <= now()-make_interval(secs => p_window_seconds) then 1 else public.public_rate_limits.request_count+1 end,
    updated_at=now()
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$body$;
revoke all on function public.check_public_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.check_public_rate_limit(text,integer,integer) to service_role;

create or replace function public.create_business_setup(
  p_name text,p_category text,p_welcome_message text,p_brand_color text,p_google_review_url text,p_token_hash text,p_token_value text
)
returns uuid language plpgsql security definer set search_path = ''
as $body$
declare new_business_id uuid;
begin
  if auth.uid() is null or not public.is_verified_user()
    or char_length(trim(p_name)) not between 2 and 100
    or p_category not in ('general','restaurant','cafe','salon','retail','clinic','automotive','other')
    or char_length(p_welcome_message) > 180
    or p_brand_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_google_review_url !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/'
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_token_value !~ '^[A-Za-z0-9_-]{28,40}$'
  then raise exception 'invalid setup'; end if;
  insert into public.businesses(created_by,name,category,welcome_message,brand_color,google_review_url,status)
  values(auth.uid(),trim(p_name),p_category,trim(p_welcome_message),p_brand_color,p_google_review_url,'active')
  returning id into new_business_id;
  insert into public.business_users(business_id,user_id,role) values(new_business_id,auth.uid(),'owner');
  insert into public.questions(business_id,text,enabled,sort_order) values
    (new_business_id,'Overall experience',true,0),
    (new_business_id,'Staff and service',true,1),
    (new_business_id,'Value for money',true,2);
  insert into public.qr_codes(business_id,token_hash,token_value,label) values(new_business_id,p_token_hash,p_token_value,'Main QR');
  return new_business_id;
end;
$body$;
revoke all on function public.create_business_setup(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_business_setup(text,text,text,text,text,text,text) to authenticated;
comment on table public.feedback is 'Anonymous feedback. Apply an approved retention policy before production launch.';
comment on table public.public_rate_limits is 'Hashed rate-limit keys only; prune rows older than one day with a scheduled job.';
