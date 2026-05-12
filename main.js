(function () {
  const hasConfig = window.SUPABASE_URL && window.SUPABASE_URL.includes('supabase.co') && !window.SUPABASE_URL.includes('YOUR-PROJECT');
  const page = document.body.dataset.page || 'home';
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  }));

  if (!hasConfig) {
    const note = document.createElement('div');
    note.className = 'container';
    note.style.padding = '16px 0';
    note.innerHTML = '<div class="card">Supabase config is missing in <code>supabase-config.js</code>. Please check that file if the app does not connect.</div>';
    document.body.prepend(note);
    return;
  }

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.appSupabase = supabase;

  document.querySelectorAll('#logout-btn').forEach(btn => btn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  }));

  async function getSessionUser() {
    const { data } = await supabase.auth.getUser();
    return data.user || null;
  }

  function fmtDate(v) {
    if (!v) return '-';
    return new Date(v).toLocaleString();
  }

  function fmtInr(v) {
    const n = Number(v || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
  }

  function safeText(v) {
    return v == null || v === '' ? '-' : String(v);
  }

  async function getProfile() {
    const user = await getSessionUser();
    if (!user) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data;
  }

  async function ensureAuth() {
    const user = await getSessionUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    return user;
  }

  async function ensureAdmin() {
    await ensureAuth();
    const profile = await getProfile();
    if (!profile || profile.role !== 'admin') {
      alert('Admin access required.');
      window.location.href = 'dashboard.html';
      return null;
    }
    return profile;
  }


  async function loadAdminLoginPage() {
    const btn = document.getElementById('admin-login-btn');
    const msg = document.getElementById('admin-auth-message');
    btn?.addEventListener('click', async () => {
      msg.textContent = 'Logging in...';
      const email = document.getElementById('admin-email').value.trim();
      const password = document.getElementById('admin-password').value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        msg.textContent = error.message;
        return;
      }
      const profile = await getProfile();
      if (profile?.role !== 'admin') {
        msg.textContent = 'This account is not an admin account. Redirecting to seller dashboard...';
        setTimeout(() => window.location.href = 'dashboard.html', 900);
        return;
      }
      window.location.href = 'admin.html';
    });
  }

  async function loadLoginPage() {
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const msg = document.getElementById('auth-message');

    loginBtn?.addEventListener('click', async () => {
      msg.textContent = 'Logging in...';
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        msg.textContent = error.message;
        return;
      }
      const profile = await getProfile();
      window.location.href = profile?.role === 'admin' ? 'admin.html' : 'dashboard.html';
    });

    registerBtn?.addEventListener('click', async () => {
      msg.textContent = 'Creating account...';
      const full_name = document.getElementById('register-name').value.trim();
      const mobile = document.getElementById('register-mobile').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const referralCode = document.getElementById('register-referral').value.trim();

      let referredBy = null;
      if (referralCode) {
        const { data: refProfile } = await supabase.from('profiles').select('id').eq('referral_code', referralCode).maybeSingle();
        referredBy = refProfile?.id || null;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name, mobile, role: 'seller' }
        }
      });

      if (error) {
        msg.textContent = error.message;
        return;
      }

      // update referred_by after profile trigger creates profile
      if (referredBy) {
        setTimeout(async () => {
          const user = await getSessionUser();
          if (user) {
            await supabase.from('profiles').update({ referred_by: referredBy }).eq('id', user.id);
          }
        }, 1500);
      }

      msg.textContent = 'Account created. If email confirmation is enabled, verify email first, then login.';
    });
  }

  async function loadDashboardPage() {
    await ensureAuth();
    const profile = await getProfile();
    document.getElementById('profile-name').textContent = profile.full_name || profile.email || 'Seller';
    document.getElementById('profile-meta').textContent = `${safeText(profile.role)} • KYC: ${safeText(profile.kyc_status)}`;

    const { data: banks } = await supabase.from('bank_accounts').select('*').eq('user_id', profile.id).order('is_primary', { ascending: false });
    const bankSelect = document.getElementById('bank-account-select');
    bankSelect.innerHTML = '';
    if ((banks || []).length === 0) {
      bankSelect.innerHTML = '<option value="">No bank account found</option>';
    } else {
      banks.forEach(bank => {
        const opt = document.createElement('option');
        opt.value = bank.id;
        opt.textContent = `${bank.bank_name} - ${bank.account_number}`;
        bankSelect.appendChild(opt);
      });
    }

    const { data: rates } = await supabase.from('coin_rates').select('*').eq('is_active', true).order('coin_symbol');
    const coinSel = document.getElementById('sell-coin');
    const netSel = document.getElementById('sell-network');
    const uniqueCoins = [...new Set((rates || []).map(r => r.coin_symbol))];
    coinSel.innerHTML = uniqueCoins.map(c => `<option value="${c}">${c}</option>`).join('');

    function refreshNetworks() {
      const selectedCoin = coinSel.value;
      const networks = (rates || []).filter(r => r.coin_symbol === selectedCoin).map(r => r.network);
      netSel.innerHTML = networks.map(n => `<option value="${n}">${n}</option>`).join('');
    }
    coinSel.addEventListener('change', refreshNetworks);
    refreshNetworks();

    document.getElementById('show-quotes-btn').addEventListener('click', async () => {
      const coin = coinSel.value;
      const network = netSel.value;
      const amount = Number(document.getElementById('sell-amount').value || 0);
      const bankId = bankSelect.value;
      const msg = document.getElementById('quote-calc-message');
      if (!coin || !network || !amount || !bankId) {
        msg.textContent = 'Please select coin, network, amount and bank account.';
        return;
      }
      const rateRow = (rates || []).find(r => r.coin_symbol === coin && r.network === network);
      if (!rateRow) {
        msg.textContent = 'No active rate found for selected coin/network.';
        return;
      }
      const { data: templates } = await supabase.from('quote_templates').select('*').eq('is_enabled', true).order('sort_order');
      const matched = (templates || []).filter(t => {
        const minOk = t.min_amount_usdt == null || amount >= Number(t.min_amount_usdt);
        const maxOk = t.max_amount_usdt == null || amount <= Number(t.max_amount_usdt);
        return minOk && maxOk;
      });
      const box = document.getElementById('quotes-container');
      box.innerHTML = '';
      if (!matched.length) {
        msg.textContent = 'No quote template available for this amount.';
        return;
      }
      msg.textContent = 'Quotes ready. Select one below.';
      matched.forEach((t, i) => {
        const finalSpread = Number(rateRow.spread_percent || 0) + Number(t.extra_spread_percent || 0);
        const lockedRate = Number(rateRow.buy_rate_inr) * (1 - finalSpread / 100);
        const estInr = lockedRate * amount;
        const card = document.createElement('div');
        card.className = `quote-card ${i === 0 ? 'recommended' : ''}`;
        card.innerHTML = `
          <span class="badge">${t.quote_name}</span>
          <h4>${t.description || t.quote_type}</h4>
          <p class="meta">Payout: ${safeText(t.payout_time_label)}</p>
          <p><strong>Rate:</strong> ${fmtInr(lockedRate)}</p>
          <p><strong>Estimated INR:</strong> ${fmtInr(estInr)}</p>
          <p><strong>Total Spread:</strong> ${finalSpread.toFixed(4)}%</p>
          <button class="btn btn-primary choose-quote">Select Quote</button>
        `;
        card.querySelector('.choose-quote').addEventListener('click', async () => {
          const { data: activeWallets } = await supabase.from('wallet_pools').select('*').eq('coin_symbol', coin).eq('network', network).eq('is_active', true).limit(1);
          const wallet = activeWallets?.[0];
          const { error } = await supabase.from('sell_orders').insert({
            user_id: profile.id,
            bank_account_id: bankId,
            quote_template_id: t.id,
            coin_symbol: coin,
            network,
            crypto_amount: amount,
            locked_rate_inr: lockedRate,
            spread_percent: finalSpread,
            estimated_inr_payout: estInr,
            deposit_wallet_address: wallet?.wallet_address || null,
            status: profile.kyc_status === 'verified' ? 'awaiting_transfer' : 'awaiting_kyc'
          });
          if (error) {
            alert(error.message);
            return;
          }
          await loadOrders(profile.id);
          alert('Sell order created successfully.');
        });
        box.appendChild(card);
      });
    });

    await loadOrders(profile.id);
  }

  async function loadOrders(profileId) {
    const { data: orders } = await supabase.from('sell_orders').select('*').eq('user_id', profileId).order('created_at', { ascending: false });
    const body = document.getElementById('orders-body');
    const latest = document.getElementById('latest-order-box');
    body.innerHTML = '';
    if (!(orders || []).length) {
      body.innerHTML = '<tr><td colspan="7">No orders yet.</td></tr>';
      latest.textContent = 'No recent order yet.';
      return;
    }
    orders.forEach(order => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="code-small">${order.id}</td>
        <td>${order.coin_symbol} / ${order.network}</td>
        <td>${order.crypto_amount}</td>
        <td>${fmtInr(order.locked_rate_inr)}</td>
        <td>${fmtInr(order.estimated_inr_payout)}</td>
        <td><span class="badge">${order.status}</span></td>
        <td>${fmtDate(order.created_at)}</td>
      `;
      body.appendChild(tr);
    });
    const order = orders[0];
    latest.innerHTML = `
      <p><strong>Order:</strong> ${order.id}</p>
      <p><strong>Status:</strong> ${order.status}</p>
      <p><strong>Deposit Wallet:</strong> ${safeText(order.deposit_wallet_address)}</p>
      <p><strong>Confirmations:</strong> ${order.confirmations_received}/${order.confirmations_required}</p>
      <p><strong>Estimated INR:</strong> ${fmtInr(order.estimated_inr_payout)}</p>
    `;
  }

  async function loadReferralsPage() {
    await ensureAuth();
    const profile = await getProfile();
    const origin = window.location.origin.includes('http') ? window.location.origin : '';
    const refCode = profile.referral_code || '-';
    const refLink = `${origin}/login.html?ref=${refCode}`;
    document.getElementById('ref-code-box').textContent = refCode;
    document.getElementById('ref-link-box').textContent = refLink;
    document.getElementById('copy-ref-code').onclick = () => navigator.clipboard.writeText(refCode);
    document.getElementById('copy-ref-link').onclick = () => navigator.clipboard.writeText(refLink);

    const { data: referredUsers } = await supabase.from('profiles').select('id,user_status').eq('referred_by', profile.id);
    const { data: rewards } = await supabase.from('referral_rewards').select('*, referred_user:referred_user_id(full_name,email)').eq('referrer_user_id', profile.id).order('created_at', { ascending: false });
    document.getElementById('stat-total-referrals').textContent = String((referredUsers || []).length);
    document.getElementById('stat-active-referrals').textContent = String((referredUsers || []).filter(u => u.user_status === 'active').length);
    const totalEarned = (rewards || []).reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    const pendingEarned = (rewards || []).filter(r => r.reward_status === 'pending').reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    document.getElementById('stat-ref-earnings').textContent = fmtInr(totalEarned);
    document.getElementById('stat-pending-rewards').textContent = fmtInr(pendingEarned);

    const body = document.getElementById('referrals-body');
    body.innerHTML = '';
    if (!(rewards || []).length) {
      body.innerHTML = '<tr><td colspan="6">No referral rewards yet.</td></tr>';
      return;
    }
    rewards.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${safeText(r.referred_user?.full_name || r.referred_user?.email)}</td>
        <td class="code-small">${safeText(r.order_id)}</td>
        <td>${Number(r.reward_percent).toFixed(4)}%</td>
        <td>${fmtInr(r.reward_amount_inr)}</td>
        <td><span class="badge ${r.reward_status === 'pending' ? 'warn' : ''}">${r.reward_status}</span></td>
        <td>${fmtDate(r.created_at)}</td>
      `;
      body.appendChild(tr);
    });
  }

  async function loadAdminPage() {
    const profile = await ensureAdmin();
    if (!profile) return;
    document.getElementById('admin-name').textContent = profile.full_name || profile.email || 'Admin';

    await Promise.all([
      loadAdminStats(),
      loadAdminQuotes(),
      loadAdminRates(),
      loadAdminWallets(),
      loadAdminUsers(),
      loadAdminOrders()
    ]);

    document.getElementById('add-quote-template').onclick = async () => {
      const payload = {
        quote_name: val('qt-name'),
        quote_type: val('qt-type'),
        payout_time_label: val('qt-payout'),
        extra_spread_percent: Number(val('qt-spread') || 0),
        is_enabled: true
      };
      const { error } = await supabase.from('quote_templates').insert(payload);
      if (error) return alert(error.message);
      clearFields('qt-name','qt-payout','qt-spread');
      await loadAdminQuotes();
    };

    document.getElementById('add-coin-rate').onclick = async () => {
      const payload = {
        coin_symbol: val('rate-coin').toUpperCase(),
        network: val('rate-network').toUpperCase(),
        buy_rate_inr: Number(val('rate-buy') || 0),
        spread_percent: Number(val('rate-spread') || 0),
        is_active: true,
        updated_by: profile.id
      };
      const { error } = await supabase.from('coin_rates').upsert(payload, { onConflict: 'coin_symbol,network' });
      if (error) return alert(error.message);
      clearFields('rate-coin','rate-network','rate-buy','rate-spread');
      await loadAdminRates();
    };

    document.getElementById('add-wallet').onclick = async () => {
      const payload = {
        coin_symbol: val('wallet-coin').toUpperCase(),
        network: val('wallet-network').toUpperCase(),
        wallet_address: val('wallet-address'),
        label: val('wallet-label'),
        is_active: true,
        rotate_daily: false,
        created_by: profile.id
      };
      const { error } = await supabase.from('wallet_pools').insert(payload);
      if (error) return alert(error.message);
      clearFields('wallet-coin','wallet-network','wallet-address','wallet-label');
      await loadAdminWallets();
    };
  }

  function val(id) { return document.getElementById(id).value.trim(); }
  function clearFields(...ids) { ids.forEach(id => document.getElementById(id).value = ''); }

  async function loadAdminStats() {
    const [{ count: usersCount }, { count: ordersCount }, { count: kycPending }, { data: completedOrders }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('sell_orders').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
      supabase.from('sell_orders').select('estimated_inr_payout,status').eq('status', 'completed')
    ]);
    const completedVolume = (completedOrders || []).reduce((s, r) => s + Number(r.estimated_inr_payout || 0), 0);
    document.getElementById('admin-stats').innerHTML = `
      <div class="card stat-card"><strong>${usersCount || 0}</strong><span>Total Users</span></div>
      <div class="card stat-card"><strong>${ordersCount || 0}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>${kycPending || 0}</strong><span>Pending KYC</span></div>
      <div class="card stat-card"><strong>${fmtInr(completedVolume)}</strong><span>Completed Volume</span></div>
    `;
  }

  async function loadAdminQuotes() {
    const { data } = await supabase.from('quote_templates').select('*').order('sort_order');
    const body = document.getElementById('admin-quotes-body');
    body.innerHTML = '';
    (data || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.quote_name}</td><td>${row.quote_type}</td><td>${row.payout_time_label}</td><td>${row.extra_spread_percent}</td><td>${row.is_enabled ? 'enabled' : 'disabled'}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadAdminRates() {
    const { data } = await supabase.from('coin_rates').select('*').order('coin_symbol');
    const body = document.getElementById('admin-rates-body');
    body.innerHTML = '';
    (data || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.coin_symbol}</td><td>${row.network}</td><td>${fmtInr(row.buy_rate_inr)}</td><td>${row.spread_percent}</td><td>${row.is_active ? 'active' : 'inactive'}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadAdminWallets() {
    const { data } = await supabase.from('wallet_pools').select('*').order('created_at', { ascending: false });
    const body = document.getElementById('admin-wallets-body');
    body.innerHTML = '';
    (data || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.coin_symbol}</td><td>${row.network}</td><td class="code-small">${row.wallet_address}</td><td>${row.rotate_daily ? 'yes' : 'no'}</td><td>${row.is_active ? 'active' : 'inactive'}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadAdminUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    const body = document.getElementById('admin-users-body');
    body.innerHTML = '';
    (data || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${safeText(row.full_name)}</td><td>${safeText(row.email)}</td><td>${safeText(row.mobile)}</td><td>${row.kyc_status}</td><td>${row.role}</td><td>${row.user_status}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadAdminOrders() {
    const { data } = await supabase.from('sell_orders').select('*, profiles!sell_orders_user_id_fkey(full_name,email)').order('created_at', { ascending: false });
    const body = document.getElementById('admin-orders-body');
    body.innerHTML = '';
    (data || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="code-small">${row.id}</td>
        <td>${safeText(row.profiles?.full_name || row.profiles?.email)}</td>
        <td>${row.coin_symbol}/${row.network}</td>
        <td>${row.crypto_amount}</td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td>${row.status}</td>
        <td></td>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Mark Completed';
      btn.onclick = async () => {
        const { error } = await supabase.from('sell_orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', row.id);
        if (error) return alert(error.message);
        await loadAdminOrders();
      };
      tr.lastElementChild.appendChild(btn);
      body.appendChild(tr);
    });
  }

  if (page === 'login') loadLoginPage();
  if (page === 'admin-login') loadAdminLoginPage();
  if (page === 'dashboard') loadDashboardPage();
  if (page === 'referrals') loadReferralsPage();
  if (page === 'admin') loadAdminPage();
})();
