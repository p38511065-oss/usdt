
-- REFERRAL WITHDRAWAL FINAL BALANCE GUARD
-- This prevents repeated withdrawal requests greater than available referral balance.

create or replace function public.validate_referral_withdrawal_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_rewards numeric := 0;
  total_withdrawals numeric := 0;
  available_balance numeric := 0;
  active_count integer := 0;
begin
  if new.status is null then
    new.status := 'requested';
  end if;

  if new.amount_inr is null or new.amount_inr < 2000 then
    raise exception 'Minimum referral withdrawal is ₹2,000.';
  end if;

  select count(*)
  into active_count
  from public.referral_withdrawals
  where user_id = new.user_id
    and status in ('requested','approved','processing');

  if active_count > 0 then
    raise exception 'You already have an active withdrawal request. Please wait for admin action.';
  end if;

  select coalesce(sum(reward_amount_inr), 0)
  into total_rewards
  from public.referral_rewards
  where referrer_user_id = new.user_id
    and coalesce(reward_status, 'pending') not in ('rejected','cancelled');

  select coalesce(sum(amount_inr), 0)
  into total_withdrawals
  from public.referral_withdrawals
  where user_id = new.user_id
    and coalesce(status, 'requested') not in ('rejected','cancelled');

  available_balance := total_rewards - total_withdrawals;

  if new.amount_inr > available_balance then
    raise exception 'Not enough referral balance. Available balance is %', available_balance;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_referral_withdrawal_request on public.referral_withdrawals;

create trigger trg_validate_referral_withdrawal_request
before insert on public.referral_withdrawals
for each row
execute function public.validate_referral_withdrawal_request();

-- Also keep database lock for one active request per seller.
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

create unique index if not exists referral_withdrawals_one_active_per_user
on public.referral_withdrawals(user_id)
where status in ('requested','approved','processing');
