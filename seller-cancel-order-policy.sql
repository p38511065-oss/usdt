
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
  and status in ('awaiting_transfer','awaiting_kyc','quote_selected','created')
)
with check (
  user_id = auth.uid()
  and tx_hash is null
  and status = 'cancelled'
);
