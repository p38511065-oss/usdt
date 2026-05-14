
-- KYC FINAL DATABASE FIX
create extension if not exists pgcrypto;

create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
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
add column if not exists user_id uuid references public.profiles(id) on delete cascade,
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

drop policy if exists kyc_update_own_pending_or_admin on public.kyc_submissions;
create policy kyc_update_own_pending_or_admin
on public.kyc_submissions
for update
to authenticated
using (public.is_admin() or user_id = auth.uid())
with check (public.is_admin() or user_id = auth.uid());

create index if not exists idx_kyc_submissions_user_id on public.kyc_submissions(user_id);
create index if not exists idx_kyc_submissions_status on public.kyc_submissions(status);
