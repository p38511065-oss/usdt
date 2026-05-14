
-- DUPLICATE TX HASH FINAL FIX
-- Prevent same transaction hash from being used in more than one sell order.
-- This unique index ignores blank/null TX hashes and treats lowercase/uppercase as the same.

create unique index if not exists sell_orders_unique_tx_hash_not_empty
on public.sell_orders (lower(trim(tx_hash)))
where tx_hash is not null and trim(tx_hash) <> '';
