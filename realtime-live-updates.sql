
-- SUPABASE REALTIME ENABLE FOR LIVE SELLER/ADMIN UPDATES
-- Run this in Supabase SQL Editor.
-- If a table is already added to publication, the DO block skips it.

do $$
declare
  tbl text;
  tables text[] := array[
    'sell_orders',
    'order_batches',
    'kyc_submissions',
    'referral_rewards',
    'referral_withdrawals',
    'batch_waitlist',
    'bank_accounts',
    'quote_slabs',
    'wallet_pools'
  ];
begin
  foreach tbl in array tables loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tbl
    ) then
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end if;
  end loop;
end $$;
