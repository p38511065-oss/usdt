
-- REFERRAL WITHDRAWAL STRONG BALANCE LOCK
-- Run this in Supabase SQL Editor.
-- It blocks one seller from creating multiple active referral withdrawal requests.

-- First, check if any user already has duplicate active requests:
select
  user_id,
  count(*) as active_requests
from public.referral_withdrawals
where status in ('requested','approved','processing')
group by user_id
having count(*) > 1;

-- If the above query returns rows, mark extra old active requests as rejected.
-- Latest active request stays active; older active requests become rejected.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc
    ) as rn
  from public.referral_withdrawals
  where status in ('requested','approved','processing')
)
update public.referral_withdrawals w
set
  status = 'rejected',
  admin_note = coalesce(admin_note, 'Auto rejected duplicate active withdrawal request')
from ranked r
where w.id = r.id
  and r.rn > 1;

-- Now create database lock: only one active withdrawal per seller.
create unique index if not exists referral_withdrawals_one_active_per_user
on public.referral_withdrawals(user_id)
where status in ('requested','approved','processing');
