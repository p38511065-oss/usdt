
-- REFERRAL WORKING FINAL FIX
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

alter table public.profiles
add column if not exists referral_code text,
add column if not exists referred_by uuid;

create unique index if not exists idx_profiles_referral_code_unique
on public.profiles(referral_code)
where referral_code is not null;

create index if not exists idx_profiles_referred_by
on public.profiles(referred_by);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.sell_orders(id) on delete cascade,
  order_inr_amount numeric(18,2) not null default 0,
  reward_percent numeric(8,4) not null default 0.10,
  reward_amount_inr numeric(18,2) not null default 0,
  reward_status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id)
);

create table if not exists public.referral_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_inr numeric(18,2) not null,
  status text not null default 'requested',
  payout_method_id uuid,
  payout_label text,
  payout_details jsonb default '{}'::jsonb,
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referral_withdrawals_min_amount check (amount_inr >= 2000)
);

alter table public.referral_rewards enable row level security;
alter table public.referral_withdrawals enable row level security;

drop policy if exists referral_rewards_select_own_or_admin on public.referral_rewards;
create policy referral_rewards_select_own_or_admin
on public.referral_rewards
for select
to authenticated
using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());

drop policy if exists referral_rewards_insert_admin on public.referral_rewards;
create policy referral_rewards_insert_admin
on public.referral_rewards
for insert
to authenticated
with check (public.is_admin());

drop policy if exists referral_rewards_update_admin on public.referral_rewards;
create policy referral_rewards_update_admin
on public.referral_rewards
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists referral_withdrawals_select_own_or_admin on public.referral_withdrawals;
create policy referral_withdrawals_select_own_or_admin
on public.referral_withdrawals
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists referral_withdrawals_insert_own on public.referral_withdrawals;
create policy referral_withdrawals_insert_own
on public.referral_withdrawals
for insert
to authenticated
with check (user_id = auth.uid() and amount_inr >= 2000);

drop policy if exists referral_withdrawals_update_admin on public.referral_withdrawals;
create policy referral_withdrawals_update_admin
on public.referral_withdrawals
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists profiles_public_referral_lookup on public.profiles;
create policy profiles_public_referral_lookup
on public.profiles
for select
to anon, authenticated
using (referral_code is not null);

update public.profiles
set referral_code = upper(substr(replace(id::text,'-',''),1,8))
where referral_code is null or trim(referral_code) = '';

insert into public.referral_rewards (
  referrer_user_id, referred_user_id, order_id, order_inr_amount,
  reward_percent, reward_amount_inr, reward_status
)
select
  p.referred_by,
  o.user_id,
  o.id,
  coalesce(o.estimated_inr_payout, 0),
  0.10,
  round((coalesce(o.estimated_inr_payout, 0) * 0.001)::numeric, 2),
  'pending'
from public.sell_orders o
join public.profiles p on p.id = o.user_id
left join public.referral_rewards rr on rr.order_id = o.id
where p.referred_by is not null
  and p.referred_by <> o.user_id
  and o.status::text in ('completed','paid')
  and coalesce(o.estimated_inr_payout, 0) > 0
  and rr.id is null;
