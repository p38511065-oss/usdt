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

  const sellerClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { storageKey: 'crypto_seller_auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const adminClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { storageKey: 'crypto_admin_auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const supabase = ['admin-login', 'admin-dashboard'].includes(page) ? adminClient : sellerClient;
  window.appSupabase = supabase;

  function qs(id) { return document.getElementById(id); }
  function val(id) { return qs(id)?.value?.trim() || ''; }
  function setText(id, text) { const el = qs(id); if (el) el.textContent = text; }
  function setHtml(id, html) { const el = qs(id); if (el) el.innerHTML = html; }
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>\"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }
  function fmtDate(v) { return v ? new Date(v).toLocaleString() : '-'; }
  function fmtInr(v) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v || 0)); }
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
        document.getElementById(btn.dataset.target)?.classList.add('active');
        if (history.replaceState) history.replaceState(null, '', '#' + btn.dataset.target);
      });
    });
    const hash = window.location.hash.replace('#', '');
    if (hash) document.querySelector(`.side-link[data-target="${hash}"]`)?.click();
  }
  function previewImageBox(data) {
    return data ? `<img src="${data}" alt="Preview" />` : '<span class="badge neutral">Not uploaded</span>';
  }
  async function readFileAsDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function copyText(text) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text || '');
  }

  async function getSessionUser(client = supabase) {
    const { data: { user } } = await client.auth.getUser();
    return user || null;
  }
  async function getProfile(client = supabase) {
    const user = await getSessionUser(client);
    if (!user) return null;
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data;
  }
  async function ensureAuth(loginPage, client = supabase) {
    const user = await getSessionUser(client);
    if (!user) { window.location.href = loginPage; return null; }
    return user;
  }
  async function ensureAdmin() {
    const user = await ensureAuth('admin-login.html', adminClient);
    if (!user) return null;
    const profile = await getProfile(adminClient);
    if (!profile || profile.role !== 'admin') {
      alert('Admin access required.');
      window.location.href = 'admin-login.html';
      return null;
    }
    return profile;
  }
  async function audit(action, entityType, entityId, meta) {
    try {
      const user = await getSessionUser(['admin-login', 'admin-dashboard'].includes(page) ? adminClient : sellerClient);
      if (!user) return;
      await (['admin-login', 'admin-dashboard'].includes(page) ? adminClient : sellerClient)
        .from('audit_logs')
        .insert({ actor_user_id: user.id, action, entity_type: entityType, entity_id: entityId ? String(entityId) : null, meta: meta || {} });
    } catch (e) {
      console.warn('audit failed', e.message);
    }
  }

  document.querySelectorAll('#logout-btn').forEach((btn) => btn.addEventListener('click', async () => {
    await (['admin-login', 'admin-dashboard'].includes(page) ? adminClient : sellerClient).auth.signOut();
    window.location.href = page === 'admin-dashboard' ? 'admin-login.html' : 'login.html';
  }));

  async function loadLoginPage() {
    qs('login-btn')?.addEventListener('click', async () => {
      setText('auth-message', 'Logging in...');
      const { error } = await sellerClient.auth.signInWithPassword({ email: val('login-email'), password: qs('login-password').value });
      if (error) return setText('auth-message', error.message);
      window.location.href = 'dashboard.html';
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
        const { data: refProfile } = await sellerClient.from('profiles').select('id').eq('referral_code', referralCode).maybeSingle();
        referredBy = refProfile?.id || null;
      }
      const { error } = await sellerClient.auth.signUp({
        email, password,
        options: { data: { full_name, mobile, role: 'seller' } }
      });
      if (error) return setText('auth-message', error.message);
      if (referredBy) {
        setTimeout(async () => {
          try {
            const user = await getSessionUser(sellerClient);
            if (user) await sellerClient.from('profiles').update({ referred_by: referredBy }).eq('id', user.id);
          } catch (_e) {}
        }, 1200);
      }
      setText('auth-message', 'Account created successfully. Now login.');
    });
  }

  async function loadAdminLoginPage() {
    qs('admin-login-btn')?.addEventListener('click', async () => {
      setText('admin-auth-message', 'Logging in...');
      const { error } = await adminClient.auth.signInWithPassword({ email: val('admin-email'), password: qs('admin-password').value });
      if (error) return setText('admin-auth-message', error.message);
      const profile = await getProfile(adminClient);
      if (profile?.role !== 'admin') {
        setText('admin-auth-message', 'This account is not admin.');
        await adminClient.auth.signOut();
        return;
      }
      window.location.href = 'admin.html';
    });
  }

  function payoutDestinationLabel(row) {
    if (!row) return '-';
    if (row.payment_method === 'upi') return `${row.label || 'UPI'} • ${row.upi_id || '-'}`;
    return `${row.label || row.bank_name || 'Bank'} • ${row.account_number || '-'}`;
  }
  function renderProfileBoxes(profile) {
    setHtml('profile-box', `
      <div class="kv-row"><span>Name</span><strong>${escapeHtml(profile.full_name || '-')}</strong></div>
      <div class="kv-row"><span>Email</span><strong>${escapeHtml(profile.email || '-')}</strong></div>
      <div class="kv-row"><span>Mobile</span><strong>${escapeHtml(profile.mobile || '-')}</strong></div>
      <div class="kv-row"><span>Role</span><strong>${escapeHtml(profile.role)}</strong></div>
      <div class="kv-row"><span>User Status</span><strong>${escapeHtml(profile.user_status)}</strong></div>`);
    setHtml('seller-quick-status', `
      <div class="kv-row"><span>Seller</span><strong>${escapeHtml(profile.full_name || profile.email || 'Seller')}</strong></div>
      <div class="kv-row"><span>KYC</span><strong>${escapeHtml(profile.kyc_status)}</strong></div>
      <div class="kv-row"><span>Status</span><strong>${escapeHtml(profile.user_status)}</strong></div>
      <div class="kv-row"><span>Referral Code</span><strong>${escapeHtml(profile.referral_code || '-')}</strong></div>`);
  }

  async function renderPayoutAccounts(userId) {
    const { data: accounts } = await sellerClient.from('bank_accounts').select('*').eq('user_id', userId).order('is_primary', { ascending: false }).order('created_at', { ascending: false });
    const body = qs('payout-accounts-body');
    const select = qs('bank-account-select');
    if (!body || !select) return;
    body.innerHTML = '';
    select.innerHTML = '';
    if (!(accounts || []).length) {
      body.innerHTML = '<tr><td colspan="7">No payout method added yet.</td></tr>';
      select.innerHTML = '<option value="">No payout method found</option>';
      setHtml('selected-payout-summary', 'No payout method selected. Add a bank account or UPI ID first.');
      return [];
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
        <td>${chip(row.is_active ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-payout">Edit</button><button class="btn btn-secondary btn-xs toggle-payout">${row.is_active ? 'Deactivate' : 'Activate'}</button></div></td>`;
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
        await sellerClient.from('bank_accounts').update({ is_active: !row.is_active }).eq('id', row.id);
        await renderPayoutAccounts(userId);
      });
      body.appendChild(tr);

      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = destination;
      opt.dataset.details = JSON.stringify(row);
      if (row.is_primary) opt.selected = true;
      select.appendChild(opt);
    });
    onPayoutSelectorChange();
    return accounts || [];
  }
  function updatePayoutFieldVisibility() {
    const method = val('payout-method');
    ['payout-bank-name', 'payout-account-number', 'payout-ifsc'].forEach((id) => {
      const wrapper = qs(id)?.closest('div');
      if (wrapper) wrapper.style.display = method === 'bank' ? '' : 'none';
    });
    const upiWrap = qs('payout-upi')?.closest('div');
    if (upiWrap) upiWrap.style.display = method === 'upi' ? '' : 'none';
  }
  function clearPayoutForm() {
    ['payout-edit-id','payout-label','payout-holder','payout-bank-name','payout-account-number','payout-ifsc','payout-upi'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('payout-method')) qs('payout-method').value = 'bank';
    if (qs('payout-primary')) qs('payout-primary').checked = false;
    setText('payout-message', '');
    updatePayoutFieldVisibility();
  }
  function onPayoutSelectorChange() {
    const opt = qs('bank-account-select')?.selectedOptions?.[0];
    if (!opt || !opt.value) return setHtml('selected-payout-summary', 'No payout method selected.');
    const details = JSON.parse(opt.dataset.details || '{}');
    setHtml('selected-payout-summary', `
      <div class="kv-list">
        <div class="kv-row"><span>Method</span><strong>${escapeHtml((details.payment_method || 'bank').toUpperCase())}</strong></div>
        <div class="kv-row"><span>Label</span><strong>${escapeHtml(details.label || '-')}</strong></div>
        <div class="kv-row"><span>Holder</span><strong>${escapeHtml(details.account_holder_name || '-')}</strong></div>
        <div class="kv-row"><span>Destination</span><strong>${escapeHtml(payoutDestinationLabel(details))}</strong></div>
      </div>`);
  }
  function renderSellerOrders(orders) {
    const body = qs('orders-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(orders || []).length) {
      body.innerHTML = '<tr><td colspan="8">No sell orders found.</td></tr>';
      return;
    }
    orders.forEach((row) => {
      const tr = document.createElement('tr');
      const payoutTo = row.payout_label || row.payout_details?.upi_id || row.payout_details?.account_number || '-';
      tr.innerHTML = `
        <td class="code-small">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.coin_symbol)} / ${escapeHtml(row.network)}</td>
        <td>${escapeHtml(row.crypto_amount)}</td>
        <td>${Number(row.locked_rate_inr || 0).toFixed(4)}</td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td>${escapeHtml(payoutTo)}</td>
        <td>${chip(row.status)}</td>
        <td>${fmtDate(row.created_at)}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadSellerStats(profile) {
    const [{ data: orders }, { data: accounts }, { data: rewards }] = await Promise.all([
      sellerClient.from('sell_orders').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      sellerClient.from('bank_accounts').select('*').eq('user_id', profile.id).eq('is_active', true),
      sellerClient.from('referral_rewards').select('*').eq('referrer_user_id', profile.id)
    ]);
    const active = (orders || []).filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
    const totalInr = (orders || []).filter((o) => o.status === 'completed').reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);
    const refEarn = (rewards || []).reduce((sum, row) => sum + Number(row.reward_amount_inr || 0), 0);
    setHtml('seller-stats', `
      <div class="card stat-card"><strong>${(orders || []).length}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>${active}</strong><span>Active Orders</span></div>
      <div class="card stat-card"><strong>${(accounts || []).length}</strong><span>Payout Methods</span></div>
      <div class="card stat-card"><strong>${fmtInr(refEarn || totalInr)}</strong><span>${refEarn ? 'Referral Earnings' : 'Completed Volume'}</span></div>`);

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
        </div>`);
    }
    renderSellerOrders(orders || []);
  }

  async function loadReferralsSection(profile) {
    const origin = window.location.origin.includes('http') ? window.location.origin : '';
    const refCode = profile.referral_code || '-';
    const refLink = `${origin}/login.html?ref=${refCode}`;
    setText('ref-code-box', refCode);
    setText('ref-link-box', refLink);
    qs('copy-ref-code')?.addEventListener('click', () => copyText(refCode));
    qs('copy-ref-link')?.addEventListener('click', () => copyText(refLink));

    const { data: referredUsers } = await sellerClient.from('profiles').select('id,user_status').eq('referred_by', profile.id);
    const { data: rewards } = await sellerClient.from('referral_rewards').select('*, referred_user:referred_user_id(full_name,email)').eq('referrer_user_id', profile.id).order('created_at', { ascending: false });
    setText('stat-total-referrals', String((referredUsers || []).length));
    setText('stat-active-referrals', String((referredUsers || []).filter((u) => u.user_status === 'active').length));
    const totalEarned = (rewards || []).reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    const pendingEarned = (rewards || []).filter((r) => r.reward_status === 'pending').reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    setText('stat-ref-earnings', fmtInr(totalEarned));
    setText('stat-pending-rewards', fmtInr(pendingEarned));
    const body = qs('referrals-body');
    if (!body) return;
    body.innerHTML = !(rewards || []).length ? '<tr><td colspan="6">No referral rewards yet.</td></tr>' : (rewards || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.referred_user?.full_name || r.referred_user?.email || '-')}</td>
        <td class="code-small">${escapeHtml(r.order_id || '-')}</td>
        <td>${Number(r.reward_percent || 0).toFixed(4)}%</td>
        <td>${fmtInr(r.reward_amount_inr)}</td>
        <td>${chip(r.reward_status)}</td>
        <td>${fmtDate(r.created_at)}</td>
      </tr>`).join('');
  }

  async function loadKycSection(profile) {
    const { data: latest } = await sellerClient.from('kyc_submissions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const statusText = latest ? `Current KYC status: <strong>${escapeHtml(latest.status)}</strong>${latest.review_note ? `<br><span class="tiny-note">${escapeHtml(latest.review_note)}</span>` : ''}` : `Current KYC status: <strong>${escapeHtml(profile.kyc_status)}</strong>`;
    setHtml('kyc-status-box', statusText);
    if (latest) {
      setHtml('kyc-preview-box', `
        <div class="doc-card">Front<br>${previewImageBox(latest.front_image_data)}</div>
        <div class="doc-card">Back<br>${previewImageBox(latest.back_image_data)}</div>
        <div class="doc-card">Selfie<br>${previewImageBox(latest.selfie_image_data)}</div>`);
      qs('kyc-edit-id').value = latest.id;
      qs('kyc-full-name').value = latest.full_name || profile.full_name || '';
      qs('kyc-dob').value = latest.dob || '';
      qs('kyc-id-type').value = latest.id_type || 'aadhaar';
      qs('kyc-id-number').value = latest.id_number || '';
      qs('kyc-address').value = latest.address || '';
    }
    qs('submit-kyc-btn')?.addEventListener('click', async () => {
      setText('kyc-message', 'Submitting KYC...');
      const payload = {
        user_id: profile.id,
        full_name: val('kyc-full-name') || profile.full_name || '',
        dob: val('kyc-dob') || null,
        id_type: val('kyc-id-type'),
        id_number: val('kyc-id-number'),
        address: val('kyc-address'),
        status: 'pending',
        review_note: null
      };
      if (!payload.full_name || !payload.id_number || !payload.address) return setText('kyc-message', 'Please fill required KYC fields.');
      const front = qs('kyc-front-file')?.files?.[0];
      const back = qs('kyc-back-file')?.files?.[0];
      const selfie = qs('kyc-selfie-file')?.files?.[0];
      if (front) payload.front_image_data = await readFileAsDataUrl(front);
      if (back) payload.back_image_data = await readFileAsDataUrl(back);
      if (selfie) payload.selfie_image_data = await readFileAsDataUrl(selfie);
      let result;
      if (val('kyc-edit-id')) {
        result = await sellerClient.from('kyc_submissions').update(payload).eq('id', val('kyc-edit-id')).select().single();
      } else {
        result = await sellerClient.from('kyc_submissions').insert(payload).select().single();
      }
      if (result.error) return setText('kyc-message', result.error.message);
      await sellerClient.from('profiles').update({ kyc_status: 'pending' }).eq('id', profile.id);
      await audit('kyc_submitted', 'kyc_submissions', result.data.id, { status: 'pending' });
      setText('kyc-message', 'KYC submitted successfully.');
      await loadKycSection(await getProfile(sellerClient));
      renderProfileBoxes(await getProfile(sellerClient));
    });
  }

  async function loadRatesAndQuotes(profile) {
    const [{ data: rates }, { data: templates }, { data: slabs }, { data: wallets }] = await Promise.all([
      sellerClient.from('coin_rates').select('*').eq('is_active', true),
      sellerClient.from('quote_templates').select('*').eq('is_enabled', true).order('sort_order', { ascending: true }),
      sellerClient.from('quote_slabs').select('*').eq('is_enabled', true).order('min_amount', { ascending: true }),
      sellerClient.from('wallet_pools').select('*').eq('is_active', true)
    ]);
    const coinSelect = qs('sell-coin');
    const networkSelect = qs('sell-network');
    if (!coinSelect || !networkSelect) return;
    const uniqueCoins = [...new Set((rates || []).map((r) => r.coin_symbol))];
    coinSelect.innerHTML = uniqueCoins.map((coin) => `<option value="${escapeHtml(coin)}">${escapeHtml(coin)}</option>`).join('');
    const fillNetworks = () => {
      const coin = coinSelect.value;
      const nets = (rates || []).filter((r) => r.coin_symbol === coin).map((r) => r.network);
      networkSelect.innerHTML = [...new Set(nets)].map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    };
    coinSelect.addEventListener('change', fillNetworks);
    fillNetworks();

    qs('show-quotes-btn')?.addEventListener('click', async () => {
      const coin = val('sell-coin').toUpperCase();
      const network = val('sell-network').toUpperCase();
      const amount = Number(val('sell-amount'));
      const payoutId = val('bank-account-select');
      if (!coin || !network || !amount || !payoutId) return setText('quote-calc-message', 'Please select coin, network, amount and payout method.');
      const payoutAccounts = await renderPayoutAccounts(profile.id);
      const payout = (payoutAccounts || []).find((x) => x.id === payoutId);
      if (!payout) return setText('quote-calc-message', 'Please select a valid payout method.');
      const rateRow = (rates || []).find((r) => r.coin_symbol === coin && r.network === network);
      if (!rateRow) return setText('quote-calc-message', 'No active rate found for this coin/network.');
      const activeWallet = (wallets || []).find((w) => w.coin_symbol === coin && w.network === network) || (wallets || []).find((w) => w.coin_symbol === coin);
      const available = (templates || []).filter((t) => amount >= Number(t.min_amount_usdt || 0) && (!t.max_amount_usdt || amount <= Number(t.max_amount_usdt)));
      const container = qs('quotes-container');
      const empty = qs('quotes-empty');
      container.innerHTML = '';
      if (!available.length) {
        empty.style.display = 'block';
        empty.textContent = 'No quote template matches this amount.';
        return;
      }
      empty.style.display = 'none';
      available.forEach((tpl, index) => {
        const slab = (slabs || []).find((s) => s.quote_type === tpl.quote_type && s.coin_symbol === coin && s.network === network && amount >= Number(s.min_amount || 0) && (!s.max_amount || amount <= Number(s.max_amount)));
        const finalRate = slab ? Number(slab.rate_inr) : Math.max(0, Number(rateRow.buy_rate_inr) - Number(rateRow.spread_percent || 0) - Number(tpl.extra_spread_percent || 0));
        const estimated = amount * finalRate;
        const card = document.createElement('div');
        card.className = 'quote-card' + (index === 0 ? ' recommended' : '');
        card.innerHTML = `
          <div class="badge ${index === 0 ? '' : 'neutral'}">${index === 0 ? 'Recommended' : 'Available'}</div>
          <h4>${escapeHtml(tpl.quote_name)}</h4>
          <p>${escapeHtml(tpl.description || 'Editable quote option')}</p>
          <div class="kv-list">
            <div class="kv-row"><span>Rate</span><strong>${Number(finalRate).toFixed(4)}</strong></div>
            <div class="kv-row"><span>Estimated INR</span><strong>${fmtInr(estimated)}</strong></div>
            <div class="kv-row"><span>Payout Time</span><strong>${escapeHtml(tpl.payout_time_label)}</strong></div>
            <div class="kv-row"><span>Amount Slab</span><strong>${slab ? `${Number(slab.min_amount || 0)} - ${slab.max_amount ? Number(slab.max_amount) : 'Unlimited'}` : 'Default rate'}</strong></div>
          </div>
          <div class="action-row top-gap-sm"><button class="btn btn-primary select-quote">Select Quote</button></div>`;
        card.querySelector('.select-quote').addEventListener('click', async () => {
          const payload = {
            user_id: profile.id,
            bank_account_id: payout.id,
            quote_template_id: tpl.id,
            coin_symbol: coin,
            network,
            crypto_amount: amount,
            locked_rate_inr: finalRate,
            spread_percent: Number(tpl.extra_spread_percent || 0),
            estimated_inr_payout: estimated,
            payout_method: payout.payment_method,
            payout_label: payoutDestinationLabel(payout),
            payout_details: payout,
            deposit_wallet_address: activeWallet?.wallet_address || null,
            status: profile.kyc_status === 'verified' ? 'awaiting_transfer' : 'awaiting_kyc'
          };
          const { data: order, error } = await sellerClient.from('sell_orders').insert(payload).select().single();
          if (error) return setText('quote-calc-message', error.message);
          await audit('sell_order_created', 'sell_orders', order.id, { coin, network, amount, payout_method: payout.payment_method });
          setText('quote-calc-message', `Order created. Deposit to wallet: ${activeWallet?.wallet_address || 'Admin will assign wallet soon'}`);
          await loadSellerStats(profile);
          document.querySelector('.side-link[data-target="seller-orders"]')?.click();
        });
        container.appendChild(card);
      });
    });
    qs('bank-account-select')?.addEventListener('change', onPayoutSelectorChange);
  }

  async function loadSellerDashboard() {
    const user = await ensureAuth('login.html', sellerClient);
    if (!user) return;
    bindSidebar();
    const profile = await getProfile(sellerClient);
    setText('seller-top-name', profile.full_name || profile.email || 'Seller');
    renderProfileBoxes(profile);
    updatePayoutFieldVisibility();
    qs('payout-method')?.addEventListener('change', updatePayoutFieldVisibility);
    qs('reset-payout-form')?.addEventListener('click', clearPayoutForm);
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
      if (payload.is_primary) await sellerClient.from('bank_accounts').update({ is_primary: false }).eq('user_id', profile.id);
      const result = editId ? await sellerClient.from('bank_accounts').update(payload).eq('id', editId).select().single() : await sellerClient.from('bank_accounts').insert(payload).select().single();
      if (result.error) return setText('payout-message', result.error.message);
      await audit(editId ? 'payout_method_updated' : 'payout_method_created', 'bank_accounts', result.data.id, { payment_method: method });
      setText('payout-message', 'Payout method saved.');
      clearPayoutForm();
      await renderPayoutAccounts(profile.id);
      await loadSellerStats(profile);
    });

    await Promise.all([
      renderPayoutAccounts(profile.id),
      loadSellerStats(profile),
      loadReferralsSection(profile),
      loadRatesAndQuotes(profile),
      loadKycSection(profile)
    ]);
  }

  function resetQuoteForm() {
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
      min_amount_usdt: val('qt-min') ? Number(val('qt-min')) : 0,
      max_amount_usdt: val('qt-max') ? Number(val('qt-max')) : null,
      is_enabled: !!qs('qt-enabled')?.checked
    };
    if (!payload.quote_name || !payload.payout_time_label) return setText('admin-quote-message', 'Please fill quote name and payout time.');
    if (payload.extra_spread_percent < 0) return setText('admin-quote-message', 'Spread cannot be negative.');
    const duplicate = await adminClient.from('quote_templates').select('id').eq('quote_name', payload.quote_name).neq('id', editId || '00000000-0000-0000-0000-000000000000').maybeSingle();
    if (duplicate.data) return setText('admin-quote-message', 'Quote name already exists.');
    const result = editId ? await adminClient.from('quote_templates').update(payload).eq('id', editId).select().single() : await adminClient.from('quote_templates').insert(payload).select().single();
    if (result.error) return setText('admin-quote-message', result.error.message);
    await audit(editId ? 'quote_updated' : 'quote_created', 'quote_templates', result.data.id, payload);
    resetQuoteForm();
    setText('admin-quote-message', 'Quote saved.');
    await loadAdminQuotes();
  }
  async function loadAdminQuotes() {
    const { data } = await adminClient.from('quote_templates').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    const body = qs('admin-quotes-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="6">No quote templates found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.quote_name)}</td>
        <td>${escapeHtml(row.quote_type)}</td>
        <td>${escapeHtml(row.payout_time_label)}</td>
        <td>${Number(row.extra_spread_percent || 0).toFixed(4)}</td>
        <td>${chip(row.is_enabled ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-quote">Edit</button><button class="btn btn-secondary btn-xs toggle-quote">${row.is_enabled ? 'Disable' : 'Enable'}</button><button class="btn btn-danger btn-xs delete-quote">Delete</button></div></td>`;
      tr.querySelector('.edit-quote').addEventListener('click', () => {
        qs('qt-edit-id').value = row.id;
        qs('qt-name').value = row.quote_name || '';
        qs('qt-type').value = row.quote_type || 'standard';
        qs('qt-description').value = row.description || '';
        qs('qt-payout').value = row.payout_time_label || '';
        qs('qt-spread').value = row.extra_spread_percent || 0;
        qs('qt-min').value = row.min_amount_usdt || 0;
        qs('qt-max').value = row.max_amount_usdt || '';
        qs('qt-enabled').checked = !!row.is_enabled;
        document.querySelector('.side-link[data-target="admin-quotes"]')?.click();
      });
      tr.querySelector('.toggle-quote').addEventListener('click', async () => {
        await adminClient.from('quote_templates').update({ is_enabled: !row.is_enabled }).eq('id', row.id);
        await audit('quote_toggled', 'quote_templates', row.id, { is_enabled: !row.is_enabled });
        await loadAdminQuotes();
      });
      tr.querySelector('.delete-quote').addEventListener('click', async () => {
        if (!confirm('Delete this quote template?')) return;
        await adminClient.from('quote_templates').delete().eq('id', row.id);
        await audit('quote_deleted', 'quote_templates', row.id, {});
        await loadAdminQuotes();
      });
      body.appendChild(tr);
    });
  }

  function resetRateForm() {
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
      updated_by: (await getSessionUser(adminClient)).id
    };
    if (!payload.coin_symbol || !payload.network || payload.buy_rate_inr <= 0) return setText('admin-rate-message', 'Please fill coin, network and valid buy rate.');
    if (payload.spread_percent < 0) return setText('admin-rate-message', 'Spread cannot be negative.');
    const result = editId ? await adminClient.from('coin_rates').update(payload).eq('id', editId).select().single() : await adminClient.from('coin_rates').upsert(payload, { onConflict: 'coin_symbol,network' }).select().single();
    if (result.error) return setText('admin-rate-message', result.error.message);
    await audit(editId ? 'rate_updated' : 'rate_created', 'coin_rates', result.data.id, payload);
    resetRateForm();
    setText('admin-rate-message', 'Rate saved.');
    await loadAdminRates();
  }
  async function loadAdminRates() {
    const { data } = await adminClient.from('coin_rates').select('*').order('coin_symbol').order('network');
    const body = qs('admin-rates-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="6">No rates found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.coin_symbol)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td>${Number(row.buy_rate_inr || 0).toFixed(4)}</td>
        <td>${Number(row.spread_percent || 0).toFixed(4)}</td>
        <td>${chip(row.is_active ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-rate">Edit</button><button class="btn btn-secondary btn-xs toggle-rate">${row.is_active ? 'Disable' : 'Enable'}</button></div></td>`;
      tr.querySelector('.edit-rate').addEventListener('click', () => {
        qs('rate-edit-id').value = row.id;
        qs('rate-coin').value = row.coin_symbol || '';
        qs('rate-network').value = row.network || '';
        qs('rate-buy').value = row.buy_rate_inr || '';
        qs('rate-spread').value = row.spread_percent || 0;
        qs('rate-active').checked = !!row.is_active;
        document.querySelector('.side-link[data-target="admin-quotes"]')?.click();
      });
      tr.querySelector('.toggle-rate').addEventListener('click', async () => {
        await adminClient.from('coin_rates').update({ is_active: !row.is_active }).eq('id', row.id);
        await audit('rate_toggled', 'coin_rates', row.id, { is_active: !row.is_active });
        await loadAdminRates();
      });
      body.appendChild(tr);
    });
  }

  function resetSlabForm() {
    ['slab-edit-id','slab-coin','slab-network','slab-min','slab-max','slab-rate'].forEach((id) => { if (qs(id)) qs(id).value = ''; });
    if (qs('slab-quote-type')) qs('slab-quote-type').value = 'standard';
    if (qs('slab-enabled')) qs('slab-enabled').checked = true;
    setText('admin-slab-message', '');
  }
  async function saveQuoteSlab() {
    const editId = val('slab-edit-id');
    const payload = {
      quote_type: val('slab-quote-type'),
      coin_symbol: val('slab-coin').toUpperCase(),
      network: val('slab-network').toUpperCase(),
      min_amount: Number(val('slab-min') || 0),
      max_amount: val('slab-max') ? Number(val('slab-max')) : null,
      rate_inr: Number(val('slab-rate') || 0),
      is_enabled: !!qs('slab-enabled')?.checked
    };
    if (!payload.coin_symbol || !payload.network || payload.rate_inr <= 0) return setText('admin-slab-message', 'Please fill slab details properly.');
    const result = editId ? await adminClient.from('quote_slabs').update(payload).eq('id', editId).select().single() : await adminClient.from('quote_slabs').insert(payload).select().single();
    if (result.error) return setText('admin-slab-message', result.error.message);
    await audit(editId ? 'slab_updated' : 'slab_created', 'quote_slabs', result.data.id, payload);
    resetSlabForm();
    setText('admin-slab-message', 'Rate slab saved.');
    await loadAdminSlabs();
  }
  async function loadAdminSlabs() {
    const { data } = await adminClient.from('quote_slabs').select('*').order('quote_type').order('coin_symbol').order('min_amount');
    const body = qs('admin-slabs-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="7">No slabs found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.quote_type)}</td>
        <td>${escapeHtml(row.coin_symbol)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td>${Number(row.min_amount || 0)} - ${row.max_amount ? Number(row.max_amount) : 'Unlimited'}</td>
        <td>${Number(row.rate_inr || 0).toFixed(4)}</td>
        <td>${chip(row.is_enabled ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-slab">Edit</button><button class="btn btn-secondary btn-xs toggle-slab">${row.is_enabled ? 'Disable' : 'Enable'}</button><button class="btn btn-danger btn-xs delete-slab">Delete</button></div></td>`;
      tr.querySelector('.edit-slab').addEventListener('click', () => {
        qs('slab-edit-id').value = row.id;
        qs('slab-quote-type').value = row.quote_type;
        qs('slab-coin').value = row.coin_symbol;
        qs('slab-network').value = row.network;
        qs('slab-min').value = row.min_amount || 0;
        qs('slab-max').value = row.max_amount || '';
        qs('slab-rate').value = row.rate_inr || '';
        qs('slab-enabled').checked = !!row.is_enabled;
        document.querySelector('.side-link[data-target="admin-slabs"]')?.click();
      });
      tr.querySelector('.toggle-slab').addEventListener('click', async () => {
        await adminClient.from('quote_slabs').update({ is_enabled: !row.is_enabled }).eq('id', row.id);
        await audit('slab_toggled', 'quote_slabs', row.id, { is_enabled: !row.is_enabled });
        await loadAdminSlabs();
      });
      tr.querySelector('.delete-slab').addEventListener('click', async () => {
        if (!confirm('Delete this slab?')) return;
        await adminClient.from('quote_slabs').delete().eq('id', row.id);
        await audit('slab_deleted', 'quote_slabs', row.id, {});
        await loadAdminSlabs();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminUsers() {
    const { data } = await adminClient.from('profiles').select('*').order('created_at', { ascending: false });
    const body = qs('admin-users-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="7">No users found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.full_name || '-')}</td>
        <td class="break-anywhere">${escapeHtml(row.email || '-')}</td>
        <td>${escapeHtml(row.mobile || '-')}</td>
        <td>${chip(row.kyc_status)}</td>
        <td>${chip(row.role)}</td>
        <td>${chip(row.user_status)}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs user-active">${row.user_status === 'active' ? 'Deactivate' : 'Activate'}</button><button class="btn btn-secondary btn-xs user-block">${row.user_status === 'blocked' ? 'Unblock' : 'Block'}</button></div></td>`;
      tr.querySelector('.user-active').addEventListener('click', async () => {
        const next = row.user_status === 'active' ? 'inactive' : 'active';
        await adminClient.from('profiles').update({ user_status: next }).eq('id', row.id);
        await audit('user_status_updated', 'profiles', row.id, { user_status: next });
        await loadAdminUsers();
      });
      tr.querySelector('.user-block').addEventListener('click', async () => {
        const next = row.user_status === 'blocked' ? 'active' : 'blocked';
        await adminClient.from('profiles').update({ user_status: next }).eq('id', row.id);
        await audit('user_block_updated', 'profiles', row.id, { user_status: next });
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
    if (preview) {
      preview.innerHTML = 'No QR uploaded';
      preview.classList.add('empty-state');
      preview.dataset.qrData = '';
    }
    setText('admin-wallet-message', '');
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
      created_by: (await getSessionUser(adminClient)).id
    };
    if (!payload.coin_symbol || !payload.network || !payload.wallet_address) return setText('admin-wallet-message', 'Please fill coin, network and wallet address.');
    const result = editId ? await adminClient.from('wallet_pools').update(payload).eq('id', editId).select().single() : await adminClient.from('wallet_pools').insert(payload).select().single();
    if (result.error) return setText('admin-wallet-message', result.error.message);
    await audit(editId ? 'wallet_updated' : 'wallet_created', 'wallet_pools', result.data.id, { coin: payload.coin_symbol, network: payload.network });
    clearWalletForm();
    setText('admin-wallet-message', 'Wallet saved.');
    await loadAdminWallets();
  }
  async function loadAdminWallets() {
    const { data } = await adminClient.from('wallet_pools').select('*').order('created_at', { ascending: false });
    const body = qs('admin-wallets-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="7">No wallets found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.coin_symbol)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td class="code-small">${escapeHtml(row.wallet_address)}</td>
        <td>${row.qr_data_url ? '<span class="badge">Uploaded</span>' : '<span class="badge neutral">No QR</span>'}</td>
        <td>${row.rotate_daily ? 'Yes' : 'No'}</td>
        <td>${chip(row.is_active ? 'active' : 'inactive')}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs edit-wallet">Edit</button><button class="btn btn-secondary btn-xs toggle-wallet">${row.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn btn-danger btn-xs delete-wallet">Delete</button></div></td>`;
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
          preview.classList.toggle('empty-state', !row.qr_data_url);
        }
        document.querySelector('.side-link[data-target="admin-wallets"]')?.click();
      });
      tr.querySelector('.toggle-wallet').addEventListener('click', async () => {
        await adminClient.from('wallet_pools').update({ is_active: !row.is_active }).eq('id', row.id);
        await audit('wallet_toggled', 'wallet_pools', row.id, { is_active: !row.is_active });
        await loadAdminWallets();
      });
      tr.querySelector('.delete-wallet').addEventListener('click', async () => {
        if (!confirm('Delete this wallet?')) return;
        await adminClient.from('wallet_pools').delete().eq('id', row.id);
        await audit('wallet_deleted', 'wallet_pools', row.id, {});
        await loadAdminWallets();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminOrders() {
    const { data } = await adminClient.from('sell_orders').select('*, profiles!sell_orders_user_id_fkey(full_name,email,mobile)').order('created_at', { ascending: false });
    const body = qs('admin-orders-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="8">No sell orders found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const userName = row.profiles?.full_name || row.profiles?.email || '-';
      const payoutTo = row.payout_label || row.payout_details?.upi_id || row.payout_details?.account_number || '-';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="code-small">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(userName)}<br><span class="tiny-note">${escapeHtml(row.profiles?.mobile || row.profiles?.email || '')}</span></td>
        <td>${escapeHtml(row.coin_symbol)} / ${escapeHtml(row.network)}<br><span class="tiny-note">Wallet: ${escapeHtml(row.deposit_wallet_address || '-')}</span></td>
        <td>${escapeHtml(row.crypto_amount)}</td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td><div>${escapeHtml(payoutTo)}</div><div class="tiny-note">${escapeHtml(row.payout_method || '-')}</div></td>
        <td>${chip(row.status)}</td>
        <td><div class="actions-row"><button class="btn btn-secondary btn-xs order-next">Next Status</button><button class="btn btn-secondary btn-xs order-complete">Complete</button><button class="btn btn-danger btn-xs order-cancel">Cancel</button></div></td>`;
      tr.querySelector('.order-next').addEventListener('click', async () => {
        const nextMap = { quote_selected: 'awaiting_kyc', awaiting_kyc: 'awaiting_transfer', awaiting_transfer: 'awaiting_confirmations', awaiting_confirmations: 'payout_in_progress', payout_in_progress: 'completed', completed: 'completed', cancelled: 'cancelled' };
        const next = nextMap[row.status] || 'awaiting_transfer';
        await adminClient.from('sell_orders').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null }).eq('id', row.id);
        await audit('order_status_updated', 'sell_orders', row.id, { status: next });
        await loadAdminOrders();
        await loadAdminStats();
      });
      tr.querySelector('.order-complete').addEventListener('click', async () => {
        await adminClient.from('sell_orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', row.id);
        await audit('order_completed', 'sell_orders', row.id, { status: 'completed' });
        await loadAdminOrders();
        await loadAdminStats();
      });
      tr.querySelector('.order-cancel').addEventListener('click', async () => {
        await adminClient.from('sell_orders').update({ status: 'cancelled' }).eq('id', row.id);
        await audit('order_cancelled', 'sell_orders', row.id, { status: 'cancelled' });
        await loadAdminOrders();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminKyc() {
    const { data } = await adminClient.from('kyc_submissions').select('*, profiles!kyc_submissions_user_id_fkey(full_name,email,mobile)').order('created_at', { ascending: false });
    const body = qs('admin-kyc-body');
    if (!body) return;
    body.innerHTML = !(data || []).length ? '<tr><td colspan="6">No KYC submissions found.</td></tr>' : '';
    (data || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.profiles?.full_name || row.profiles?.email || '-')}</td>
        <td>${escapeHtml(row.id_type || '-')}</td>
        <td>${escapeHtml(row.id_number || '-')}</td>
        <td>${chip(row.status)}</td>
        <td>
          <div class="actions-row docs-inline">
            <button class="btn btn-secondary btn-xs view-front">Front</button>
            <button class="btn btn-secondary btn-xs view-back">Back</button>
            <button class="btn btn-secondary btn-xs view-selfie">Selfie</button>
          </div>
        </td>
        <td>
          <div class="actions-row">
            <button class="btn btn-primary btn-xs kyc-approve">Approve</button>
            <button class="btn btn-danger btn-xs kyc-reject">Reject</button>
          </div>
        </td>`;
      tr.querySelector('.view-front').addEventListener('click', () => row.front_image_data && window.open(row.front_image_data, '_blank'));
      tr.querySelector('.view-back').addEventListener('click', () => row.back_image_data && window.open(row.back_image_data, '_blank'));
      tr.querySelector('.view-selfie').addEventListener('click', () => row.selfie_image_data && window.open(row.selfie_image_data, '_blank'));
      tr.querySelector('.kyc-approve').addEventListener('click', async () => {
        await adminClient.from('kyc_submissions').update({ status: 'verified', review_note: 'Approved by admin' }).eq('id', row.id);
        await adminClient.from('profiles').update({ kyc_status: 'verified' }).eq('id', row.user_id);
        await audit('kyc_approved', 'kyc_submissions', row.id, {});
        await loadAdminKyc();
        await loadAdminUsers();
        await loadAdminStats();
      });
      tr.querySelector('.kyc-reject').addEventListener('click', async () => {
        const note = prompt('Enter reject reason', 'Document unclear') || 'Rejected by admin';
        await adminClient.from('kyc_submissions').update({ status: 'rejected', review_note: note }).eq('id', row.id);
        await adminClient.from('profiles').update({ kyc_status: 'rejected' }).eq('id', row.user_id);
        await audit('kyc_rejected', 'kyc_submissions', row.id, { note });
        await loadAdminKyc();
        await loadAdminUsers();
        await loadAdminStats();
      });
      body.appendChild(tr);
    });
  }

  async function loadAdminStats() {
    const [{ count: usersCount }, { count: ordersCount }, { count: kycPending }, { data: completedOrders }] = await Promise.all([
      adminClient.from('profiles').select('*', { count: 'exact', head: true }),
      adminClient.from('sell_orders').select('*', { count: 'exact', head: true }),
      adminClient.from('profiles').select('*', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
      adminClient.from('sell_orders').select('estimated_inr_payout').eq('status', 'completed')
    ]);
    const volume = (completedOrders || []).reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);
    setHtml('admin-stats', `
      <div class="card stat-card"><strong>${usersCount || 0}</strong><span>Total Users</span></div>
      <div class="card stat-card"><strong>${ordersCount || 0}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>${kycPending || 0}</strong><span>Pending KYC</span></div>
      <div class="card stat-card"><strong>${fmtInr(volume)}</strong><span>Completed Volume</span></div>`);
  }
  async function loadAdminLogs() {
    const { data } = await adminClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20);
    const html = !(data || []).length ? '<tr><td colspan="4">No audit logs yet.</td></tr>' : (data || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.action)}</td>
        <td>${escapeHtml(row.entity_type)}${row.entity_id ? ' / ' + escapeHtml(row.entity_id) : ''}</td>
        <td class="code-small">${escapeHtml(JSON.stringify(row.meta || {}))}</td>
        <td>${fmtDate(row.created_at)}</td>
      </tr>`).join('');
    setHtml('admin-audit-body', html);
    setHtml('admin-logs-body', html);
  }

  async function loadAdminDashboard() {
    bindSidebar();
    const profile = await ensureAdmin();
    if (!profile) return;
    setText('admin-name', profile.full_name || profile.email || 'Admin');

    qs('save-quote-template')?.addEventListener('click', saveQuoteTemplate);
    qs('reset-quote-form')?.addEventListener('click', resetQuoteForm);
    qs('save-coin-rate')?.addEventListener('click', saveCoinRate);
    qs('reset-rate-form')?.addEventListener('click', resetRateForm);
    qs('save-slab')?.addEventListener('click', saveQuoteSlab);
    qs('reset-slab-form')?.addEventListener('click', resetSlabForm);
    qs('save-wallet')?.addEventListener('click', saveWallet);
    qs('reset-wallet-form')?.addEventListener('click', clearWalletForm);

    await Promise.all([
      loadAdminStats(),
      loadAdminQuotes(),
      loadAdminRates(),
      loadAdminSlabs(),
      loadAdminUsers(),
      loadAdminKyc(),
      loadAdminWallets(),
      loadAdminOrders(),
      loadAdminLogs()
    ]);
  }

  if (page === 'referrals') {
    window.location.href = 'dashboard.html#seller-referrals';
    return;
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
  }
})();
