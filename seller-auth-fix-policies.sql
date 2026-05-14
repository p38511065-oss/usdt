
-- =====================================================
-- SELLER AUTH / REGISTER FIX POLICIES
-- Run if seller register/login cannot create or read profile.
-- =====================================================

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin
on public.profiles
for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

-- Allow referral code lookup during registration.
drop policy if exists profiles_public_referral_lookup on public.profiles;
create policy profiles_public_referral_lookup
on public.profiles
for select
to anon, authenticated
using (referral_code is not null);
