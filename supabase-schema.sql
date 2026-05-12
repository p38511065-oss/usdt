-- =========================================================
-- CRYPTO SELL TO INR DESK - SUPABASE STARTER SCHEMA
-- =========================================================

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('seller', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'kyc_status') then
    create type public.kyc_status as enum ('not_submitted', 'pending', 'verified', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type public.user_status as enum ('active', 'suspended', 'blocked');
  end if;
  if not exists (select 1 from pg_type where typname = 'quote_type') then
    create type public.quote_type as enum ('standard', 'fast_payout', 'priority', 'bulk_otc');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('quote_selected','awaiting_kyc','awaiting_transfer','awaiting_confirmations','payout_in_progress','completed','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'reward_status') then
    create type public.reward_status as enum ('pending', 'approved', 'paid', 'rejected');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_referral_code text;
begin
  v_referral_code := upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8));
  insert into public.profiles (id, full_name, email, mobile, role, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'mobile', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'seller'),
    v_referral_code
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_holder_name text not null,
  bank_name text not null,
  account_number text not null,
  ifsc_code text not null,
  is_primary boolean not null default false,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
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
create trigger trg_quote_templates_updated_at before update on public.quote_templates for each row execute function public.set_updated_at();

create table if not exists public.wallet_pools (
  id uuid primary key default gen_random_uuid(),
  coin_symbol text not null,
  network text not null,
  wallet_address text not null,
  label text,
  is_active boolean not null default true,
  rotate_daily boolean not null default false,
  last_rotated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
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
create trigger trg_sell_orders_updated_at before update on public.sell_orders for each row execute function public.set_updated_at();

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
alter table public.wallet_pools enable row level security;
alter table public.sell_orders enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own_or_admin" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "bank_accounts_select_own_or_admin" on public.bank_accounts for select using (user_id = auth.uid() or public.is_admin());
create policy "bank_accounts_insert_own_or_admin" on public.bank_accounts for insert with check (user_id = auth.uid() or public.is_admin());
create policy "bank_accounts_update_own_or_admin" on public.bank_accounts for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "bank_accounts_delete_own_or_admin" on public.bank_accounts for delete using (user_id = auth.uid() or public.is_admin());

create policy "coin_rates_select_authenticated" on public.coin_rates for select to authenticated using (true);
create policy "coin_rates_admin_all" on public.coin_rates for all using (public.is_admin()) with check (public.is_admin());

create policy "quote_templates_select_authenticated" on public.quote_templates for select to authenticated using (is_enabled = true or public.is_admin());
create policy "quote_templates_admin_all" on public.quote_templates for all using (public.is_admin()) with check (public.is_admin());

create policy "wallet_pools_admin_all" on public.wallet_pools for all using (public.is_admin()) with check (public.is_admin());

create policy "sell_orders_select_own_or_admin" on public.sell_orders for select using (user_id = auth.uid() or public.is_admin());
create policy "sell_orders_insert_own_or_admin" on public.sell_orders for insert with check (user_id = auth.uid() or public.is_admin());
create policy "sell_orders_update_own_or_admin" on public.sell_orders for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "referral_rewards_select_own_or_admin" on public.referral_rewards for select using (referrer_user_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());
create policy "referral_rewards_admin_all" on public.referral_rewards for all using (public.is_admin()) with check (public.is_admin());

create policy "audit_logs_admin_only" on public.audit_logs for all using (public.is_admin()) with check (public.is_admin());

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
