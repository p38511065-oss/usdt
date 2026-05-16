
-- REFERRAL WITHDRAWAL ACTIVE REQUEST LOCK
-- Optional but recommended: blocks multiple active referral withdrawal requests per user.
-- User can create a new request only after previous request is paid/rejected/cancelled.

create unique index if not exists referral_withdrawals_one_active_per_user
on public.referral_withdrawals(user_id)
where status in ('requested','approved','processing');
