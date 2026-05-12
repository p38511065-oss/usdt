CRYPTO SELL TO INR DESK - GITHUB + CLOUDFLARE + SUPABASE STARTER
=================================================================

ROOT FILES INCLUDED
- index.html
- login.html
- dashboard.html
- referrals.html
- admin.html
- styles.css
- main.js
- supabase-schema.sql
- supabase-config.example.js
- README.txt

IMPORTANT
This is a Supabase-connected starter base.
It is not a production-hardened launch build.

WHAT WORKS IN THIS STARTER
- Seller signup/login with Supabase Auth
- Seller dashboard
- Quote selection from quote templates + coin rates
- Sell order creation
- Referral dashboard
- Admin panel base for quote templates, rates, wallets, users and orders
- Supabase SQL schema included

BEFORE GITHUB UPLOAD
1. Create a Supabase project.
2. In Supabase SQL Editor, run supabase-schema.sql
3. In Auth settings, enable Email + Password sign-in.
4. Create one user account from login page or Supabase Auth.
5. In profiles table, manually change that first user's role from seller to admin.
6. Copy supabase-config.example.js and rename the copy to supabase-config.js if you want.
7. Put your real Supabase URL and anon key in the config file.
8. In every HTML file, either:
   - keep using supabase-config.example.js after editing it, OR
   - replace script tag name with supabase-config.js

HOW TO USE ON GITHUB + CLOUDFLARE PAGES
1. Upload all root files to your GitHub repo.
2. Connect repo with Cloudflare Pages.
3. Since this is static HTML/CSS/JS, build command is not required.
4. Output directory can stay root.
5. Deploy.

VERY IMPORTANT LIMITATIONS
- No real KYC provider integration yet
- No real bank payout integration yet
- No blockchain confirmation automation yet
- No secure server-side admin API yet
- Admin actions currently happen directly from frontend using Supabase policies

RECOMMENDED NEXT UPGRADE
- Move sensitive admin actions to Cloudflare Workers
- Add stronger validation
- Add storage for KYC docs
- Add proper bank account masking/encryption plan
- Add payout workflow and blockchain monitoring

