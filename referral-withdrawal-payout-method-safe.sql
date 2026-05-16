
-- REFERRAL WITHDRAWAL PAYOUT METHOD SAFE CHECK
-- Optional safe SQL if payout fields are missing.

alter table public.referral_withdrawals
add column if not exists payout_method_id uuid,
add column if not exists payout_label text,
add column if not exists payout_details jsonb default '{}'::jsonb;
