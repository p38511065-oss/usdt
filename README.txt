Crypto Sell to INR Desk - Updated Supabase Starter

What is updated in this version
- Seller and admin both use sidebar dashboard layouts
- Seller payout methods: Bank + UPI
- Seller KYC submit form added
- Admin KYC accept/reject/view added
- Quote amount slab system added
- Wallet QR upload supported
- Admin and seller use separate Supabase auth storage keys, so both can stay logged in on the same browser without forcing each other to log out

Important
1) Run supabase-schema.sql again in Supabase SQL Editor so new tables and policies are added:
   - kyc_submissions
   - quote_slabs
2) Keep only supabase-config.js in root.
3) Upload all root files to GitHub / Cloudflare.

Main pages
- index.html
- login.html
- admin-login.html
- dashboard.html
- admin.html
- referrals.html

Notes
- Admin login uses a separate auth session key from seller login.
- If you already have old files deployed, replace them fully and redeploy.
