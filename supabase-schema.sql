create extension if not exists pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('seller', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status') THEN
    CREATE TYPE public.kyc_status AS ENUM ('not_submitted', 'pending', 'verified', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE public.user_status AS ENUM ('active', 'inactive', 'suspended', 'blocked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_type') THEN
    CREATE TYPE public.quote_type AS ENUM ('standard', 'fast_payout', 'priority', 'bulk_otc');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM ('quote_selected', 'awaiting_kyc', 'awaiting_transfer', 'awaiting_confirmations', 'payout_in_progress', 'completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reward_status') THEN
    CREATE TYPE public.reward_status AS ENUM ('pending', 'approved', 'paid', 'rejected');
  END IF;
END $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  mobile text unique,
  role public.app_role not null default 'seller',
  kyc_status public.kyc_status not null default 'not_submitted',
  user_status public.user_status not null default 'active',
  referral_code text unique,
  referred_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_referral_code text;
begin
  v_referral_code := upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8));
  insert into public.profiles (id, full_name, email, mobile, role, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'mobile', ''),
    'seller',
    v_referral_code
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_holder_name text,
  bank_name text,
  account_number text,
  ifsc_code text,
  payment_method text not null default 'bank',
  upi_id text,
  label text,
  is_primary boolean not null default false,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_bank_accounts_updated_at on public.bank_accounts;
create trigger trg_bank_accounts_updated_at before update on public.bank_accounts for each row execute function public.set_updated_at();

create table if not exists public.coin_rates (
  id uuid primary key default gen_random_uuid(),
  coin_symbol text not null,
  network text not null,
  buy_rate_inr numeric(18,8) not null,
  spread_percent numeric(8,4) not null default 0,
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coin_symbol, network)
);
drop trigger if exists trg_coin_rates_updated_at on public.coin_rates;
create trigger trg_coin_rates_updated_at before update on public.coin_rates for each row execute function public.set_updated_at();

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  quote_name text not null,
  quote_type public.quote_type not null,
  description text,
  payout_time_label text not null,
  extra_spread_percent numeric(8,4) not null default 0,
  min_amount_usdt numeric(18,8),
  max_amount_usdt numeric(18,8),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_quote_templates_updated_at on public.quote_templates;
create trigger trg_quote_templates_updated_at before update on public.quote_templates for each row execute function public.set_updated_at();

create table if not exists public.quote_slabs (
  id uuid primary key default gen_random_uuid(),
  quote_type public.quote_type not null,
  coin_symbol text not null,
  network text not null,
  min_amount numeric(18,8) not null default 0,
  max_amount numeric(18,8),
  rate_inr numeric(18,8) not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_quote_slabs_updated_at on public.quote_slabs;
create trigger trg_quote_slabs_updated_at before update on public.quote_slabs for each row execute function public.set_updated_at();

create table if not exists public.wallet_pools (
  id uuid primary key default gen_random_uuid(),
  coin_symbol text not null,
  network text not null,
  wallet_address text not null,
  label text,
  qr_data_url text,
  is_active boolean not null default true,
  rotate_daily boolean not null default false,
  last_rotated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_wallet_pools_updated_at on public.wallet_pools;
create trigger trg_wallet_pools_updated_at before update on public.wallet_pools for each row execute function public.set_updated_at();

create table if not exists public.sell_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  quote_template_id uuid references public.quote_templates(id) on delete set null,
  coin_symbol text not null,
  network text not null,
  crypto_amount numeric(18,8) not null,
  locked_rate_inr numeric(18,8) not null,
  spread_percent numeric(8,4) not null default 0,
  estimated_inr_payout numeric(18,2) not null,
  payout_method text,
  payout_label text,
  payout_details jsonb not null default '{}'::jsonb,
  deposit_wallet_address text,
  tx_hash text,
  confirmations_required integer not null default 20,
  confirmations_received integer not null default 0,
  status public.order_status not null default 'quote_selected',
  admin_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_sell_orders_updated_at on public.sell_orders;
create trigger trg_sell_orders_updated_at before update on public.sell_orders for each row execute function public.set_updated_at();

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
  status public.kyc_status not null default 'pending',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_kyc_submissions_updated_at on public.kyc_submissions;
create trigger trg_kyc_submissions_updated_at before update on public.kyc_submissions for each row execute function public.set_updated_at();

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.sell_orders(id) on delete set null,
  reward_percent numeric(8,4) not null default 0.2500,
  reward_amount_inr numeric(18,2) not null default 0,
  reward_status public.reward_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referred_user_id, order_id)
);
drop trigger if exists trg_referral_rewards_updated_at on public.referral_rewards;
create trigger trg_referral_rewards_updated_at before update on public.referral_rewards for each row execute function public.set_updated_at();

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.coin_rates enable row level security;
alter table public.quote_templates enable row level security;
alter table public.quote_slabs enable row level security;
alter table public.wallet_pools enable row level security;
alter table public.sell_orders enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.audit_logs enable row level security;

DO $$ BEGIN
  EXECUTE 'drop policy if exists profiles_select_own_or_admin on public.profiles';
  EXECUTE 'create policy profiles_select_own_or_admin on public.profiles for select using (id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists profiles_update_own_or_admin on public.profiles';
  EXECUTE 'create policy profiles_update_own_or_admin on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin())';

  EXECUTE 'drop policy if exists bank_accounts_select_own_or_admin on public.bank_accounts';
  EXECUTE 'create policy bank_accounts_select_own_or_admin on public.bank_accounts for select using (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists bank_accounts_insert_own_or_admin on public.bank_accounts';
  EXECUTE 'create policy bank_accounts_insert_own_or_admin on public.bank_accounts for insert with check (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists bank_accounts_update_own_or_admin on public.bank_accounts';
  EXECUTE 'create policy bank_accounts_update_own_or_admin on public.bank_accounts for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists bank_accounts_delete_own_or_admin on public.bank_accounts';
  EXECUTE 'create policy bank_accounts_delete_own_or_admin on public.bank_accounts for delete using (user_id = auth.uid() or public.is_admin())';

  EXECUTE 'drop policy if exists coin_rates_select_authenticated on public.coin_rates';
  EXECUTE 'create policy coin_rates_select_authenticated on public.coin_rates for select to authenticated using (true)';
  EXECUTE 'drop policy if exists coin_rates_admin_all on public.coin_rates';
  EXECUTE 'create policy coin_rates_admin_all on public.coin_rates for all using (public.is_admin()) with check (public.is_admin())';

  EXECUTE 'drop policy if exists quote_templates_select_authenticated on public.quote_templates';
  EXECUTE 'create policy quote_templates_select_authenticated on public.quote_templates for select to authenticated using (is_enabled = true or public.is_admin())';
  EXECUTE 'drop policy if exists quote_templates_admin_all on public.quote_templates';
  EXECUTE 'create policy quote_templates_admin_all on public.quote_templates for all using (public.is_admin()) with check (public.is_admin())';

  EXECUTE 'drop policy if exists quote_slabs_select_authenticated on public.quote_slabs';
  EXECUTE 'create policy quote_slabs_select_authenticated on public.quote_slabs for select to authenticated using (is_enabled = true or public.is_admin())';
  EXECUTE 'drop policy if exists quote_slabs_admin_all on public.quote_slabs';
  EXECUTE 'create policy quote_slabs_admin_all on public.quote_slabs for all using (public.is_admin()) with check (public.is_admin())';

  EXECUTE 'drop policy if exists wallet_pools_admin_all on public.wallet_pools';
  EXECUTE 'create policy wallet_pools_admin_all on public.wallet_pools for all using (public.is_admin()) with check (public.is_admin())';
  EXECUTE 'drop policy if exists wallet_pools_select_authenticated on public.wallet_pools';
  EXECUTE 'create policy wallet_pools_select_authenticated on public.wallet_pools for select to authenticated using (is_active = true or public.is_admin())';

  EXECUTE 'drop policy if exists sell_orders_select_own_or_admin on public.sell_orders';
  EXECUTE 'create policy sell_orders_select_own_or_admin on public.sell_orders for select using (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists sell_orders_insert_own_or_admin on public.sell_orders';
  EXECUTE 'create policy sell_orders_insert_own_or_admin on public.sell_orders for insert with check (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists sell_orders_update_own_or_admin on public.sell_orders';
  EXECUTE 'create policy sell_orders_update_own_or_admin on public.sell_orders for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin())';

  EXECUTE 'drop policy if exists kyc_submissions_select_own_or_admin on public.kyc_submissions';
  EXECUTE 'create policy kyc_submissions_select_own_or_admin on public.kyc_submissions for select using (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists kyc_submissions_insert_own_or_admin on public.kyc_submissions';
  EXECUTE 'create policy kyc_submissions_insert_own_or_admin on public.kyc_submissions for insert with check (user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists kyc_submissions_update_own_or_admin on public.kyc_submissions';
  EXECUTE 'create policy kyc_submissions_update_own_or_admin on public.kyc_submissions for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin())';

  EXECUTE 'drop policy if exists referral_rewards_select_own_or_admin on public.referral_rewards';
  EXECUTE 'create policy referral_rewards_select_own_or_admin on public.referral_rewards for select using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin())';
  EXECUTE 'drop policy if exists referral_rewards_admin_all on public.referral_rewards';
  EXECUTE 'create policy referral_rewards_admin_all on public.referral_rewards for all using (public.is_admin()) with check (public.is_admin())';

  EXECUTE 'drop policy if exists audit_logs_admin_only on public.audit_logs';
  EXECUTE 'create policy audit_logs_admin_only on public.audit_logs for all using (public.is_admin()) with check (public.is_admin())';
EXCEPTION WHEN others THEN NULL; END $$;

insert into public.quote_templates (quote_name, quote_type, description, payout_time_label, extra_spread_percent, min_amount_usdt, max_amount_usdt, is_enabled, sort_order)
values
  ('Standard Quote', 'standard', 'Best rate with normal payout speed', '30-60 min', 0.20, 0, 1000000, true, 1),
  ('Fast Payout', 'fast_payout', 'Faster payout with slightly lower rate', '10-15 min', 0.60, 0, 1000000, true, 2),
  ('Priority Settlement', 'priority', 'Priority handling for verified sellers', 'Under 10 min', 0.90, 5000, 1000000, true, 3),
  ('Bulk OTC Quote', 'bulk_otc', 'Custom handling for large-volume sellers', 'Custom', 0, 50000, null, true, 4)
on conflict do nothing;

insert into public.coin_rates (coin_symbol, network, buy_rate_inr, spread_percent, is_active)
values
  ('USDT', 'TRC20', 83.15000000, 0.25, true),
  ('USDT', 'ERC20', 83.10000000, 0.30, true),
  ('BTC', 'BITCOIN', 6000000.00000000, 0.40, true),
  ('ETH', 'ERC20', 250000.00000000, 0.45, true),
  ('SOL', 'SOLANA', 14000.00000000, 0.60, true)
on conflict (coin_symbol, network) do nothing;

insert into public.quote_slabs (quote_type, coin_symbol, network, min_amount, max_amount, rate_inr, is_enabled)
values
  ('standard', 'USDT', 'TRC20', 0, 999, 82.90, true),
  ('standard', 'USDT', 'TRC20', 1000, 9999, 83.10, true),
  ('standard', 'USDT', 'TRC20', 10000, null, 83.25, true),
  ('fast_payout', 'USDT', 'TRC20', 0, 999, 82.50, true),
  ('fast_payout', 'USDT', 'TRC20', 1000, 9999, 82.80, true),
  ('fast_payout', 'USDT', 'TRC20', 10000, null, 83.00, true)
on conflict do nothing;


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


-- =====================================================
-- SELLER AUTH / REGISTER FIX POLICIES
-- Run if seller register/login cannot create or read profile.
-- =====================================================

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin
on public.profiles
for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

-- Allow referral code lookup during registration.
drop policy if exists profiles_public_referral_lookup on public.profiles;
create policy profiles_public_referral_lookup
on public.profiles
for select
to anon, authenticated
using (referral_code is not null);


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


-- REFERRAL SYSTEM FINAL FIX
create extension if not exists pgcrypto;
alter table public.profiles add column if not exists referral_code text, add column if not exists referred_by uuid;
create unique index if not exists idx_profiles_referral_code_unique on public.profiles(referral_code) where referral_code is not null;
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
create policy referral_rewards_select_own_or_admin on public.referral_rewards for select to authenticated using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());
drop policy if exists referral_rewards_insert_admin on public.referral_rewards;
create policy referral_rewards_insert_admin on public.referral_rewards for insert to authenticated with check (public.is_admin());
drop policy if exists referral_rewards_update_admin on public.referral_rewards;
create policy referral_rewards_update_admin on public.referral_rewards for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists referral_withdrawals_select_own_or_admin on public.referral_withdrawals;
create policy referral_withdrawals_select_own_or_admin on public.referral_withdrawals for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists referral_withdrawals_insert_own on public.referral_withdrawals;
create policy referral_withdrawals_insert_own on public.referral_withdrawals for insert to authenticated with check (user_id = auth.uid() and amount_inr >= 2000);
drop policy if exists referral_withdrawals_update_admin on public.referral_withdrawals;
create policy referral_withdrawals_update_admin on public.referral_withdrawals for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_public_referral_lookup on public.profiles;
create policy profiles_public_referral_lookup on public.profiles for select to anon, authenticated using (referral_code is not null);


-- PAYOUT DETAILS FINAL FIX
-- Adds flat payout columns to sell_orders so admin can always see holder name, bank, account, IFSC, UPI.
alter table public.sell_orders
add column if not exists payout_account_holder_name text,
add column if not exists payout_bank_name text,
add column if not exists payout_account_number text,
add column if not exists payout_ifsc_code text,
add column if not exists payout_upi_id text;

alter table public.bank_accounts
add column if not exists account_holder_name text,
add column if not exists bank_name text,
add column if not exists account_number text,
add column if not exists ifsc_code text,
add column if not exists upi_id text,
add column if not exists payment_method text default 'bank',
add column if not exists label text,
add column if not exists is_primary boolean default false,
add column if not exists is_active boolean default true;

-- Backfill old orders from payout_details JSON if available.
update public.sell_orders
set
  payout_account_holder_name = coalesce(payout_account_holder_name, payout_details->>'account_holder_name'),
  payout_bank_name = coalesce(payout_bank_name, payout_details->>'bank_name'),
  payout_account_number = coalesce(payout_account_number, payout_details->>'account_number'),
  payout_ifsc_code = coalesce(payout_ifsc_code, payout_details->>'ifsc_code'),
  payout_upi_id = coalesce(payout_upi_id, payout_details->>'upi_id')
where payout_details is not null;


-- SELLER CANCEL PENDING ORDER FIX
-- Allows seller to cancel their own order only before TX hash is submitted.
alter table public.sell_orders
add column if not exists cancelled_at timestamptz;

drop policy if exists sell_orders_seller_cancel_before_tx on public.sell_orders;
create policy sell_orders_seller_cancel_before_tx
on public.sell_orders
for update
to authenticated
using (
  user_id = auth.uid()
  and tx_hash is null
  and status in ('awaiting_transfer','awaiting_kyc','quote_selected')
)
with check (
  user_id = auth.uid()
  and tx_hash is null
  and status = 'cancelled'
);


-- DUPLICATE TX HASH FINAL FIX
-- Prevent same transaction hash from being used in more than one sell order.
-- This unique index ignores blank/null TX hashes and treats lowercase/uppercase as the same.

create unique index if not exists sell_orders_unique_tx_hash_not_empty
on public.sell_orders (lower(trim(tx_hash)))
where tx_hash is not null and trim(tx_hash) <> '';


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


-- REFERRAL WITHDRAWAL PAYOUT METHOD SAFE CHECK
-- Optional safe SQL if payout fields are missing.

alter table public.referral_withdrawals
add column if not exists payout_method_id uuid,
add column if not exists payout_label text,
add column if not exists payout_details jsonb default '{}'::jsonb;
