
-- =====================================================
-- KYC RPC FINAL FIX
-- Run this in Supabase SQL Editor.
-- It creates submit_kyc() so seller KYC save does not fail due to RLS/FK/profile issues.
-- =====================================================

create extension if not exists pgcrypto;

create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  full_name text,
  dob date,
  id_type text,
  id_number text,
  address text,
  front_image_data text,
  back_image_data text,
  selfie_image_data text,
  status text not null default 'pending',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kyc_submissions
add column if not exists user_id uuid,
add column if not exists full_name text,
add column if not exists dob date,
add column if not exists id_type text,
add column if not exists id_number text,
add column if not exists address text,
add column if not exists front_image_data text,
add column if not exists back_image_data text,
add column if not exists selfie_image_data text,
add column if not exists status text not null default 'pending',
add column if not exists review_note text,
add column if not exists reviewed_by uuid,
add column if not exists reviewed_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

-- If older table had strict not-null constraints, make user-edit fields flexible.
do $$
begin
  alter table public.kyc_submissions alter column full_name drop not null;
  alter table public.kyc_submissions alter column dob drop not null;
  alter table public.kyc_submissions alter column id_type drop not null;
  alter table public.kyc_submissions alter column id_number drop not null;
  alter table public.kyc_submissions alter column address drop not null;
  alter table public.kyc_submissions alter column front_image_data drop not null;
  alter table public.kyc_submissions alter column back_image_data drop not null;
  alter table public.kyc_submissions alter column selfie_image_data drop not null;
exception when others then null;
end $$;

create or replace function public.submit_kyc(
  p_full_name text,
  p_dob date,
  p_id_type text,
  p_id_number text,
  p_address text,
  p_front_image_data text,
  p_back_image_data text,
  p_selfie_image_data text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_kyc_id uuid;
begin
  v_user := auth.uid();

  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- Repair missing profile row if signup/profile trigger failed earlier.
  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    user_status,
    kyc_status,
    referral_code,
    created_at,
    updated_at
  )
  values (
    v_user,
    coalesce((select email from auth.users where id = v_user), ''),
    coalesce(p_full_name, 'Seller'),
    'seller',
    'active',
    'pending',
    'SELL' || upper(substr(replace(v_user::text, '-', ''), 1, 8)),
    now(),
    now()
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    kyc_status = 'pending',
    updated_at = now();

  select id into v_kyc_id
  from public.kyc_submissions
  where user_id = v_user
  order by created_at desc
  limit 1;

  if v_kyc_id is null then
    insert into public.kyc_submissions (
      user_id,
      full_name,
      dob,
      id_type,
      id_number,
      address,
      front_image_data,
      back_image_data,
      selfie_image_data,
      status,
      review_note,
      created_at,
      updated_at
    )
    values (
      v_user,
      p_full_name,
      p_dob,
      p_id_type,
      p_id_number,
      p_address,
      p_front_image_data,
      p_back_image_data,
      p_selfie_image_data,
      'pending',
      null,
      now(),
      now()
    )
    returning id into v_kyc_id;
  else
    update public.kyc_submissions
    set
      full_name = p_full_name,
      dob = p_dob,
      id_type = p_id_type,
      id_number = p_id_number,
      address = p_address,
      front_image_data = coalesce(p_front_image_data, front_image_data),
      back_image_data = coalesce(p_back_image_data, back_image_data),
      selfie_image_data = coalesce(p_selfie_image_data, selfie_image_data),
      status = 'pending',
      review_note = null,
      updated_at = now()
    where id = v_kyc_id;
  end if;

  update public.profiles
  set kyc_status = 'pending', updated_at = now()
  where id = v_user;

  return jsonb_build_object('ok', true, 'kyc_id', v_kyc_id);
end;
$$;

grant execute on function public.submit_kyc(text,date,text,text,text,text,text,text) to authenticated;

alter table public.kyc_submissions enable row level security;

drop policy if exists kyc_select_own_or_admin on public.kyc_submissions;
create policy kyc_select_own_or_admin
on public.kyc_submissions
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists kyc_insert_own on public.kyc_submissions;
create policy kyc_insert_own
on public.kyc_submissions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists kyc_update_own_or_admin on public.kyc_submissions;
create policy kyc_update_own_or_admin
on public.kyc_submissions
for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create index if not exists idx_kyc_submissions_user_id on public.kyc_submissions(user_id);
create index if not exists idx_kyc_submissions_status on public.kyc_submissions(status);
