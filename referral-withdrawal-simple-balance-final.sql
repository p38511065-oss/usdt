
-- REFERRAL WITHDRAWAL SIMPLE BALANCE LOGIC - FINAL
-- Logic: Remaining Balance = Total Rewards - Total Withdrawal Requests.
-- Withdrawal request can never be greater than remaining balance.

drop trigger if exists trg_validate_referral_withdrawal_request on public.referral_withdrawals;
drop function if exists public.validate_referral_withdrawal_request();
drop index if exists public.referral_withdrawals_one_active_per_user;

create or replace function public.validate_referral_withdrawal_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_rewards numeric := 0;
  total_withdrawals numeric := 0;
  remaining_balance numeric := 0;
begin
  if new.status is null then
    new.status := 'requested';
  end if;

  if new.amount_inr is null or new.amount_inr < 2000 then
    raise exception 'Minimum referral withdrawal is ₹2,000.';
  end if;

  select coalesce(sum(coalesce(reward_amount_inr,0)), 0)
  into total_rewards
  from public.referral_rewards
  where referrer_user_id = new.user_id
    and coalesce(reward_status, 'pending') not in ('rejected','cancelled');

  select coalesce(sum(coalesce(amount_inr,0)), 0)
  into total_withdrawals
  from public.referral_withdrawals
  where user_id = new.user_id
    and coalesce(status, 'requested') not in ('rejected','cancelled');

  remaining_balance := total_rewards - total_withdrawals;

  if new.amount_inr > remaining_balance then
    raise exception 'Not enough referral balance. Remaining balance is %', remaining_balance;
  end if;

  return new;
end;
$$;

create trigger trg_validate_referral_withdrawal_request
before insert on public.referral_withdrawals
for each row
execute function public.validate_referral_withdrawal_request();
