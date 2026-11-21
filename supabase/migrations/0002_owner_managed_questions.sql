alter table public.questions
  add column if not exists required boolean not null default true,
  add column if not exists answer_type text not null default 'rating',
  add column if not exists options jsonb not null default '["Good","Average","Bad"]'::jsonb;

alter table public.questions drop constraint if exists questions_text_check;
alter table public.questions add constraint questions_text_length_check check (char_length(text) between 3 and 100);

do $body$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_answer_type_check' and conrelid = 'public.questions'::regclass) then
    alter table public.questions add constraint questions_answer_type_check check (answer_type in ('rating','choice','text'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_options_array_check' and conrelid = 'public.questions'::regclass) then
    alter table public.questions add constraint questions_options_array_check check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 8);
  end if;
end;
$body$;

create or replace function public.get_public_review_page(p_token_hash text)
returns jsonb language sql stable security definer set search_path = ''
as $body$
  select jsonb_build_object(
    'business',jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'welcome_message',b.welcome_message,'brand_color',b.brand_color,'google_review_url',b.google_review_url,'logo_path',b.logo_path),
    'qr_code_id',q.id,
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object('id',qu.id,'text',qu.text,'required',qu.required,'answer_type',qu.answer_type,'options',qu.options) order by qu.sort_order)
      from public.questions qu where qu.business_id=b.id and qu.enabled
    ),'[]'::jsonb)
  )
  from public.qr_codes q join public.businesses b on b.id=q.business_id
  where q.token_hash=p_token_hash and q.active and b.status='active'
  limit 1;
$body$;
revoke all on function public.get_public_review_page(text) from public,anon,authenticated;
grant execute on function public.get_public_review_page(text) to service_role;

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
