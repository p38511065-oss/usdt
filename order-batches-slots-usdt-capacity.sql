
-- ORDER BATCH SLOTS + USDT CAPACITY SYSTEM
-- Run this in Supabase SQL Editor before using batch controls.

create table if not exists public.order_batches (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null default 'USDT/TRC20 Batch',
  order_limit integer not null default 0,
  used_orders integer not null default 0,
  usdt_capacity numeric not null default 0,
  used_usdt numeric not null default 0,
  message text,
  status text not null default 'active',
  accept_orders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batch_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  requested_usdt numeric,
  message text,
  status text not null default 'waiting',
  created_at timestamptz not null default now()
);

alter table public.sell_orders
add column if not exists batch_id uuid references public.order_batches(id);

alter table public.order_batches enable row level security;
alter table public.batch_waitlist enable row level security;

drop policy if exists "Public read active order batches" on public.order_batches;
create policy "Public read active order batches"
on public.order_batches
for select
using (true);

drop policy if exists "Authenticated insert batch waitlist" on public.batch_waitlist;
create policy "Authenticated insert batch waitlist"
on public.batch_waitlist
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users read own batch waitlist" on public.batch_waitlist;
create policy "Users read own batch waitlist"
on public.batch_waitlist
for select
using (auth.uid() = user_id);

-- Admin updates/inserts may already be allowed by your current testing policies.
-- If admin batch buttons give permission error during testing, run these permissive admin-testing policies:
drop policy if exists "Authenticated manage order batches testing" on public.order_batches;
create policy "Authenticated manage order batches testing"
on public.order_batches
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read waitlist testing" on public.batch_waitlist;
create policy "Authenticated read waitlist testing"
on public.batch_waitlist
for select
using (auth.role() = 'authenticated');
