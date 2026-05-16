
-- ORDER BATCH SLOTS + USDT CAPACITY SYSTEM - FINAL COUNT FIX
-- Run this full SQL in Supabase SQL Editor.
-- This version adds database triggers so used_orders and used_usdt update automatically when sell order is created.

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

-- Automatic count update when a new sell order is created.
create or replace function public.increment_batch_usage_on_sell_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.batch_id is not null then
    update public.order_batches
    set
      used_orders = coalesce(used_orders, 0) + 1,
      used_usdt = coalesce(used_usdt, 0) + coalesce(new.crypto_amount, 0),
      updated_at = now()
    where id = new.batch_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_increment_batch_usage_on_sell_order on public.sell_orders;

create trigger trg_increment_batch_usage_on_sell_order
after insert on public.sell_orders
for each row
execute function public.increment_batch_usage_on_sell_order();

-- If an order is cancelled/rejected before completion, this returns slot and USDT capacity.
-- Completed orders remain counted.
create or replace function public.adjust_batch_usage_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.batch_id is not null
     and coalesce(old.status::text, '') not in ('cancelled','rejected')
     and coalesce(new.status::text, '') in ('cancelled','rejected') then

    update public.order_batches
    set
      used_orders = greatest(0, coalesce(used_orders, 0) - 1),
      used_usdt = greatest(0, coalesce(used_usdt, 0) - coalesce(old.crypto_amount, 0)),
      updated_at = now()
    where id = old.batch_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_adjust_batch_usage_on_order_cancel on public.sell_orders;

create trigger trg_adjust_batch_usage_on_order_cancel
after update of status on public.sell_orders
for each row
execute function public.adjust_batch_usage_on_order_cancel();

-- Optional repair query:
-- Use this if you already created orders before this trigger and want used counts recalculated from existing non-cancelled orders.
-- Uncomment and run only when needed:
--
-- update public.order_batches b
-- set
--   used_orders = coalesce(x.order_count, 0),
--   used_usdt = coalesce(x.usdt_total, 0),
--   updated_at = now()
-- from (
--   select
--     batch_id,
--     count(*) as order_count,
--     sum(coalesce(crypto_amount, 0)) as usdt_total
--   from public.sell_orders
--   where batch_id is not null
--     and coalesce(status::text, '') not in ('cancelled','rejected')
--   group by batch_id
-- ) x
-- where b.id = x.batch_id;
