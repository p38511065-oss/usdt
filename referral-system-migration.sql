
-- =====================================================
-- REFERRAL SYSTEM: 0.10% EACH COMPLETED ORDER + ₹2000 MIN WITHDRAWAL
-- =====================================================

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
  payout_method_id uuid references public.bank_accounts(id) on delete set null,
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
using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());

drop policy if exists referral_rewards_insert_admin on public.referral_rewards;
create policy referral_rewards_insert_admin
on public.referral_rewards
for insert
with check (public.is_admin());

drop policy if exists referral_rewards_update_admin on public.referral_rewards;
create policy referral_rewards_update_admin
on public.referral_rewards
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists referral_withdrawals_select_own_or_admin on public.referral_withdrawals;
create policy referral_withdrawals_select_own_or_admin
on public.referral_withdrawals
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists referral_withdrawals_insert_own on public.referral_withdrawals;
create policy referral_withdrawals_insert_own
on public.referral_withdrawals
for insert
with check (user_id = auth.uid() and amount_inr >= 2000);

drop policy if exists referral_withdrawals_update_admin on public.referral_withdrawals;
create policy referral_withdrawals_update_admin
on public.referral_withdrawals
for update
using (public.is_admin())
with check (public.is_admin());

create index if not exists idx_referral_rewards_referrer on public.referral_rewards(referrer_user_id);
create index if not exists idx_referral_rewards_referred on public.referral_rewards(referred_user_id);
create index if not exists idx_referral_rewards_order on public.referral_rewards(order_id);
create index if not exists idx_referral_withdrawals_user on public.referral_withdrawals(user_id);
create index if not exists idx_referral_withdrawals_status on public.referral_withdrawals(status);
