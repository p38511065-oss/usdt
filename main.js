(function () {
  const page = document.body.dataset.page || 'home';
  const hasConfig = window.SUPABASE_URL && window.SUPABASE_URL.includes('supabase.co');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target)?.classList.add('active');
    });
  });

  if (!hasConfig) {
    console.warn('Supabase config missing');
    return;
  }

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.appSupabase = supabase;

  function qs(id) { return document.getElementById(id); }
  function val(id) { return qs(id)?.value?.trim() || ''; }
  function setText(id, text) { const el = qs(id); if (el) el.textContent = text; }
  function setHtml(id, html) { const el = qs(id); if (el) el.innerHTML = html; }
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }
  function fmtDate(v) { return v ? new Date(v).toLocaleString() : '-'; }
  function fmtInr(v) {
    const n = Number(v || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
  }
  function safeText(v) { return v == null || v === '' ? '-' : String(v); }
  function chip(value) {
    const raw = String(value || '').toLowerCase();
    const klass = raw.includes('block') || raw.includes('reject') || raw.includes('cancel') || raw.includes('suspend') ? 'blocked' : raw.includes('pending') || raw.includes('inactive') ? 'pending' : 'active';
    return `<span class="status-chip ${klass}">${escapeHtml(value)}</span>`;
  }
  function bindSidebar() {
    document.querySelectorAll('.side-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.side-link').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel-section').forEach((s) => s.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.target;
        document.getElementById(target)?.classList.add('active');
        if (history.replaceState) history.replaceState(null, '', '#' + target);
      });
    });
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const btn = document.querySelector(`.side-link[data-target="${hash}"]`);
      btn?.click();
    }
  }

  document.querySelectorAll('#logout-btn').forEach((btn) => btn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = page === 'admin-dashboard' ? 'admin-login.html' : 'login.html';
  }));

  async function getSessionUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
  }

  async function getProfile() {
    const user = await getSessionUser();
    if (!user) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data;
  }

  async function ensureAuth(loginPage = 'login.html') {
    const user = await getSessionUser();
    if (!user) {
      window.location.href = loginPage;
      return null;
    }
    return user;
  }

  async function ensureAdmin() {
    const user = await ensureAuth('admin-login.html');
    if (!user) return null;
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error || !profile || profile.role !== 'admin') {
      alert('Admin access required.');
      window.location.href = 'dashboard.html';
      return null;
    }
    return profile;
  }

  async function audit(action, entityType, entityId, meta) {
    try {
      const user = await getSessionUser();
      if (!user) return;
      await supabase.from('audit_logs').insert({ actor_user_id: user.id, action, entity_type: entityType, entity_id: entityId ? String(entityId) : null, meta: meta || {} });
    } catch (e) {
      console.warn('audit failed', e.message);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadLoginPage() {
    qs('login-btn')?.addEventListener('click', async () => {
      setText('auth-message', 'Logging in...');
      const { error } = await supabase.auth.signInWithPassword({ email: val('login-email'), password: qs('login-password').value });
      if (error) return setText('auth-message', error.message);
      const profile = await getProfile();
      window.location.href = profile?.role === 'admin' ? 'admin.html' : 'dashboard.html';
    });

    qs('register-btn')?.addEventListener('click', async () => {
      setText('auth-message', 'Creating account...');
      const full_name = val('register-name');
      const mobile = val('register-mobile');
      const email = val('register-email');
      const password = qs('register-password').value;
      const referralCode = val('register-referral');
      if (!full_name || !mobile || !email || !password) return setText('auth-message', 'Please fill all required fields.');
      let referredBy = null;
      if (referralCode) {
        const { data: refProfile } = await supabase.from('profiles').select('id').eq('referral_code', referralCode).maybeSingle();
        referredBy = refProfile?.id || null;
      }
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name, mobile, role: 'seller' } }
      });
      if (error) return setText('auth-message', error.message);
      if (referredBy) {
        setTimeout(async () => {
          try {
            const user = await getSessionUser();
            if (user) await supabase.from('profiles').update({ referred_by: referredBy }).eq('id', user.id);
          } catch (e) {}
        }, 1200);
      }
      setText('auth-message', 'Account created successfully. Now login.');
    });
  }

  async function loadAdminLoginPage() {
    qs('admin-login-btn')?.addEventListener('click', async () => {
      setText('admin-auth-message', 'Logging in...');
      const { error } = await supabase.auth.signInWithPassword({ email: val('admin-email'), password: qs('admin-password').value });
      if (error) return setText('admin-auth-message', error.message);
      const profile = await getProfile();
      if (profile?.role !== 'admin') {
        setText('admin-auth-message', 'This account is not admin.');
        setTimeout(() => window.location.href = 'dashboard.html', 1000);
        return;
      }
      window.location.href = 'admin.html';
    });
  }

  async function loadSellerDashboard() {
    const user = await ensureAuth('login.html');
    if (!user) return;
    bindSidebar();
    const profile = await getProfile();
    if (profile?.role === 'admin') {
      setText('seller-top-name', `${profile.full_name || profile.email} · admin`);
    } else {
      setText('seller-top-name', profile.full_name || profile.email || 'Seller');
    }
    renderProfileBoxes(profile);
    await Promise.all([
      loadSellerPayoutAccounts(profile),
      loadSellerStats(profile),
      loadReferralsSection(profile),
      loadRatesAndQuotes(profile)
    ]);
  }

  function renderProfileBoxes(profile) {
    const profileHtml = `
      <div class="kv-row"><span>Name</span><strong>${escapeHtml(profile.full_name || '-')}</strong></div>
      <div class="kv-row"><span>Email</span><strong>${escapeHtml(profile.email || '-')}</strong></div>
      <div class="kv-row"><span>Mobile</span><strong>${escapeHtml(profile.mobile || '-')}</strong></div>
      <div class="kv-row"><span>Role</span><strong>${escapeHtml(profile.role)}</strong></div>
      <div class="kv-row"><span>User Status</span><strong>${escapeHtml(profile.user_status)}</strong></div>`;
    setHtml('profile-box', profileHtml);
    setHtml('kyc-status-box', `Current KYC status: <strong>${escapeHtml(profile.kyc_status)}</strong>`);
    setHtml('seller-quick-status', `
      <div class="kv-row"><span>Seller</span><strong>${escapeHtml(profile.full_name || profile.email || 'Seller')}</strong></div>
      <div class="kv-row"><span>KYC</span><strong>${escapeHtml(profile.kyc_status)}</strong></div>
      <div class="kv-row"><span>Status</span><strong>${escapeHtml(profile.user_status)}</strong></div>
      <div class="kv-row"><span>Referral Code</span><strong>${escapeHtml(profile.referral_code || '-')}</strong></div>
    `);
  }

  async function loadSellerStats(profile) {
    const [{ data: orders }, { data: accounts }, { data: rewards }] = await Promise.all([
      supabase.from('sell_orders').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('bank_accounts').select('*').eq('user_id', profile.id).eq('is_active', true),
      supabase.from('referral_rewards').select('*').eq('referrer_user_id', profile.id)
    ]);
    const active = (orders || []).filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
    const totalInr = (orders || []).filter((o) => o.status === 'completed').reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);
    const refEarn = (rewards || []).reduce((sum, row) => sum + Number(row.reward_amount_inr || 0), 0);
    setHtml('seller-stats', `
      <div class="card stat-card"><strong>${(orders || []).length}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>${active}</strong><span>Active Orders</span></div>
      <div class="card stat-card"><strong>${(accounts || []).length}</strong><span>Payout Accounts</span></div>
      <div class="card stat-card"><strong>${fmtInr(refEarn || totalInr)}</strong><span>${refEarn ? 'Referral Earnings' : 'Completed Volume'}</span></div>
    `);

    const latest = orders?.[0];
    if (!latest) {
      setHtml('latest-order-box', 'No recent order yet.');
    } else {
      setHtml('latest-order-box', `
        <div class="kv-list">
          <div class="kv-row"><span>Order ID</span><strong>${escapeHtml(latest.id)}</strong></div>
          <div class="kv-row"><span>Coin</span><strong>${escapeHtml(latest.coin_symbol)} / ${escapeHtml(latest.network)}</strong></div>
          <div class="kv-row"><span>Status</span><strong>${escapeHtml(latest.status)}</strong></div>
          <div class="kv-row"><span>Payout To</span><strong>${escapeHtml(latest.payout_label || '-')}</strong></div>
          <div class="kv-row"><span>Estimated INR</span><strong>${fmtInr(latest.estimated_inr_payout)}</strong></div>
          <div class="kv-row"><span>Deposit Wallet</span><strong class="code-small">${escapeHtml(latest.deposit_wallet_address || '-')}</strong></div>
        </div>
      `);
    }

    renderSellerOrders(orders || []);
  }

  function payoutDestinationLabel(row) {
    if (!row) return '-';
    if (row.payment_method === 'upi') return `${row.label || 'UPI'} • ${row.upi_id || '-'}`;
    return `${row.label || row.bank_name || 'Bank'} • ${row.account_number || '-'}`;
  }

  async function loadSellerPayoutAccounts(profile) {
    await renderPayoutAccounts(profile.id);
    qs('payout-method')?.addEventListener('change', updatePayoutFieldVisibility);
    updatePayoutFieldVisibility();
    qs('save-payout-account')?.addEventListener('click', async () => {
      const editId = val('payout-edit-id');
      const method = val('payout-method');
      const payload = {
        user_id: profile.id,
        payment_method: method,
        label: val('payout-label'),
        account_holder_name: val('payout-holder'),
        bank_name: method === 'bank' ? val('payout-bank-name') : null,
        account_number: method === 'bank' ? val('payout-account-number') : null,
        ifsc_code: method === 'bank' ? val('payout-ifsc') : null,
        upi_id: method === 'upi' ? val('payout-upi') : null,
        is_primary: !!qs('payout-primary')?.checked,
        is_active: true
      };
      if (!payload.label || !payload.account_holder_name) return setText('payout-message', 'Please fill label and account holder name.');
      if (method === 'bank' && (!payload.bank_name || !payload.account_number || !payload.ifsc_code)) return setText('payout-message', 'Please fill bank details.');
      if (method === 'upi' && !payload.upi_id) return setText('payout-message', 'Please fill UPI ID.');

      if (payload.is_primary) {
        await supabase.from('bank_accounts').update({ is_primary: false }).eq('user_id', profile.id);
      }
      let error;
      if (editId) {
        ({ error } = await supabase.from('bank_accounts').update(payload).eq('id', editId));
      } else {
        ({ error } = await supabase.from('bank_accounts').insert(payload));
      }
      if (error) return setText('payout-message', error.message);
      setText('payout-message', 'Payout account saved.');
      clearPayoutForm();
      await renderPayoutAccounts(profile.id);
      await loadSellerStats(profile);
    });

    qs('reset-payout-form')?.addEventListener('click', clearPayoutForm);
    qs('bank-account-select')?.addEventListener('change', onPayoutSelectorChange);
  }

  function updatePayoutFieldVisibility() {
    const method = val('payout-method');
    const bankFields = ['payout-bank-name','payout-account-number','payout-ifsc'];
    const upiField = qs('payout-upi');
    bankFields.forEach((id) => { const el = qs(id)?.closest('div'); if (el) el.style.display = method === 'bank' ? '' : 'none'; });
    if (upiField?.closest('div')) upiField.closest('div').style.display = method === 'upi' ? '' : 'none';
  }

  function clearPayoutForm() {
    ['payout-edit-id','payout-label','payout-holder','payout-bank-name','payout-account-number','payout-ifsc','payout-upi'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('payout-method')) qs('payout-method').value = 'bank';
    if (qs('payout-primary')) qs('payout-primary').checked = false;
    setText('payout-message', '');
    updatePayoutFieldVisibility();
  }

  async function renderPayoutAccounts(userId) {
    const { data: accounts } = await supabase.from('bank_accounts').select('*').eq('user_id', userId).order('is_primary', { ascending: false }).order('created_at', { ascending: false });
    const body = qs('payout-accounts-body');
    const select = qs('bank-account-select');
    if (!body || !select) return;
    body.innerHTML = '';
    select.innerHTML = '';
    if (!(accounts || []).length) {
      body.innerHTML = '<tr><td colspan="7">No payout account added yet.</td></tr>';
      select.innerHTML = '<option value="">No payout account found</option>';
      setHtml('selected-payout-summary', 'No payout account selected. Add a bank account or UPI ID first.');
      return;
    }
    accounts.forEach((row) => {
      const destination = payoutDestinationLabel(row);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml((row.payment_method || 'bank').toUpperCase())}</td>
        <td>${escapeHtml(row.label || '-')}</td>
        <td>${escapeHtml(destination)}</td>
        <td>${row.is_primary ? 'Yes' : 'No'}</td>
        <td>${row.is_verified ? 'Yes' : 'No'}</td>
        <td>${chip(row.user_status || (row.is_active ? 'active' : 'inactive'))}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-payout">Edit</button><button class="btn btn-secondary btn-xs toggle-payout">${row.is_active ? 'Deactivate' : 'Activate'}</button></div></td>
      `;
      tr.querySelector('.edit-payout').addEventListener('click', () => {
        qs('payout-edit-id').value = row.id;
        qs('payout-method').value = row.payment_method || 'bank';
        qs('payout-label').value = row.label || '';
        qs('payout-holder').value = row.account_holder_name || '';
        qs('payout-bank-name').value = row.bank_name || '';
        qs('payout-account-number').value = row.account_number || '';
        qs('payout-ifsc').value = row.ifsc_code || '';
        qs('payout-upi').value = row.upi_id || '';
        qs('payout-primary').checked = !!row.is_primary;
        updatePayoutFieldVisibility();
        document.querySelector('.side-link[data-target="seller-payouts"]')?.click();
      });
      tr.querySelector('.toggle-payout').addEventListener('click', async () => {
        await supabase.from('bank_accounts').update({ is_active: !row.is_active }).eq('id', row.id);
        await renderPayoutAccounts(userId);
      });
      body.appendChild(tr);

      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = destination;
      opt.dataset.summary = destination;
      opt.dataset.method = row.payment_method || 'bank';
      opt.dataset.details = JSON.stringify(row);
      if (row.is_primary) opt.selected = true;
      select.appendChild(opt);
    });
    onPayoutSelectorChange();
  }

  function onPayoutSelectorChange() {
    const select = qs('bank-account-select');
    if (!select) return;
    const opt = select.selectedOptions?.[0];
    if (!opt || !opt.value) {
      setHtml('selected-payout-summary', 'No payout account selected.');
      return;
    }
    const details = JSON.parse(opt.dataset.details || '{}');
    setHtml('selected-payout-summary', `
      <div class="kv-list">
        <div class="kv-row"><span>Method</span><strong>${escapeHtml((details.payment_method || 'bank').toUpperCase())}</strong></div>
        <div class="kv-row"><span>Label</span><strong>${escapeHtml(details.label || '-')}</strong></div>
        <div class="kv-row"><span>Holder</span><strong>${escapeHtml(details.account_holder_name || '-')}</strong></div>
        <div class="kv-row"><span>Destination</span><strong>${escapeHtml(payoutDestinationLabel(details))}</strong></div>
      </div>
    `);
  }

  async function loadReferralsSection(profile) {
    const origin = window.location.origin.includes('http') ? window.location.origin : '';
    const refCode = profile.referral_code || '-';
    const refLink = `${origin}/login.html?ref=${refCode}`;
    setText('ref-code-box', refCode);
    setText('ref-link-box', refLink);
    qs('copy-ref-code')?.addEventListener('click', () => navigator.clipboard.writeText(refCode));
    qs('copy-ref-link')?.addEventListener('click', () => navigator.clipboard.writeText(refLink));

    const { data: referredUsers } = await supabase.from('profiles').select('id,user_status').eq('referred_by', profile.id);
    const { data: rewards } = await supabase.from('referral_rewards').select('*, referred_user:referred_user_id(full_name,email)').eq('referrer_user_id', profile.id).order('created_at', { ascending: false });
    setText('stat-total-referrals', String((referredUsers || []).length));
    setText('stat-active-referrals', String((referredUsers || []).filter((u) => u.user_status === 'active').length));
    const totalEarned = (rewards || []).reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    const pendingEarned = (rewards || []).filter((r) => r.reward_status === 'pending').reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    setText('stat-ref-earnings', fmtInr(totalEarned));
    setText('stat-pending-rewards', fmtInr(pendingEarned));

    const body = qs('referrals-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(rewards || []).length) {
      body.innerHTML = '<tr><td colspan="6">No referral rewards yet.</td></tr>';
      return;
    }
    rewards.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.referred_user?.full_name || r.referred_user?.email || '-')}</td>
        <td class="code-small">${escapeHtml(r.order_id || '-')}</td>
        <td>${Number(r.reward_percent || 0).toFixed(4)}%</td>
        <td>${fmtInr(r.reward_amount_inr)}</td>
        <td>${chip(r.reward_status)}</td>
        <td>${fmtDate(r.created_at)}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadRatesAndQuotes(profile) {
    const { data: rates } = await supabase.from('coin_rates').select('*').eq('is_active', true).order('coin_symbol');
    const coinSel = qs('sell-coin');
    const netSel = qs('sell-network');
    if (!coinSel || !netSel) return;
    const uniqueCoins = [...new Set((rates || []).map((r) => r.coin_symbol))];
    coinSel.innerHTML = uniqueCoins.map((c) => `<option value="${c}">${c}</option>`).join('');
    function refreshNetworks() {
      const selectedCoin = coinSel.value;
      const networks = (rates || []).filter((r) => r.coin_symbol === selectedCoin).map((r) => r.network);
      netSel.innerHTML = networks.map((n) => `<option value="${n}">${n}</option>`).join('');
    }
    coinSel.addEventListener('change', refreshNetworks);
    refreshNetworks();

    qs('show-quotes-btn')?.addEventListener('click', async () => {
      const coin = coinSel.value;
      const network = netSel.value;
      const amount = Number(val('sell-amount') || 0);
      const payoutId = val('bank-account-select');
      const msgEl = qs('quote-calc-message');
      if (!coin || !network || !amount || !payoutId) {
        if (msgEl) msgEl.textContent = 'Please select coin, network, amount and payout account.';
        return;
      }
      const rateRow = (rates || []).find((r) => r.coin_symbol === coin && r.network === network);
      if (!rateRow) {
        if (msgEl) msgEl.textContent = 'No active rate found for selected coin/network.';
        return;
      }
      const { data: payoutAccount } = await supabase.from('bank_accounts').select('*').eq('id', payoutId).single();
      const { data: templates } = await supabase.from('quote_templates').select('*').eq('is_enabled', true).order('sort_order');
      const matched = (templates || []).filter((t) => {
        const minOk = t.min_amount_usdt == null || amount >= Number(t.min_amount_usdt);
        const maxOk = t.max_amount_usdt == null || amount <= Number(t.max_amount_usdt);
        return minOk && maxOk;
      });
      const box = qs('quotes-container');
      const empty = qs('quotes-empty');
      if (!box) return;
      box.innerHTML = '';
      if (empty) empty.style.display = matched.length ? 'none' : '';
      if (!matched.length) {
        if (msgEl) msgEl.textContent = 'No quote template available for this amount.';
        return;
      }
      if (msgEl) msgEl.textContent = 'Quotes ready. Select one below.';
      matched.forEach((t, i) => {
        const finalSpread = Number(rateRow.spread_percent || 0) + Number(t.extra_spread_percent || 0);
        const lockedRate = Number(rateRow.buy_rate_inr) * (1 - finalSpread / 100);
        const estInr = lockedRate * amount;
        const card = document.createElement('div');
        card.className = `quote-card ${i === 0 ? 'recommended' : ''}`;
        card.innerHTML = `
          <span class="badge">${escapeHtml(t.quote_name)}</span>
          <h4>${escapeHtml(t.description || t.quote_type)}</h4>
          <p class="tiny-note">Payout: ${escapeHtml(t.payout_time_label)}</p>
          <p><strong>Rate:</strong> ${fmtInr(lockedRate)}</p>
          <p><strong>Estimated INR:</strong> ${fmtInr(estInr)}</p>
          <p><strong>Total Spread:</strong> ${finalSpread.toFixed(4)}%</p>
          <button class="btn btn-primary choose-quote">Select Quote</button>
        `;
        card.querySelector('.choose-quote').addEventListener('click', async () => {
          const { data: activeWallets } = await supabase.from('wallet_pools').select('*').eq('coin_symbol', coin).eq('network', network).eq('is_active', true).limit(1);
          const wallet = activeWallets?.[0];
          const orderPayload = {
            user_id: profile.id,
            bank_account_id: payoutId,
            quote_template_id: t.id,
            coin_symbol: coin,
            network,
            crypto_amount: amount,
            locked_rate_inr: lockedRate,
            spread_percent: finalSpread,
            estimated_inr_payout: estInr,
            payout_method: payoutAccount?.payment_method || null,
            payout_label: payoutDestinationLabel(payoutAccount),
            payout_details: payoutAccount || {},
            deposit_wallet_address: wallet?.wallet_address || null,
            status: profile.kyc_status === 'verified' ? 'awaiting_transfer' : 'awaiting_kyc'
          };
          const { error, data } = await supabase.from('sell_orders').insert(orderPayload).select().single();
          if (error) return alert(error.message);
          await audit('seller_created_order', 'sell_orders', data.id, { coin, network, amount, payout_label: orderPayload.payout_label });
          await loadSellerStats(profile);
          alert('Sell order created successfully.');
          document.querySelector('.side-link[data-target="seller-orders"]')?.click();
        });
        box.appendChild(card);
      });
    });
  }

  function renderSellerOrders(orders) {
    const body = qs('orders-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(orders || []).length) {
      body.innerHTML = '<tr><td colspan="8">No sell orders yet.</td></tr>';
      return;
    }
    orders.forEach((order) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="code-small">${escapeHtml(order.id)}</td>
        <td>${escapeHtml(order.coin_symbol)} / ${escapeHtml(order.network)}</td>
        <td>${escapeHtml(order.crypto_amount)}</td>
        <td>${fmtInr(order.locked_rate_inr)}</td>
        <td>${fmtInr(order.estimated_inr_payout)}</td>
        <td>${escapeHtml(order.payout_label || '-')}</td>
        <td>${chip(order.status)}</td>
        <td>${fmtDate(order.created_at)}</td>
      `;
      body.appendChild(tr);
    });
  }

  async function loadAdminDashboard() {
    const profile = await ensureAdmin();
    if (!profile) return;
    bindSidebar();
    setText('admin-name', profile.full_name || profile.email || 'Admin');

    // quote form handlers
    qs('save-quote-template')?.addEventListener('click', saveQuoteTemplate);
    qs('reset-quote-form')?.addEventListener('click', clearQuoteForm);
    qs('save-coin-rate')?.addEventListener('click', saveCoinRate);
    qs('reset-rate-form')?.addEventListener('click', clearRateForm);
    qs('save-wallet')?.addEventListener('click', saveWallet);
    qs('reset-wallet-form')?.addEventListener('click', clearWalletForm);

    await Promise.all([
      loadAdminStats(),
      loadAdminQuotes(),
      loadAdminRates(),
      loadAdminUsers(),
      loadAdminWallets(),
      loadAdminOrders(),
      loadAdminLogs()
    ]);
  }

  async function loadAdminStats() {
    const [{ count: usersCount }, { count: ordersCount }, { count: kycPending }, { data: completedOrders }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('sell_orders').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
      supabase.from('sell_orders').select('estimated_inr_payout,status').eq('status', 'completed')
    ]);
    const completedVolume = (completedOrders || []).reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);
    setHtml('admin-stats', `
      <div class="card stat-card"><strong>${usersCount || 0}</strong><span>Total Users</span></div>
      <div class="card stat-card"><strong>${ordersCount || 0}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>${kycPending || 0}</strong><span>Pending KYC</span></div>
      <div class="card stat-card"><strong>${fmtInr(completedVolume)}</strong><span>Completed Volume</span></div>
    `);
  }

  function clearQuoteForm() {
    ['qt-edit-id','qt-name','qt-description','qt-payout','qt-spread','qt-min','qt-max'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('qt-type')) qs('qt-type').value = 'standard';
    if (qs('qt-enabled')) qs('qt-enabled').checked = true;
    setText('admin-quote-message', '');
  }

  async function saveQuoteTemplate() {
    const editId = val('qt-edit-id');
    const payload = {
      quote_name: val('qt-name'),
      quote_type: val('qt-type'),
      description: val('qt-description'),
      payout_time_label: val('qt-payout'),
      extra_spread_percent: Number(val('qt-spread') || 0),
      min_amount_usdt: val('qt-min') ? Number(val('qt-min')) : null,
      max_amount_usdt: val('qt-max') ? Number(val('qt-max')) : null,
      is_enabled: !!qs('qt-enabled')?.checked
    };
    if (!payload.quote_name || !payload.payout_time_label) return setText('admin-quote-message', 'Please fill quote name and payout time.');
    if (payload.extra_spread_percent < 0) return setText('admin-quote-message', 'Spread cannot be negative.');
    const { data: existing } = await supabase.from('quote_templates').select('id').eq('quote_name', payload.quote_name);
    if (!editId && existing?.length) return setText('admin-quote-message', 'Quote name already exists.');
    let error, data;
    if (editId) {
      ({ error, data } = await supabase.from('quote_templates').update(payload).eq('id', editId).select().single());
      if (!error) await audit('quote_updated', 'quote_templates', editId, payload);
    } else {
      ({ error, data } = await supabase.from('quote_templates').insert(payload).select().single());
      if (!error) await audit('quote_created', 'quote_templates', data.id, payload);
    }
    if (error) return setText('admin-quote-message', error.message);
    clearQuoteForm();
    setText('admin-quote-message', 'Quote saved.');
    await loadAdminQuotes();
  }

  async function loadAdminQuotes() {
    const { data } = await supabase.from('quote_templates').select('*').order('sort_order').order('created_at');
    const body = qs('admin-quotes-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(data || []).length) {
      body.innerHTML = '<tr><td colspan="6">No quote templates found.</td></tr>';
      return;
    }
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.quote_name)}</td>
        <td>${escapeHtml(row.quote_type)}</td>
        <td>${escapeHtml(row.payout_time_label)}</td>
        <td>${Number(row.extra_spread_percent || 0).toFixed(4)}%</td>
        <td>${chip(row.is_enabled ? 'enabled' : 'disabled')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-quote">Edit</button><button class="btn btn-secondary btn-xs toggle-quote">${row.is_enabled ? 'Disable' : 'Enable'}</button><button class="btn btn-danger btn-xs delete-quote">Delete</button></div></td>
      `;
      tr.querySelector('.edit-quote').addEventListener('click', () => {
        qs('qt-edit-id').value = row.id;
        qs('qt-name').value = row.quote_name || '';
        qs('qt-type').value = row.quote_type || 'standard';
        qs('qt-description').value = row.description || '';
        qs('qt-payout').value = row.payout_time_label || '';
        qs('qt-spread').value = row.extra_spread_percent || 0;
        qs('qt-min').value = row.min_amount_usdt || '';
        qs('qt-max').value = row.max_amount_usdt || '';
        qs('qt-enabled').checked = !!row.is_enabled;
        document.querySelector('.side-link[data-target="admin-quotes"]')?.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tr.querySelector('.toggle-quote').addEventListener('click', async () => {
        await supabase.from('quote_templates').update({ is_enabled: !row.is_enabled }).eq('id', row.id);
        await audit('quote_toggled', 'quote_templates', row.id, { is_enabled: !row.is_enabled });
        await loadAdminQuotes();
      });
      tr.querySelector('.delete-quote').addEventListener('click', async () => {
        if (!confirm('Delete this quote template?')) return;
        await supabase.from('quote_templates').delete().eq('id', row.id);
        await audit('quote_deleted', 'quote_templates', row.id, { quote_name: row.quote_name });
        await loadAdminQuotes();
      });
      body.appendChild(tr);
    });
  }

  function clearRateForm() {
    ['rate-edit-id','rate-coin','rate-network','rate-buy','rate-spread'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('rate-active')) qs('rate-active').checked = true;
    setText('admin-rate-message', '');
  }

  async function saveCoinRate() {
    const editId = val('rate-edit-id');
    const payload = {
      coin_symbol: val('rate-coin').toUpperCase(),
      network: val('rate-network').toUpperCase(),
      buy_rate_inr: Number(val('rate-buy') || 0),
      spread_percent: Number(val('rate-spread') || 0),
      is_active: !!qs('rate-active')?.checked,
      updated_by: (await getSessionUser()).id
    };
    if (!payload.coin_symbol || !payload.network || payload.buy_rate_inr <= 0) return setText('admin-rate-message', 'Please fill coin, network and valid buy rate.');
    if (payload.spread_percent < 0) return setText('admin-rate-message', 'Spread cannot be negative.');
    let result;
    if (editId) {
      result = await supabase.from('coin_rates').update(payload).eq('id', editId).select().single();
      if (!result.error) await audit('rate_updated', 'coin_rates', editId, payload);
    } else {
      result = await supabase.from('coin_rates').upsert(payload, { onConflict: 'coin_symbol,network' }).select().single();
      if (!result.error) await audit('rate_saved', 'coin_rates', result.data.id, payload);
    }
    if (result.error) return setText('admin-rate-message', result.error.message);
    clearRateForm();
    setText('admin-rate-message', 'Rate saved.');
    await loadAdminRates();
  }

  async function loadAdminRates() {
    const { data } = await supabase.from('coin_rates').select('*').order('coin_symbol').order('network');
    const body = qs('admin-rates-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(data || []).length) {
      body.innerHTML = '<tr><td colspan="6">No rates found.</td></tr>';
      return;
    }
    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.coin_symbol)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td>${fmtInr(row.buy_rate_inr)}</td>
        <td>${Number(row.spread_percent || 0).toFixed(4)}%</td>
        <td>${chip(row.is_active ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-rate">Edit</button><button class="btn btn-secondary btn-xs toggle-rate">${row.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn btn-danger btn-xs delete-rate">Delete</button></div></td>
      `;
      tr.querySelector('.edit-rate').addEventListener('click', () => {
        qs('rate-edit-id').value = row.id;
        qs('rate-coin').value = row.coin_symbol || '';
        qs('rate-network').value = row.network || '';
        qs('rate-buy').value = row.buy_rate_inr || 0;
        qs('rate-spread').value = row.spread_percent || 0;
        qs('rate-active').checked = !!row.is_active;
        document.querySelector('.side-link[data-target="admin-quotes"]')?.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tr.querySelector('.toggle-rate').addEventListener('click', async () => {
        await supabase.from('coin_rates').update({ is_active: !row.is_active }).eq('id', row.id);
        await audit('rate_toggled', 'coin_rates', row.id, { is_active: !row.is_active });
        await loadAdminRates();
      });
      tr.querySelector('.delete-rate').addEventListener('click', async () => {
        if (!confirm('Delete this rate?')) return;
        await supabase.from('coin_rates').delete().eq('id', row.id);
        await audit('rate_deleted', 'coin_rates', row.id, { coin: row.coin_symbol, network: row.network });
        await loadAdminRates();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    const body = qs('admin-users-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(data || []).length) {
      body.innerHTML = '<tr><td colspan="7">No users found.</td></tr>';
      return;
    }
    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.full_name || '-')}</td>
        <td>${escapeHtml(row.email || '-')}</td>
        <td>${escapeHtml(row.mobile || '-')}</td>
        <td>${chip(row.kyc_status)}</td>
        <td>${chip(row.role)}</td>
        <td>${chip(row.user_status)}</td>
        <td>
          <div class="actions-row">
            <button class="btn btn-secondary btn-xs user-active">${row.user_status === 'active' ? 'Inactive' : 'Active'}</button>
            <button class="btn btn-secondary btn-xs user-block">${row.user_status === 'blocked' ? 'Unblock' : 'Block'}</button>
            <button class="btn btn-secondary btn-xs user-kyc">Next KYC</button>
          </div>
        </td>`;
      tr.querySelector('.user-active').addEventListener('click', async () => {
        const next = row.user_status === 'active' ? 'inactive' : 'active';
        await supabase.from('profiles').update({ user_status: next }).eq('id', row.id);
        await audit('user_status_updated', 'profiles', row.id, { user_status: next });
        await loadAdminUsers();
      });
      tr.querySelector('.user-block').addEventListener('click', async () => {
        const next = row.user_status === 'blocked' ? 'active' : 'blocked';
        await supabase.from('profiles').update({ user_status: next }).eq('id', row.id);
        await audit('user_block_toggled', 'profiles', row.id, { user_status: next });
        await loadAdminUsers();
      });
      tr.querySelector('.user-kyc').addEventListener('click', async () => {
        const cycle = { not_submitted: 'pending', pending: 'verified', verified: 'rejected', rejected: 'pending' };
        const next = cycle[row.kyc_status] || 'pending';
        await supabase.from('profiles').update({ kyc_status: next }).eq('id', row.id);
        await audit('user_kyc_updated', 'profiles', row.id, { kyc_status: next });
        await loadAdminUsers();
      });
      body.appendChild(tr);
    });
  }

  function clearWalletForm() {
    ['wallet-edit-id','wallet-coin','wallet-network','wallet-address','wallet-label','wallet-qr'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('wallet-rotate')) qs('wallet-rotate').checked = false;
    if (qs('wallet-active')) qs('wallet-active').checked = true;
    const preview = qs('wallet-qr-preview');
    if (preview) preview.innerHTML = 'No QR uploaded';
    preview?.classList.add('empty-state');
    preview.dataset.qrData = '';
    setText('admin-wallet-message', '');
  }

  async function saveWallet() {
    const editId = val('wallet-edit-id');
    const file = qs('wallet-qr')?.files?.[0];
    const preview = qs('wallet-qr-preview');
    let qrData = preview?.dataset.qrData || '';
    if (file) qrData = await readFileAsDataUrl(file);
    const payload = {
      coin_symbol: val('wallet-coin').toUpperCase(),
      network: val('wallet-network').toUpperCase(),
      wallet_address: val('wallet-address'),
      label: val('wallet-label'),
      qr_data_url: qrData || null,
      is_active: !!qs('wallet-active')?.checked,
      rotate_daily: !!qs('wallet-rotate')?.checked,
      created_by: (await getSessionUser()).id
    };
    if (!payload.coin_symbol || !payload.network || !payload.wallet_address) return setText('admin-wallet-message', 'Please fill coin, network and wallet address.');
    let result;
    if (editId) {
      result = await supabase.from('wallet_pools').update(payload).eq('id', editId).select().single();
      if (!result.error) await audit('wallet_updated', 'wallet_pools', editId, { coin: payload.coin_symbol, network: payload.network });
    } else {
      result = await supabase.from('wallet_pools').insert(payload).select().single();
      if (!result.error) await audit('wallet_created', 'wallet_pools', result.data.id, { coin: payload.coin_symbol, network: payload.network });
    }
    if (result.error) return setText('admin-wallet-message', result.error.message);
    clearWalletForm();
    setText('admin-wallet-message', 'Wallet saved.');
    await loadAdminWallets();
  }

  qs('wallet-qr')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readFileAsDataUrl(file);
    const preview = qs('wallet-qr-preview');
    if (preview) {
      preview.dataset.qrData = data;
      preview.classList.remove('empty-state');
      preview.innerHTML = `<img src="${data}" alt="QR Preview" />`;
    }
  });

  async function loadAdminWallets() {
    const { data } = await supabase.from('wallet_pools').select('*').order('created_at', { ascending: false });
    const body = qs('admin-wallets-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(data || []).length) {
      body.innerHTML = '<tr><td colspan="7">No wallets found.</td></tr>';
      return;
    }
    data.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.coin_symbol)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td class="code-small">${escapeHtml(row.wallet_address)}</td>
        <td>${row.qr_data_url ? '<span class="badge">Uploaded</span>' : '<span class="badge neutral">No QR</span>'}</td>
        <td>${row.rotate_daily ? 'Yes' : 'No'}</td>
        <td>${chip(row.is_active ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-wallet">Edit</button><button class="btn btn-secondary btn-xs toggle-wallet">${row.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn btn-danger btn-xs delete-wallet">Delete</button></div></td>
      `;
      tr.querySelector('.edit-wallet').addEventListener('click', () => {
        qs('wallet-edit-id').value = row.id;
        qs('wallet-coin').value = row.coin_symbol || '';
        qs('wallet-network').value = row.network || '';
        qs('wallet-address').value = row.wallet_address || '';
        qs('wallet-label').value = row.label || '';
        qs('wallet-rotate').checked = !!row.rotate_daily;
        qs('wallet-active').checked = !!row.is_active;
        const preview = qs('wallet-qr-preview');
        if (preview) {
          preview.dataset.qrData = row.qr_data_url || '';
          preview.innerHTML = row.qr_data_url ? `<img src="${row.qr_data_url}" alt="QR Preview" />` : 'No QR uploaded';
          if (row.qr_data_url) preview.classList.remove('empty-state'); else preview.classList.add('empty-state');
        }
        document.querySelector('.side-link[data-target="admin-wallets"]')?.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tr.querySelector('.toggle-wallet').addEventListener('click', async () => {
        await supabase.from('wallet_pools').update({ is_active: !row.is_active }).eq('id', row.id);
        await audit('wallet_toggled', 'wallet_pools', row.id, { is_active: !row.is_active });
        await loadAdminWallets();
      });
      tr.querySelector('.delete-wallet').addEventListener('click', async () => {
        if (!confirm('Delete this wallet?')) return;
        await supabase.from('wallet_pools').delete().eq('id', row.id);
        await audit('wallet_deleted', 'wallet_pools', row.id, { coin: row.coin_symbol, network: row.network });
        await loadAdminWallets();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminOrders() {
    const { data } = await supabase.from('sell_orders').select('*, profiles!sell_orders_user_id_fkey(full_name,email,mobile)').order('created_at', { ascending: false });
    const body = qs('admin-orders-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(data || []).length) {
      body.innerHTML = '<tr><td colspan="8">No sell orders found.</td></tr>';
      return;
    }
    data.forEach((row) => {
      const userName = row.profiles?.full_name || row.profiles?.email || '-';
      const payoutTo = row.payout_label || row.payout_details?.upi_id || row.payout_details?.account_number || '-';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="code-small">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(userName)}</td>
        <td>${escapeHtml(row.coin_symbol)} / ${escapeHtml(row.network)}<br><span class="tiny-note">Wallet: ${escapeHtml(row.deposit_wallet_address || '-')}</span></td>
        <td>${escapeHtml(row.crypto_amount)}</td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td><div>${escapeHtml(payoutTo)}</div><div class="tiny-note">${escapeHtml(row.payout_method || '-')}</div></td>
        <td>${chip(row.status)}</td>
        <td>
          <div class="actions-row">
            <button class="btn btn-secondary btn-xs order-next">Next Status</button>
            <button class="btn btn-secondary btn-xs order-complete">Complete</button>
            <button class="btn btn-danger btn-xs order-cancel">Cancel</button>
          </div>
        </td>
      `;
      tr.querySelector('.order-next').addEventListener('click', async () => {
        const nextMap = {
          quote_selected: 'awaiting_kyc',
          awaiting_kyc: 'awaiting_transfer',
          awaiting_transfer: 'awaiting_confirmations',
          awaiting_confirmations: 'payout_in_progress',
          payout_in_progress: 'completed',
          completed: 'completed',
          cancelled: 'cancelled'
        };
        const next = nextMap[row.status] || 'awaiting_transfer';
        await supabase.from('sell_orders').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null }).eq('id', row.id);
        await audit('order_status_updated', 'sell_orders', row.id, { status: next });
        await loadAdminOrders();
        await loadAdminStats();
      });
      tr.querySelector('.order-complete').addEventListener('click', async () => {
        await supabase.from('sell_orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', row.id);
        await audit('order_completed', 'sell_orders', row.id, { status: 'completed' });
        await loadAdminOrders();
        await loadAdminStats();
      });
      tr.querySelector('.order-cancel').addEventListener('click', async () => {
        await supabase.from('sell_orders').update({ status: 'cancelled' }).eq('id', row.id);
        await audit('order_cancelled', 'sell_orders', row.id, { status: 'cancelled' });
        await loadAdminOrders();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminLogs() {
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20);
    const body = qs('admin-audit-body') || qs('admin-logs-body');
    const second = qs('admin-logs-body');
    const htmlRows = !(data || []).length
      ? '<tr><td colspan="4">No audit logs yet.</td></tr>'
      : (data || []).map((row) => `
          <tr>
            <td>${escapeHtml(row.action)}</td>
            <td>${escapeHtml(row.entity_type)}${row.entity_id ? ' / ' + escapeHtml(row.entity_id) : ''}</td>
            <td class="code-small">${escapeHtml(JSON.stringify(row.meta || {}))}</td>
            <td>${fmtDate(row.created_at)}</td>
          </tr>`).join('');
    if (body) body.innerHTML = htmlRows;
    if (second && second !== body) second.innerHTML = htmlRows;
  }

  switch (page) {
    case 'login':
      loadLoginPage();
      break;
    case 'admin-login':
      loadAdminLoginPage();
      break;
    case 'seller-dashboard':
      loadSellerDashboard();
      break;
    case 'admin-dashboard':
      loadAdminDashboard();
      break;
    default:
      break;
  }
})();
