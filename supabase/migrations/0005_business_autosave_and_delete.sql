-- Allow a named business to be saved before its Google review URL is configured.
alter table public.businesses alter column google_review_url drop not null;
alter table public.businesses drop constraint if exists businesses_google_review_url_check;
alter table public.businesses add constraint businesses_google_review_url_check
  check (google_review_url is null or google_review_url ~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/');

create or replace function public.create_business_draft(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $body$
declare new_business_id uuid;
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin() then
    raise exception 'This account does not have super admin access.';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 100 then
    raise exception 'Business name must be between 2 and 100 characters.';
  end if;

  insert into public.businesses(created_by,name,category,welcome_message,brand_color,status)
  values(auth.uid(),trim(p_name),'general','','#1f7a5c','pending')
  returning id into new_business_id;
  insert into public.business_users(business_id,user_id,role) values(new_business_id,auth.uid(),'owner');
  insert into public.questions(business_id,text,enabled,required,answer_type,options,sort_order) values
    (new_business_id,'How was your overall experience?',true,true,'rating','["Good","Average","Bad"]'::jsonb,0),
    (new_business_id,'What stood out during your visit?',true,false,'text','[]'::jsonb,1);
  return new_business_id;
end;
$body$;
revoke all on function public.create_business_draft(text) from public,anon;
grant execute on function public.create_business_draft(text) to authenticated;

create or replace function public.save_business_profile(
  p_business_id uuid,p_name text,p_category text,p_welcome_message text,p_brand_color text,p_google_review_url text
)
returns void language plpgsql security definer set search_path = ''
as $body$
declare current_status public.business_status;
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin()
    or not public.is_business_owner(p_business_id) then
    raise exception 'This account cannot update this business.';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 100 then raise exception 'Business name must be between 2 and 100 characters.'; end if;
  if p_category is null or p_category not in ('general','restaurant','cafe','salon','retail','clinic','automotive','other') then raise exception 'Choose a valid business type.'; end if;
  if p_welcome_message is null or char_length(p_welcome_message) > 180 then raise exception 'Welcome message must be 180 characters or fewer.'; end if;
  if p_brand_color is null or p_brand_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Choose a valid accent colour.'; end if;
  if nullif(trim(p_google_review_url),'') is not null and trim(p_google_review_url) !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/' then
    raise exception 'Use a secure Google Maps, Google review, or g.page link.';
  end if;

  select status into current_status from public.businesses where id=p_business_id for update;
  if current_status is null then raise exception 'Business not found.'; end if;
  if current_status = 'active' and nullif(trim(p_google_review_url),'') is null then raise exception 'Add a Google review link before saving.'; end if;
  update public.businesses set name=trim(p_name),category=p_category,welcome_message=trim(p_welcome_message),brand_color=p_brand_color,
    google_review_url=coalesce(nullif(trim(p_google_review_url),''),google_review_url),updated_at=now()
  where id=p_business_id;
end;
$body$;
revoke all on function public.save_business_profile(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.save_business_profile(uuid,text,text,text,text,text) to authenticated;

create or replace function public.activate_business_draft(p_business_id uuid,p_google_review_url text,p_token_hash text,p_token_value text)
returns void language plpgsql security definer set search_path = ''
as $body$
declare current_status public.business_status;
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin()
    or not public.is_business_owner(p_business_id) then raise exception 'This account cannot activate this business.'; end if;
  if p_google_review_url is null or p_google_review_url !~ '^https://([A-Za-z0-9-]+[.])?google[.]com/|^https://g[.]page/|^https://maps[.]app[.]goo[.]gl/' then raise exception 'Use a secure Google Maps, Google review, or g.page link.'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_value is null or p_token_value !~ '^[A-Za-z0-9_-]{28,40}$' then raise exception 'The QR code could not be prepared. Please try again.'; end if;

  select status into current_status from public.businesses where id=p_business_id for update;
  if current_status is null then raise exception 'Business not found.'; end if;
  if current_status = 'pending' then
    update public.businesses set google_review_url=p_google_review_url,status='active',updated_at=now() where id=p_business_id;
    insert into public.qr_codes(business_id,token_hash,token_value,label) values(p_business_id,p_token_hash,p_token_value,'Main QR');
  elsif not exists (select 1 from public.qr_codes where business_id=p_business_id and active) then
    update public.businesses set google_review_url=p_google_review_url,status='active',updated_at=now() where id=p_business_id;
    insert into public.qr_codes(business_id,token_hash,token_value,label) values(p_business_id,p_token_hash,p_token_value,'Main QR');
  end if;
end;
$body$;
revoke all on function public.activate_business_draft(uuid,text,text,text) from public,anon;
grant execute on function public.activate_business_draft(uuid,text,text,text) to authenticated;

create or replace function public.delete_business(p_business_id uuid)
returns void language plpgsql security definer set search_path = ''
as $body$
begin
  if auth.uid() is null or not public.is_verified_user() or not public.is_platform_admin()
    or not public.is_business_owner(p_business_id) then raise exception 'This account cannot delete this business.'; end if;
  delete from public.businesses where id=p_business_id;
  if not found then raise exception 'Business not found.'; end if;
end;
$body$;
revoke all on function public.delete_business(uuid) from public,anon;
grant execute on function public.delete_business(uuid) to authenticated;
