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

  function referralCodeFromUser(user, mobile) {
    const seed = (mobile || user?.email || user?.id || '').replace(/\D/g, '').slice(-5) || String(user?.id || '').slice(0, 5).replace(/-/g, '').toUpperCase();
    return 'SELL' + seed;
  }
  
  function getReferralCodeFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = (params.get('ref') || params.get('referral') || params.get('code') || '').trim();
      if (ref) {
        localStorage.setItem('pending_referral_code', ref);
        return ref;
      }
      return (localStorage.getItem('pending_referral_code') || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function resolveReferrerId(referralCode, currentUserId = null) {
    const code = String(referralCode || '').trim();
    if (!code) return null;

    const { data, error } = await sellerClient
      .from('profiles')
      .select('id, referral_code')
      .eq('referral_code', code)
      .maybeSingle();

    if (error) {
      console.warn('Referral lookup failed:', error.message);
      return null;
    }

    if (!data?.id || data.id === currentUserId) return null;
    return data.id;
  }

async function ensureSellerProfileRecord(user, extra = {}) {
    if (!user?.id) return null;
    const email = user.email || extra.email || '';
    const meta = user.user_metadata || {};
    const fullName = extra.full_name || meta.full_name || email.split('@')[0] || 'Seller';
    const mobile = extra.mobile || meta.mobile || '';
    const referralCode = referralCodeFromUser(user, mobile);

    const { data: existing } = await sellerClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const payload = {
      id: user.id,
      email,
      full_name: fullName,
      mobile,
      role: 'seller',
      user_status: existing?.user_status || 'active',
      kyc_status: existing?.kyc_status || 'not_submitted',
      referral_code: existing?.referral_code || referralCode
    };

    let resolvedReferrerId = extra.referred_by || null;
    if (!resolvedReferrerId) {
      const pendingReferralCode = extra.referral_code || getReferralCodeFromUrl();
      resolvedReferrerId = await resolveReferrerId(pendingReferralCode, user.id);
    }

    if (resolvedReferrerId && resolvedReferrerId !== user.id && !existing?.referred_by) {
      payload.referred_by = resolvedReferrerId;
    }

    const { error } = await sellerClient.from('profiles').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('Profile upsert failed:', error.message);
      return existing || null;
    }

    const { data } = await sellerClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if ((data || payload)?.referred_by) {
      try { localStorage.removeItem('pending_referral_code'); } catch (_) {}
    }
    return data || payload;
  }
  function bindSidebar() {
    document.querySelectorAll('.side-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.side-link').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel-section').forEach((s) => s.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target)?.classList.add('active');
        if (btn.dataset.target === 'admin-referrals') loadAdminReferralPanel?.();
        if (btn.dataset.target === 'admin-overview') renderAdminOverviewRecentOrder?.();
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
    // Compress mobile camera images before saving in Supabase text columns.
    // This avoids large payload errors during KYC submit.
    if (!file) return null;
    if (!file.type || !file.type.startsWith('image/')) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxSide = 1100;
          let { width, height } = img;
          if (width > maxSide || height > maxSide) {
            const ratio = Math.min(maxSide / width, maxSide / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function copyText(text) {
    try {
      if (!navigator.clipboard) return false;
      await navigator.clipboard.writeText(text || '');
      return true;
    } catch (e) {
      return false;
    }
  }
  function flashInlineCopyState(btn, ok, copiedLabel = '✓') {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.classList.remove('copied');
    btn.innerHTML = ok ? copiedLabel : '!';
    if (ok) btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 1400);
  }
  
  function buildPayoutDetails(row) {
    return payoutDetailFromRow(row);
  }
  function ensurePayoutModal() {
    let modal = qs('#payout-view-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'payout-view-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card payout-modal-card">
        <div class="modal-head">
          <div>
            <div class="modal-eyebrow">Payment Method View</div>
            <h3>Payout Details</h3>
          </div>
          <button class="modal-close" id="close-payout-modal">✕</button>
        </div>
        <div id="payout-modal-body" class="modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    qs('#close-payout-modal')?.addEventListener('click', closePayoutDetailsModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePayoutDetailsModal();
    });
    return modal;
  }
  function closePayoutDetailsModal() {
    qs('#payout-view-modal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
  
  function encodePayoutDataAttr(row) {
    try {
      return escapeHtml(JSON.stringify(buildPayoutDetails(row)));
    } catch (e) {
      return '';
    }
  }
  
  function payoutDetailsMarkup(details) {
    return `
      <div class="inline-payout-grid">
        <div class="inline-payout-row"><span>Payment Type</span><strong>${escapeHtml(String(details.method || '-').toUpperCase())}</strong></div>
        <div class="inline-payout-row"><span>Label</span><strong>${escapeHtml(details.label || '-')}</strong></div>
        <div class="inline-payout-row"><span>Holder Name</span><strong>${escapeHtml(details.holder || '-')}</strong></div>
        ${details.method === 'upi' ? `
          <div class="inline-payout-row"><span>UPI ID</span><strong>${escapeHtml(details.upi || '-')}</strong></div>
        ` : `
          <div class="inline-payout-row"><span>Bank Name</span><strong>${escapeHtml(details.bank || '-')}</strong></div>
          <div class="inline-payout-row"><span>Account Number</span><strong>${escapeHtml(details.account || '-')}</strong></div>
          <div class="inline-payout-row"><span>IFSC Code</span><strong>${escapeHtml(details.ifsc || '-')}</strong></div>
        `}
      </div>`;
  }
  function toggleInlinePayoutDetails(raw, targetId, triggerEl) {
    try {
      if (!raw || !targetId) return false;
      const target = qs('#' + targetId);
      if (!target) return false;
      const isOpen = target.classList.contains('open');
      const sameRaw = target.getAttribute('data-current') === raw;
      if (isOpen && sameRaw) {
        target.classList.remove('open');
        target.innerHTML = '';
        target.removeAttribute('data-current');
        if (triggerEl) triggerEl.textContent = 'View';
        return false;
      }
      const parsed = JSON.parse(raw);
      target.innerHTML = payoutDetailsMarkup(parsed);
      target.classList.add('open');
      target.setAttribute('data-current', raw);
      if (triggerEl) triggerEl.textContent = 'Hide';
      return false;
    } catch (e) {
      alert('Payout details could not be opened');
      return false;
    }
  }
window.showPayoutDetailsFromData = function(el) {
    try {
      const raw = el?.getAttribute('data-payout');
      if (!raw) {
        alert('Payout details not found');
        return false;
      }
      const parsed = JSON.parse(raw);
      openPayoutDetailsModal(parsed);
      return false;
    } catch (e) {
      alert('Payout details could not be opened');
      return false;
    }
  };
function openPayoutDetailsModal(details) {
    const modal = ensurePayoutModal();
    const body = qs('#payout-modal-body');
    if (!body) return;
    body.innerHTML = `
      <div class="payout-view-grid">
        <div class="payout-view-row"><span>Payment Type</span><strong>${escapeHtml(String(details.method || '-').toUpperCase())}</strong></div>
        <div class="payout-view-row"><span>Label</span><strong>${escapeHtml(details.label || '-')}</strong></div>
        <div class="payout-view-row"><span>Holder Name</span><strong>${escapeHtml(details.holder || '-')}</strong></div>
        ${details.method === 'upi' ? `
          <div class="payout-view-row"><span>UPI ID</span><strong>${escapeHtml(details.upi || '-')}</strong></div>
        ` : `
          <div class="payout-view-row"><span>Bank Name</span><strong>${escapeHtml(details.bank || '-')}</strong></div>
          <div class="payout-view-row"><span>Account Number</span><strong>${escapeHtml(details.account || '-')}</strong></div>
          <div class="payout-view-row"><span>IFSC Code</span><strong>${escapeHtml(details.ifsc || '-')}</strong></div>
        `}
      </div>`;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
function bindInlineCopy(buttonId, text, copiedLabel = '✓') {
    const btn = qs(buttonId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const ok = await copyText(text);
      flashInlineCopyState(btn, ok, copiedLabel);
    });
  }

  let selectedSellerQuote = null;

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
    const params = new URLSearchParams(window.location.search);
    const refFromUrl = params.get('ref') || params.get('referral') || '';
    if (refFromUrl && qs('register-referral')) qs('register-referral').value = refFromUrl;

    qs('login-btn')?.addEventListener('click', async () => {
      setText('auth-message', 'Logging in...');
      const email = val('login-email');
      const password = qs('login-password')?.value || '';
      if (!email || !password) return setText('auth-message', 'Please enter email and password.');

      const { data, error } = await sellerClient.auth.signInWithPassword({ email, password });
      if (error) return setText('auth-message', error.message);

      if (data?.user) {
        await ensureSellerProfileRecord(data.user, { email });
      }

      setText('auth-message', 'Login successful. Opening dashboard...');
      window.location.href = 'dashboard.html';
    });

    qs('register-btn')?.addEventListener('click', async () => {
      setText('auth-message', 'Creating account...');
      const full_name = val('register-name');
      const mobile = val('register-mobile');
      const email = val('register-email');
      const password = qs('register-password')?.value || '';
      const referralCode = val('register-referral');

      if (!full_name || !mobile || !email || !password) {
        return setText('auth-message', 'Please fill all required fields.');
      }

      let referredBy = null;
      if (referralCode) {
        const { data: refProfile } = await sellerClient
          .from('profiles')
          .select('id')
          .eq('referral_code', referralCode)
          .maybeSingle();
        referredBy = refProfile?.id || null;
      }

      const { data, error } = await sellerClient.auth.signUp({
        email,
        password,
        options: { data: { full_name, mobile, role: 'seller' } }
      });

      if (error) return setText('auth-message', error.message);

      const user = data?.user;
      if (user) {
        // If email confirmation is disabled, user/session is available immediately.
        // If confirmation is enabled, this upsert may be blocked until login; login handler will create it later.
        await ensureSellerProfileRecord(user, { full_name, mobile, email, referred_by: referredBy });
      }

      if (data?.session) {
        setText('auth-message', 'Account created. Opening dashboard...');
        window.location.href = 'dashboard.html';
      } else {
        setText('auth-message', 'Account created. If email confirmation is enabled, confirm email first, then login.');
      }
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

  function payoutDetailFromRow(row) {
    if (!row) return {};
    const raw = row.payout_details || row;
    const method = String(
      row.payout_method ||
      row.payment_method ||
      row.payout_type ||
      raw.payment_method ||
      raw.method ||
      (row.payout_upi_id || raw.upi_id ? 'upi' : 'bank')
    ).toLowerCase();

    return {
      method,
      label: row.payout_label || row.label || raw.label || (method === 'upi' ? 'UPI' : 'Bank Account'),
      holder: row.payout_account_holder_name || row.account_holder_name || raw.account_holder_name || raw.holder || '-',
      bank: row.payout_bank_name || row.bank_name || raw.bank_name || raw.bank || '-',
      account: row.payout_account_number || row.account_number || raw.account_number || raw.account || '-',
      ifsc: row.payout_ifsc_code || row.ifsc_code || raw.ifsc_code || raw.ifsc || '-',
      upi: row.payout_upi_id || row.upi_id || raw.upi_id || raw.upi || '-'
    };
  }

  function payoutDestinationLabel(row) {
    const d = payoutDetailFromRow(row);
    if (!d.method) return '-';
    if (d.method === 'upi') return `${d.label || 'UPI'} • ${d.upi || '-'} • Holder: ${d.holder || '-'}`;
    return `${d.bank || d.label || 'Bank'} • A/C: ${d.account || '-'} • IFSC: ${d.ifsc || '-'} • Holder: ${d.holder || '-'}`;
  }

  function payoutDetailsKvMarkup(row, rowClass = 'kv-row') {
    const d = payoutDetailFromRow(row);
    if (d.method === 'upi') {
      return `
        <div class="${rowClass}"><span>Payment Type</span><strong>UPI</strong></div>
        <div class="${rowClass}"><span>Label</span><strong>${escapeHtml(d.label || '-')}</strong></div>
        <div class="${rowClass}"><span>Holder Name</span><strong>${escapeHtml(d.holder || '-')}</strong></div>
        <div class="${rowClass}"><span>UPI ID</span><strong class="break-anywhere">${escapeHtml(d.upi || '-')}</strong></div>`;
    }
    return `
      <div class="${rowClass}"><span>Payment Type</span><strong>BANK</strong></div>
      <div class="${rowClass}"><span>Label</span><strong>${escapeHtml(d.label || '-')}</strong></div>
      <div class="${rowClass}"><span>Holder Name</span><strong>${escapeHtml(d.holder || '-')}</strong></div>
      <div class="${rowClass}"><span>Bank Name</span><strong>${escapeHtml(d.bank || '-')}</strong></div>
      <div class="${rowClass}"><span>Account Number</span><strong class="break-anywhere">${escapeHtml(d.account || '-')}</strong></div>
      <div class="${rowClass}"><span>IFSC Code</span><strong>${escapeHtml(d.ifsc || '-')}</strong></div>`;
  }
  function renderProfileBoxes(profile) {
    setText('seller-display-name', profile.full_name || profile.email || 'Seller');
    setText('seller-kyc-status-text', String(profile.kyc_status || 'not_submitted').replaceAll('_', ' '));
    setText('seller-kyc-level', profile.kyc_status === 'verified' ? 'Level 2 Verified' : 'Complete verification');
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
      setText('seller-active-payout-name', 'Not selected');
      setText('seller-active-payout-detail', 'Add bank / UPI');
      setText('seller-payout-preview-title', 'No payout method');
      setText('seller-payout-preview-sub', 'Add bank account or UPI ID');
      setText('seller-payout-preview-status', 'Setup');
      return [];
    }
    const primaryAccount = (accounts || []).find((a) => a.is_primary) || (accounts || [])[0];
    if (primaryAccount) {
      const primaryDestination = payoutDestinationLabel(primaryAccount);
      setText('seller-active-payout-name', primaryAccount.label || primaryAccount.bank_name || primaryAccount.upi_id || 'Payout Method');
      setText('seller-active-payout-detail', primaryDestination);
      setText('seller-payout-preview-title', primaryAccount.label || primaryAccount.bank_name || primaryAccount.upi_id || 'Payout Method');
      setText('seller-payout-preview-sub', primaryDestination);
      setText('seller-payout-preview-status', primaryAccount.is_active ? 'Active' : 'Inactive');
    }
    accounts.forEach((row) => {
      const destination = payoutDestinationLabel(row);
      const tr = document.createElement('tr');
      const d = payoutDetailFromRow(row);
      tr.innerHTML = `
        <td>${escapeHtml((d.method || 'bank').toUpperCase())}</td>
        <td>
          <strong>${escapeHtml(d.label || '-')}</strong>
          <div class="tiny-note">Holder: ${escapeHtml(d.holder || '-')}</div>
        </td>
        <td>
          ${d.method === 'upi'
            ? `<strong>UPI:</strong> <span class="break-anywhere">${escapeHtml(d.upi || '-')}</span>`
            : `<strong>Bank:</strong> ${escapeHtml(d.bank || '-')}<br><strong>A/C:</strong> <span class="break-anywhere">${escapeHtml(d.account || '-')}</span><br><strong>IFSC:</strong> ${escapeHtml(d.ifsc || '-')}`
          }
        </td>
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


  async function findMatchingActiveWallet(client, coin, network) {
    const { data, error } = await client
      .from('wallet_pools')
      .select('*')
      .eq('is_active', true)
      .eq('coin_symbol', coin)
      .eq('network', network)
      .order('created_at', { ascending: false });
    if (error) return null;
    if (data && data.length) return data[0];
    const fallback = await client
      .from('wallet_pools')
      .select('*')
      .eq('is_active', true)
      .eq('coin_symbol', coin)
      .order('created_at', { ascending: false });
    if (fallback.error) return null;
    return (fallback.data || [])[0] || null;
  }

  async function ensureOrderWalletAssignment(order) {
    if (!order || order.deposit_wallet_address) return order;
    const activeWallet = await findMatchingActiveWallet(sellerClient, order.coin_symbol, order.network);
    if (!activeWallet) return order;
    const patch = {
      deposit_wallet_address: activeWallet.wallet_address || null,
      deposit_wallet_qr_url: activeWallet.qr_data_url || activeWallet.qr_image_url || activeWallet.qr_code_url || null
    };
    const { data, error } = await sellerClient
      .from('sell_orders')
      .update(patch)
      .eq('id', order.id)
      .select()
      .single();
    if (error) return order;
    return data || { ...order, ...patch };
  }

  function onPayoutSelectorChange() {
    const opt = qs('bank-account-select')?.selectedOptions?.[0];
    if (!opt || !opt.value) return setHtml('selected-payout-summary', 'No payout method selected.');
    const details = JSON.parse(opt.dataset.details || '{}');
    setHtml('selected-payout-summary', `<div class="kv-list">${payoutDetailsKvMarkup(details)}</div>`);
  }
  function getOrderTrackingMeta(order) {
    const status = String(order?.status || '').toLowerCase();
    const hasTx = !!order?.tx_hash;
    const steps = [
      { key: 1, title: 'Crypto Sent Successfully', subtitle: hasTx ? 'TX hash submitted' : 'Waiting for crypto', state: hasTx ? 'done' : 'active' },
      { key: 2, title: 'Waiting for Admin Review', subtitle: 'Blockchain verification', state: 'pending' },
      { key: 3, title: 'Crypto Received Successfully', subtitle: 'Transfer confirmed', state: 'pending' },
      { key: 4, title: 'Waiting for INR Payment', subtitle: 'Payout in progress', state: 'pending' },
      { key: 5, title: 'Amount Sent Successfully', subtitle: 'Bank payout sent', state: 'pending' },
      { key: 6, title: 'Amount Successfully Received', subtitle: 'Credited to your account', state: 'pending' }
    ];

    if (!hasTx && ['draft', 'quote_selected', 'awaiting_transfer', 'awaiting_kyc'].includes(status)) {
      steps[0].state = 'active';
    }
    if (hasTx || ['awaiting_confirmations', 'payout_in_progress', 'completed'].includes(status)) {
      steps[0].state = 'done';
      steps[1].state = 'done';
    }
    if (['payout_in_progress', 'completed'].includes(status)) {
      steps[2].state = 'done';
      steps[3].state = status === 'completed' ? 'done' : 'active';
    }
    if (status === 'completed') {
      steps[4].state = 'done';
      steps[5].state = 'done';
    }
    if (status === 'cancelled' || status === 'rejected') {
      const idx = hasTx ? 1 : 0;
      steps[idx].state = 'active';
    }

    let banner = 'Select a quote, submit your order, and then send crypto to the assigned wallet.';
    if (!hasTx && ['awaiting_transfer', 'quote_selected', 'awaiting_kyc'].includes(status)) banner = 'Your order is created. Please send crypto to the wallet below and submit your TX hash.';
    if (status === 'awaiting_confirmations') banner = 'Great! Crypto sent successfully. We are verifying the blockchain transfer.';
    if (status === 'payout_in_progress') banner = 'Crypto received successfully. Waiting for INR payment to your selected payout account.';
    if (status === 'completed') banner = 'Amount successfully received in your account. This order is complete.';

    return { steps, banner, status };
  }

  
  async function cancelSellerPendingOrder(order) {
    if (!order?.id) return;
    if (order.tx_hash) {
      alert('TX hash already submitted. Please contact admin/support to cancel this order.');
      return;
    }

    const ok = confirm('Cancel this order and start again? Use this only if amount or payout method is wrong.');
    if (!ok) return;

    const { error } = await sellerClient
      .from('sell_orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', order.id)
      .is('tx_hash', null);

    if (error) {
      alert(error.message || 'Order cancel failed. Please contact support.');
      return;
    }

    try {
      await audit('seller_order_cancelled', 'sell_orders', order.id, { reason: 'seller_cancel_before_tx' });
    } catch (_) {}

    toggleSellerNewOrderLocked(false);
    resetSellerNewOrderState(true);
    qs('sell-amount') && (qs('sell-amount').value = '');
    qs('quotes-container') && (qs('quotes-container').innerHTML = '');
    qs('quotes-empty') && (qs('quotes-empty').textContent = 'Enter amount and payout method, then tap Get Best Admin Rate.');
    qs('quotes-empty') && (qs('quotes-empty').style.display = 'block');
    setText('quote-calc-message', 'Order cancelled. You can start a new Sell USDT order.');
    showAppToast('Order cancelled. You can start again.');
    qs('seller-sell-start-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }


  function normalizeTxHashValue(value) {
    return String(value || '').trim();
  }

  async function isDuplicateTxHash(txHash, currentOrderId = null) {
    const normalized = normalizeTxHashValue(txHash);
    if (!normalized) return false;

    let query = sellerClient
      .from('sell_orders')
      .select('id, tx_hash')
      .eq('tx_hash', normalized)
      .limit(1);

    if (currentOrderId) {
      query = query.neq('id', currentOrderId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Duplicate TX check failed:', error.message);
      return false;
    }

    return !!(data && data.length);
  }

async function renderDepositOrderBox(order) {
    const box = qs('deposit-order-box');
    const paymentCard = qs('seller-order-payment-card');
    const trackingCard = qs('seller-order-tracking-card');
    const trackingBox = qs('seller-post-payment-tracking');

    if (!box) return;

    if (!order) {
      if (paymentCard) paymentCard.classList.add('hidden-flow-card');
      if (trackingCard) trackingCard.classList.add('hidden-flow-card');
      box.innerHTML = '<div class="empty-state">Create Sell Order करने के बाद order summary, wallet address, QR और TX hash submit option यहाँ दिखेगा.</div>';
      if (trackingBox) trackingBox.innerHTML = '<div class="empty-state">TX hash submit करने के बाद tracking status यहाँ दिखेगा.</div>';
      return;
    }

    if (paymentCard) paymentCard.classList.remove('hidden-flow-card');

    if (isSellerOrderComplete(order)) {
      toggleSellerNewOrderLocked(false);
    }

    order = await ensureOrderWalletAssignment(order);
    const qr = order.deposit_wallet_qr_url || order.qr_image_url || order.qr_code_url || '';
    const walletMissing = !order.deposit_wallet_address;
    const tracking = getOrderTrackingMeta(order);

    const timeline = [
      { title: 'Order placed', note: 'Sell request created successfully.', ts: fmtDate(order.created_at) },
      { title: 'Crypto sent by seller', note: order.tx_hash ? `TX Hash: ${escapeHtml(order.tx_hash)}` : 'Waiting for TX hash from seller.', ts: order.tx_hash ? fmtDate(order.updated_at || order.created_at) : '--' },
      { title: 'Admin is reviewing transaction', note: 'We verify blockchain transfer before payout.', ts: ['awaiting_confirmations', 'payout_in_progress', 'completed'].includes(tracking.status) ? fmtDate(order.updated_at || order.created_at) : '--' },
      { title: 'Payout will be sent to bank / UPI', note: escapeHtml(order.payout_label || order.payout_upi_id || order.payout_account_number || '-'), ts: ['payout_in_progress', 'completed'].includes(tracking.status) ? fmtDate(order.updated_at || order.created_at) : '--' },
      { title: 'Amount successfully received', note: 'Please check your payout destination and confirm.', ts: tracking.status === 'completed' ? fmtDate(order.completed_at || order.updated_at || order.created_at) : '--' }
    ].map((item, i) => `<div class="timeline-row ${i < 3 && ['awaiting_confirmations','payout_in_progress','completed'].includes(tracking.status) || i === 0 || (i===1 && order.tx_hash) || (i===3 && ['payout_in_progress','completed'].includes(tracking.status)) || (i===4 && tracking.status==='completed') ? 'done' : ''}">
      <div class="timeline-dot"></div>
      <div class="timeline-copy"><strong>${item.title}</strong><span>${item.note}</span></div>
      <div class="timeline-time">${item.ts}</div>
    </div>`).join('');

    box.innerHTML = `
      <div class="seller-payment-summary-grid">
        <div class="seller-payment-left">
          <div class="summary-title">Order Summary</div>
          <div class="summary-list">
            <div class="summary-row"><span>Order ID</span><strong class="code-small">${escapeHtml(order.id || '-')}</strong></div>
            <div class="summary-row"><span>Coin / Network</span><strong>${escapeHtml(order.coin_symbol || '-')} / ${escapeHtml(order.network || '-')}</strong></div>
            <div class="summary-row"><span>Exact USDT Amount</span><strong class="summary-copy-wrap">${escapeHtml(String(order.crypto_amount || '-'))}<button id="copy-deposit-amount" class="mini-copy inline-copy" title="Copy amount">⧉</button></strong></div>
            <div class="summary-row"><span>Locked Rate</span><strong>${Number(order.locked_rate_inr || 0).toFixed(4)} INR</strong></div>
            <div class="summary-row"><span>Expected INR</span><strong>${fmtInr(order.estimated_inr_payout || 0)}</strong></div>
            <div class="summary-row"><span>Payout Method</span><strong class="summary-copy-wrap">${escapeHtml(order.payout_label || order.payout_upi_id || order.payout_account_number || '-')}<button id="view-payout-details" data-payout='${encodePayoutDataAttr(order)}' onclick="event.stopPropagation(); return toggleInlinePayoutDetails(this.getAttribute('data-payout'),'seller-payout-inline',this);" class="mini-view-btn" title="View payout details">View</button></strong></div>
            <div class="summary-row"><span>Wallet Address</span><strong class="code-small summary-copy-wrap">${escapeHtml(order.deposit_wallet_address || 'Wallet not assigned yet')}<button id="copy-deposit-address" class="mini-copy inline-copy" title="Copy wallet">⧉</button></strong></div>
            <div class="summary-row"><span>Current Status</span><strong>${escapeHtml(String(order.status || '-').replaceAll('_', ' '))}</strong></div>
            ${isSellerOrderComplete(order) ? '<div class="summary-row success-note-row"><span>Next Order</span><strong>यह order complete है. अब आप नया Sell USDT order start कर सकते हैं.</strong></div>' : ''}
            ${!order.tx_hash && !isSellerOrderComplete(order) ? '<div class="summary-row cancel-note-row"><span>Wrong Details?</span><strong>TX submit से पहले आप order cancel करके फिर से start कर सकते हैं.</strong></div>' : ''}
          </div>
          <div id="seller-payout-inline" class="inline-payout-box"></div>
          <div class="deposit-warning">Send only ${escapeHtml(order.coin_symbol || '')} on ${escapeHtml(order.network || '')}. Wrong network can cause loss of funds.</div>
        </div>

        <div class="seller-payment-right">
          <div class="summary-title">Scan QR / Send USDT</div>
          <a class="seller-payment-support-link" href="https://t.me/anmolaro" target="_blank" rel="noopener">Payment issue? Contact Telegram Support</a>
          ${!order.tx_hash && !isSellerOrderComplete(order) ? '<button id="cancel-active-order" class="btn btn-danger btn-block cancel-order-btn">Cancel Order & Start Again</button>' : ''}
          ${qr ? `<div class="image-preview-box fancy-qr seller-payment-qr"><img src="${escapeHtml(qr)}" alt="Wallet QR" /></div>` : '<div class="empty-state">QR not available yet. Use wallet address manually.</div>'}
          ${order.tx_hash ? `
            <div class="tx-success-box">
              <div class="tx-success-title">✓ Payment submitted successfully</div>
              <div class="tx-success-copy">TX Hash: <span class="code-small">${escapeHtml(order.tx_hash)}</span></div>
            </div>
          ` : `
            <div class="top-gap-sm deposit-submit-grid">
              <div><label>TX Hash</label><input id="deposit-tx-hash" placeholder="Paste blockchain tx hash" value="" /></div>
              <button id="mark-crypto-sent" class="btn btn-primary btn-block">I Have Sent USDT</button>
            </div>
            <p id="deposit-order-message" class="status-text">${walletMissing ? 'No active admin wallet is assigned for this coin/network yet. Please contact support or wait for admin wallet setup.' : ''}</p>
          `}
        </div>
      </div>`;

    if (order.tx_hash && trackingCard && trackingBox) {
      trackingCard.classList.remove('hidden-flow-card');
      trackingBox.innerHTML = `
        <div class="order-track-card">
          <div class="order-track-topline">
            <div><strong>Order ID:</strong> <span class="code-small">${escapeHtml(order.id || '-')}</span></div>
            <div class="muted">Placed on ${fmtDate(order.created_at)}</div>
          </div>
          <div class="track-banner">${tracking.banner}</div>
        </div>
        <div class="timeline-list top-gap-sm">${timeline}</div>`;
    } else if (trackingCard && trackingBox) {
      trackingCard.classList.add('hidden-flow-card');
      trackingBox.innerHTML = '<div class="empty-state">TX hash submit करने के बाद tracking status यहाँ दिखेगा.</div>';
    }

    bindInlineCopy('copy-deposit-address', order.deposit_wallet_address || '', '✓');
    bindInlineCopy('copy-deposit-amount', String(order.crypto_amount || ''), '✓');
    qs('cancel-active-order')?.addEventListener('click', () => cancelSellerPendingOrder(order));

    qs('mark-crypto-sent')?.addEventListener('click', async () => {
      const txHash = normalizeTxHashValue(val('deposit-tx-hash'));
      if (!txHash) return setText('deposit-order-message', 'Please enter TX hash first.');
      const duplicateTx = await isDuplicateTxHash(txHash, order.id);
      if (duplicateTx) {
        return setText('deposit-order-message', 'Duplicate TX hash. This transaction hash is already used in another order.');
      }
      const btn = qs('mark-crypto-sent');
      const input = qs('deposit-tx-hash');
      const message = qs('deposit-order-message');
      if (btn) {
        btn.disabled = true;
        btn.dataset.original = btn.textContent;
        btn.textContent = 'Submitting...';
      }
      if (input) input.disabled = true;
      if (message) {
        message.textContent = 'Submitting transaction hash...';
        message.classList.add('pending');
        message.classList.remove('error');
      }
      const nextStatus = order.status === 'awaiting_kyc' ? 'awaiting_kyc' : 'awaiting_confirmations';
      const { error } = await sellerClient.from('sell_orders').update({ tx_hash: txHash, status: nextStatus }).eq('id', order.id);
      if (error) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.original || 'I Have Sent USDT';
        }
        if (input) input.disabled = false;
        if (message) {
          const duplicateMsg = /duplicate|unique|tx_hash/i.test(error.message || '')
            ? 'Duplicate TX hash. This transaction hash is already used in another order.'
            : error.message;
          message.textContent = duplicateMsg;
          message.classList.remove('pending');
          message.classList.add('error');
        }
        return;
      }
      await audit('crypto_sent_marked', 'sell_orders', order.id, { tx_hash: txHash });
      const profile = await getProfile(sellerClient);
      await loadSellerStats(profile);
      const refreshed = await sellerClient.from('sell_orders').select('*').eq('id', order.id).single();
      if (refreshed.data) {
        renderDepositOrderBox(refreshed.data);
        qs('seller-order-tracking-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function renderSellerOrders(orders) {
    const body = qs('orders-body');
    if (!body) return;
    body.innerHTML = '';
    if (!(orders || []).length) {
      body.innerHTML = '<tr><td colspan="8">No sell orders found.</td></tr>';
      renderDepositOrderBox(null);
      return;
    }
    orders.forEach((row) => {
      const tr = document.createElement('tr');
      const payoutTo = row.payout_label || row.payout_details?.upi_id || row.payout_details?.account_number || '-';
      tr.innerHTML = `
        <td class="code-small">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.coin_symbol)} / ${escapeHtml(row.network)}<br><span class="tiny-note">Wallet: ${escapeHtml(row.deposit_wallet_address || '-')}</span></td>
        <td>${escapeHtml(row.crypto_amount)}</td>
        <td>${Number(row.locked_rate_inr || 0).toFixed(4)}</td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td>${escapeHtml(payoutTo)}</td>
        <td>${chip(row.status)}<br><button class="btn btn-secondary btn-xs open-order">Open</button></td>
        <td>${fmtDate(row.created_at)}</td>`;
      tr.querySelector('.open-order')?.addEventListener('click', () => {
        document.querySelector('.side-link[data-target="seller-sell"]')?.click();
        renderDepositOrderBox(row);
      });
      body.appendChild(tr);
    });
  }


  async function updateSellerPreviewRate() {
    try {
      const { data } = await sellerClient.from('quote_slabs').select('*').eq('coin_symbol', 'USDT').order('min_amount', { ascending: true });
      const rows = (data || []).filter((r) => (r.is_enabled === true || r.is_enabled === null || r.is_enabled === undefined) && Number(r.rate_inr || 0) > 0);
      if (!rows.length) return;
      const highest = Math.max(...rows.map((r) => Number(r.rate_inr || 0)));
      setText('seller-preview-rate', fmtInr(highest).replace('.00',''));
    } catch (e) {}
  }
  async function loadSellerStats(profile) {
    updateSellerPreviewRate();
    const [{ data: orders }, { data: accounts }, { data: rewards }] = await Promise.all([
      sellerClient.from('sell_orders').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      sellerClient.from('bank_accounts').select('*').eq('user_id', profile.id).eq('is_active', true),
      sellerClient.from('referral_rewards').select('*').eq('referrer_user_id', profile.id)
    ]);
    const active = (orders || []).filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
    const totalInr = (orders || []).filter((o) => o.status === 'completed').reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);
    const refEarn = (rewards || []).reduce((sum, row) => sum + Number(row.reward_amount_inr || 0), 0);
    setHtml('seller-stats', `
      <div class="card stat-card"><strong>▣ ${(orders || []).length}</strong><span>Total Orders</span></div>
      <div class="card stat-card"><strong>↗ ${active}</strong><span>Active Orders</span></div>
      <div class="card stat-card"><strong>🏦 ${(accounts || []).length}</strong><span>Payout Methods</span></div>
      <div class="card stat-card"><strong>${fmtInr(refEarn || totalInr)}</strong><span>${refEarn ? 'Referral Earnings' : 'Completed Volume'}</span></div>`);

    const latest = orders?.[0];
    if (!latest) {
      setHtml('latest-order-box', 'No recent order yet.');
      renderDepositOrderBox(null);
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
        <div class="action-row top-gap-sm"><button id="open-latest-order" class="btn btn-primary btn-xs">Open Deposit Step</button></div>`);
      qs('open-latest-order')?.addEventListener('click', () => {
        document.querySelector('.side-link[data-target="seller-sell"]')?.click();
        renderDepositOrderBox(latest);
      });
      renderDepositOrderBox(latest);
    }
    renderSellerOrders(orders || []);
  }

  
  function referralPayoutLabel(row) {
    if (!row) return '-';
    if ((row.payment_method || '').toLowerCase() === 'upi') {
      return `${row.label || 'UPI'} • ${row.upi_id || '-'}`;
    }
    return `${row.label || row.bank_name || 'Bank'} • ${row.account_number || '-'}`;
  }

  function renderReferralPayoutPreview(row) {
    if (!row) return '<div class="empty-state">Select payout method for referral withdrawal.</div>';
    const method = String(row.payment_method || 'bank').toLowerCase();
    if (method === 'upi') {
      return `<div class="kv-list compact-kv">
        <div class="kv-row"><span>Type</span><strong>UPI</strong></div>
        <div class="kv-row"><span>Holder</span><strong>${escapeHtml(row.account_holder_name || '-')}</strong></div>
        <div class="kv-row"><span>UPI ID</span><strong class="break-anywhere">${escapeHtml(row.upi_id || '-')}</strong></div>
      </div>`;
    }
    return `<div class="kv-list compact-kv">
      <div class="kv-row"><span>Type</span><strong>Bank</strong></div>
      <div class="kv-row"><span>Holder</span><strong>${escapeHtml(row.account_holder_name || '-')}</strong></div>
      <div class="kv-row"><span>Bank</span><strong>${escapeHtml(row.bank_name || '-')}</strong></div>
      <div class="kv-row"><span>Account</span><strong class="break-anywhere">${escapeHtml(row.account_number || '-')}</strong></div>
      <div class="kv-row"><span>IFSC</span><strong>${escapeHtml(row.ifsc_code || '-')}</strong></div>
    </div>`;
  }




  async function getFreshReferralWithdrawalState(profileId) {
    const [{ data: rewards }, { data: withdrawals }] = await Promise.all([
      sellerClient
        .from('referral_rewards')
        .select('*')
        .eq('referrer_user_id', profileId),
      sellerClient
        .from('referral_withdrawals')
        .select('*')
        .eq('user_id', profileId)
    ]);

    const available = availableReferralBalance(rewards || [], withdrawals || []);
    return { available, rewards: rewards || [], withdrawals: withdrawals || [] };
  }

async function loadReferralsSection(profile) {
    const origin = window.location.origin && window.location.origin.includes('http') ? window.location.origin : window.location.href.split('/').slice(0,-1).join('/');
    const refCode = profile.referral_code || '-';
    const refLink = `${origin}/login.html?ref=${refCode}`;
    setText('ref-code-box', refCode);
    setText('ref-link-box', refLink);
    qs('copy-ref-code')?.addEventListener('click', async () => { const ok = await copyText(refCode); flashInlineCopyState(qs('copy-ref-code'), ok, '✓'); });
    qs('copy-ref-link')?.addEventListener('click', async () => { const ok = await copyText(refLink); flashInlineCopyState(qs('copy-ref-link'), ok, '✓'); });
    qs('refresh-referrals')?.addEventListener('click', () => loadReferralsSection(profile));

    const [{ data: referredUsers }, { data: rewards }, { data: withdrawals }, { data: payoutAccounts }] = await Promise.all([
      sellerClient
        .from('profiles')
        .select('id,full_name,email,mobile,user_status,kyc_status,created_at')
        .eq('referred_by', profile.id)
        .order('created_at', { ascending: false }),
      sellerClient
        .from('referral_rewards')
        .select('*, referred_user:referred_user_id(full_name,email,mobile)')
        .eq('referrer_user_id', profile.id)
        .order('created_at', { ascending: false }),
      sellerClient
        .from('referral_withdrawals')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false }),
      sellerClient
        .from('bank_accounts')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
    ]);

    setText('stat-total-referrals', String((referredUsers || []).length));
    setText('stat-active-referrals', String((referredUsers || []).filter((u) => u.user_status === 'active').length));

    const totalEarned = (rewards || [])
      .filter((r) => !['rejected','cancelled'].includes(referralStatusText(r.reward_status || r.status)))
      .reduce((s, r) => s + referralRewardValue(r), 0);

    const pendingRewards = (rewards || [])
      .filter((r) => ['pending','approved','earned'].includes(referralStatusText(r.reward_status || r.status)))
      .reduce((s, r) => s + referralRewardValue(r), 0);

    const withdrawnOrRequested = (withdrawals || [])
      .filter((w) => !['rejected','cancelled'].includes(referralStatusText(w.status, 'requested')))
      .reduce((s, w) => s + referralWithdrawalValue(w), 0);

    const available = Math.max(0, +(totalEarned - withdrawnOrRequested).toFixed(2));

    setText('stat-ref-earnings', fmtInr(totalEarned));
    setText('stat-ref-available', fmtInr(available));
    setText('stat-pending-rewards', fmtInr(pendingRewards));
    setText('stat-ref-paid', fmtInr(withdrawnOrRequested));
    setText('ref-balance-breakdown', `Total Earned: ${fmtInr(totalEarned)} • Withdrawn/Requested: ${fmtInr(withdrawnOrRequested)} • Remaining: ${fmtInr(available)}`);
    const withdrawBtn = qs('request-ref-withdrawal');
    const withdrawMsg = qs('ref-withdraw-message');
    if (available < 2000 && withdrawBtn) {
      withdrawBtn.disabled = true;
      withdrawBtn.textContent = 'Not Enough Balance';
      if (withdrawMsg) withdrawMsg.textContent = `Remaining balance is ${fmtInr(available)}. Minimum withdrawal is ₹2,000.`;
    } else if (withdrawBtn) {
      withdrawBtn.disabled = false;
      withdrawBtn.textContent = 'Request Withdrawal';
      if (withdrawMsg && /not enough|minimum|remaining balance|available referral balance/i.test(withdrawMsg.textContent || '')) withdrawMsg.textContent = '';
    }


    const payoutSelect = qs('ref-withdraw-payout-select');
    const payoutPreview = qs('ref-withdraw-payout-preview');
    if (payoutSelect) {
      const list = payoutAccounts || [];
      payoutSelect.innerHTML = list.length
        ? '<option value="">Select payout method</option>' + list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(referralPayoutLabel(p))}${p.is_primary ? ' • Primary' : ''}</option>`).join('')
        : '<option value="">No payout method found</option>';
      payoutSelect.onchange = () => {
        const selected = list.find((p) => p.id === payoutSelect.value);
        if (payoutPreview) payoutPreview.innerHTML = renderReferralPayoutPreview(selected);
      };
      const primary = list.find((p) => p.is_primary) || list[0];
      if (primary) {
        payoutSelect.value = primary.id;
        if (payoutPreview) payoutPreview.innerHTML = renderReferralPayoutPreview(primary);
      } else if (payoutPreview) {
        payoutPreview.innerHTML = '<div class="empty-state">Please add payout method first from Payout section.</div>';
      }
    }


    const referredBody = qs('referred-users-body');
    const referredCards = qs('referred-users-cards');
    const referredList = referredUsers || [];

    if (referredBody) {
      referredBody.innerHTML = !referredList.length
        ? '<tr><td colspan="4">No referred sellers yet.</td></tr>'
        : referredList.map((u) => `
          <tr>
            <td><strong>${escapeHtml(u.full_name || 'Unnamed Seller')}</strong><div class="tiny-note">KYC: ${escapeHtml(u.kyc_status || '-')}</div></td>
            <td>${escapeHtml(u.email || '-')}<div class="tiny-note">${escapeHtml(u.mobile || '')}</div></td>
            <td>${chip(u.user_status || 'active')}</td>
            <td>${fmtDate(u.created_at)}</td>
          </tr>`).join('');
    }

    if (referredCards) {
      referredCards.innerHTML = !referredList.length
        ? '<div class="empty-state">No referred sellers yet. Share your referral link.</div>'
        : referredList.map((u) => `
          <div class="referred-user-card">
            <div class="referred-user-avatar">${escapeHtml((u.full_name || u.email || 'S').slice(0, 2).toUpperCase())}</div>
            <div class="referred-user-info">
              <strong>${escapeHtml(u.full_name || 'Unnamed Seller')}</strong>
              <span>${escapeHtml(u.email || '-')}</span>
              <small>${escapeHtml(u.mobile || '')}</small>
            </div>
            <div class="referred-user-status">${chip(u.user_status || 'active')}<small>KYC: ${escapeHtml(u.kyc_status || '-')}</small></div>
          </div>`).join('');
    }

    const body = qs('referrals-body');
    if (body) {
      body.innerHTML = !(rewards || []).length
        ? '<tr><td colspan="6">No referral rewards yet.</td></tr>'
        : (rewards || []).map((r) => `
          <tr>
            <td>
              <strong>${escapeHtml(r.referred_user?.full_name || 'Unnamed Seller')}</strong>
              <div class="tiny-note">${escapeHtml(r.referred_user?.email || '')}</div>
              <div class="tiny-note">${escapeHtml(r.referred_user?.mobile || '')}</div>
            </td>
            <td class="code-small">${escapeHtml(r.order_id || '-')}</td>
            <td>${Number(r.reward_percent || 0.10).toFixed(2)}%</td>
            <td>${fmtInr(r.reward_amount_inr)}</td>
            <td>${chip(r.reward_status)}</td>
            <td>${fmtDate(r.created_at)}</td>
          </tr>`).join('');
    }

    const withdrawBody = qs('ref-withdrawals-body');
    if (withdrawBody) {
      withdrawBody.innerHTML = !(withdrawals || []).length
        ? '<tr><td colspan="5">No withdrawal request yet.</td></tr>'
        : (withdrawals || []).map((w) => `<tr>
          <td>${fmtInr(w.amount_inr)}</td>
          <td>${escapeHtml(w.payout_label || 'Saved payout method')}<div class="tiny-note break-anywhere">${escapeHtml(w.payout_details?.upi_id || w.payout_details?.account_number || '')}</div></td>
          <td>${chip(w.status)}</td>
          <td>${fmtDate(w.created_at)}</td>
          <td>${w.paid_at ? fmtDate(w.paid_at) : '-'}</td>
        </tr>`).join('');
    }

    // ref-withdraw-amount-live-guard
    qs('ref-withdraw-amount')?.addEventListener('input', () => {
      const amount = Number(val('ref-withdraw-amount') || 0);
      const btn = qs('request-ref-withdrawal');
      if (!btn || btn.textContent === 'Withdrawal Request Pending') return;
      if (available < 2000) {
        btn.disabled = true;
        btn.textContent = 'Not Enough Balance';
        setText('ref-withdraw-message', `Available referral balance is ${fmtInr(available)}. Minimum withdrawal is ₹2,000.`);
      } else {
        btn.disabled = false;
        btn.textContent = 'Request Withdrawal';
        if (amount > available) setText('ref-withdraw-message', `Available referral balance is ${fmtInr(available)}.`);
      }
    });

    qs('request-ref-withdrawal')?.addEventListener('click', async () => {
      const btn = qs('request-ref-withdrawal');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Checking...';
      }

      const freshState = await getFreshReferralWithdrawalState(profile.id);
      const amount = Number(val('ref-withdraw-amount') || 0);
      const freshAvailable = Number(freshState.available || 0);


      if (!amount) {
        if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; }
        return setText('ref-withdraw-message', 'Enter withdrawal amount.');
      }
      if (amount < 2000) {
        if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; }
        return setText('ref-withdraw-message', 'Minimum referral withdrawal is ₹2,000.');
      }
      if (amount > freshAvailable) {
        if (btn) {
          btn.disabled = freshAvailable < 2000;
          btn.textContent = freshAvailable < 2000 ? 'Not Enough Balance' : 'Request Withdrawal';
        }
        return setText('ref-withdraw-message', `Remaining balance is ${fmtInr(freshAvailable)}. Withdrawal request cannot be more than remaining balance.`);
      }

      const payoutId = val('ref-withdraw-payout-select');
      if (!payoutId) { const btn = qs('request-ref-withdrawal'); if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; } return setText('ref-withdraw-message', 'Please select payout method for withdrawal.'); }
      const activePayout = (payoutAccounts || []).find((p) => p.id === payoutId);
      if (!activePayout) { const btn = qs('request-ref-withdrawal'); if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; } return setText('ref-withdraw-message', 'Selected payout method not found. Please add payout method again.'); }
      const { error } = await sellerClient.from('referral_withdrawals').insert({
        user_id: profile.id,
        amount_inr: amount,
        status: 'requested',
        payout_method_id: activePayout.id,
        payout_label: referralPayoutLabel(activePayout),
        payout_details: activePayout
      });
      if (error) { const btn = qs('request-ref-withdrawal'); if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; } return setText('ref-withdraw-message', /duplicate|unique/i.test(error.message || '') ? 'You already have an active withdrawal request. Please wait for admin action.' : error.message); }
      setText('ref-withdraw-message', 'Withdrawal request submitted. Admin will review and pay manually.');
      showAppToast('Referral withdrawal request submitted.');
      qs('request-ref-withdrawal') && (qs('request-ref-withdrawal').disabled = true);
      qs('request-ref-withdrawal') && (qs('request-ref-withdrawal').textContent = 'Request Submitted');
      qs('ref-withdraw-amount').value = '';
      await loadReferralsSection(profile);
    });
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
      const btn = qs('submit-kyc-btn');
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Submitting...';
        }
        setText('kyc-message', 'Compressing and submitting KYC...');

        const front = qs('kyc-front-file')?.files?.[0];
        const back = qs('kyc-back-file')?.files?.[0];
        const selfie = qs('kyc-selfie-file')?.files?.[0];

        const fullName = val('kyc-full-name') || profile.full_name || '';
        const idType = val('kyc-id-type') || 'aadhaar';
        const idNumber = val('kyc-id-number');
        const dob = val('kyc-dob') || null;
        const address = val('kyc-address') || null;

        if (!fullName || !idNumber) {
          setText('kyc-message', 'Please fill name and ID number.');
          return;
        }

        const frontData = front ? await readFileAsDataUrl(front) : null;
        const backData = back ? await readFileAsDataUrl(back) : null;
        const selfieData = selfie ? await readFileAsDataUrl(selfie) : null;

        // Stable path: database RPC handles profile check + KYC insert/update.
        let rpcResult = await sellerClient.rpc('submit_kyc', {
          p_full_name: fullName,
          p_dob: dob,
          p_id_type: idType,
          p_id_number: idNumber,
          p_address: address,
          p_front_image_data: frontData,
          p_back_image_data: backData,
          p_selfie_image_data: selfieData
        });

        if (rpcResult.error) {
          // fallback old direct insert/update if RPC is not installed yet
          const payload = {
            user_id: profile.id,
            full_name: fullName,
            dob,
            id_type: idType,
            id_number: idNumber,
            address,
            status: 'pending',
            review_note: null
          };
          if (frontData) payload.front_image_data = frontData;
          if (backData) payload.back_image_data = backData;
          if (selfieData) payload.selfie_image_data = selfieData;

          let result;
          const editId = val('kyc-edit-id');
          if (editId) {
            result = await sellerClient.from('kyc_submissions').update(payload).eq('id', editId).select().single();
          } else {
            result = await sellerClient.from('kyc_submissions').insert(payload).select().single();
          }

          if (result.error) {
            setText('kyc-message', result.error.message || rpcResult.error.message || 'KYC submit failed.');
            return;
          }
        }

        await sellerClient.from('profiles').update({ kyc_status: 'pending' }).eq('id', profile.id).then(() => null);
        try { await audit('kyc_submitted', 'kyc_submissions', profile.id, { status: 'pending' }); } catch (_) {}

        setText('kyc-message', 'KYC submitted successfully. Status: pending review.');
        const freshProfile = await getProfile(sellerClient);
        await loadKycSection(freshProfile || profile);
        renderProfileBoxes(freshProfile || profile);
      } catch (err) {
        setText('kyc-message', err?.message || 'KYC submit failed. Please refresh and try again.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit KYC';
        }
      }
    });

  }


  function normalizeSlabRow(s, templates = []) {
    const tpl = (templates || []).find((t) => t.id === s.quote_template_id || t.quote_type === s.quote_type) || {};
    const minVal = Number(s.min_amount ?? s.min_crypto_amount ?? 0);
    const rawMax = s.max_amount ?? s.max_crypto_amount;
    return {
      ...s,
      quote_slab_id: s.id,
      quote_template_id: s.quote_template_id || tpl.id || null,
      quote_type: s.quote_type || tpl.quote_type || 'standard',
      quote_name: tpl.quote_name || s.quote_name || s.quote_type || 'Quote',
      description: tpl.description || s.description || 'Sell directly from this quote slab.',
      payout_time_label: tpl.payout_time_label || s.payout_time_label || '-',
      coin_symbol: String(s.coin_symbol || '').toUpperCase(),
      network: String(s.network || '').toUpperCase(),
      min_amount: minVal,
      max_amount: rawMax === null || rawMax === undefined || rawMax === '' ? null : Number(rawMax),
      rate_inr: Number(s.rate_inr || 0),
      spread_percent: Number(s.spread_percent || 0),
      is_enabled: s.is_enabled !== false
    };
  }

  function slabMatchesAmount(slab, amount) {
    const min = Number(slab.min_amount ?? slab.min_crypto_amount ?? 0);
    const rawMax = slab.max_amount ?? slab.max_crypto_amount;
    const max = rawMax === null || rawMax === undefined || rawMax === '' ? null : Number(rawMax);
    return amount >= min && (max === null || amount <= max);
  }

  function slabRangeLabel(slab) {
    const min = Number(slab.min_amount ?? slab.min_crypto_amount ?? 0);
    const rawMax = slab.max_amount ?? slab.max_crypto_amount;
    const max = rawMax === null || rawMax === undefined || rawMax === '' ? null : Number(rawMax);
    return `${min} - ${max === null ? 'Unlimited' : max}`;
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
    const normalizedSlabsForSelect = (slabs || []).map((s) => normalizeSlabRow(s, templates));
    const uniqueCoins = [...new Set([...(rates || []).map((r) => String(r.coin_symbol || '').toUpperCase()), ...normalizedSlabsForSelect.map((s) => s.coin_symbol)].filter(Boolean))];
    coinSelect.value = 'USDT';
    networkSelect.value = 'TRC20';
    const fillNetworks = () => {
      coinSelect.value = 'USDT';
      networkSelect.value = 'TRC20';
    };
    coinSelect.addEventListener?.('change', fillNetworks);
    fillNetworks();

    ['sell-amount','bank-account-select','sell-coin','sell-network'].forEach((id) => {
      qs(id)?.addEventListener('input', resetSellerNewOrderState);
      qs(id)?.addEventListener('change', resetSellerNewOrderState);
    });

    await showLatestActiveOrderIfAny(profile);

    qs('show-quotes-btn')?.addEventListener('click', async () => {
      const activeOrder = await showLatestActiveOrderIfAny(profile, { scroll: true });
      if (activeOrder) {
        return setText('quote-calc-message', 'पहले आपका active order complete होगा, उसके बाद नया order start कर पाएंगे.');
      }
      resetSellerNewOrderState(true);
      const coin = 'USDT';
      const network = 'TRC20';
      const amount = Number(val('sell-amount'));
      const payoutId = val('bank-account-select');
      if (!coin || !network || !amount || !payoutId) return setText('quote-calc-message', 'Please enter USDT amount and select payout method.');

      const payoutAccounts = await renderPayoutAccounts(profile.id);
      const payout = (payoutAccounts || []).find((x) => x.id === payoutId);
      if (!payout) return setText('quote-calc-message', 'Please select a valid payout method.');

      const activeWallet = await findMatchingActiveWallet(sellerClient, coin, network);
      if (!activeWallet?.wallet_address) return setText('quote-calc-message', 'No active admin wallet found for this coin/network. Please contact support.');

      const normalizedSlabs = (slabs || []).map((s) => normalizeSlabRow(s, templates));
      let matchingSlabs = normalizedSlabs.filter((s) =>
        s.is_enabled &&
        s.coin_symbol === coin &&
        s.network === network &&
        slabMatchesAmount(s, amount)
      );

      // If user came from Rate Board, never lose that slab.
      // This fixes higher amount / open-ended slabs showing as Not Available.
      if (selectedSellerQuote) {
        const selected = normalizeSlabRow(selectedSellerQuote, templates);
        const sameSlab = selected.quote_slab_id && matchingSlabs.some((s) => s.quote_slab_id === selected.quote_slab_id);
        if (selected.coin_symbol === coin && selected.network === network && slabMatchesAmount(selected, amount) && !sameSlab) {
          matchingSlabs.unshift(selected);
        }
      }

      const container = qs('quotes-container');
      const empty = qs('quotes-empty');
      container.innerHTML = '';
      if (!matchingSlabs.length) {
        empty.style.display = 'block';
        const nextHigher = normalizedSlabs
          .filter((s) => s.is_enabled && s.coin_symbol === coin && s.network === network && amount < Number(s.min_amount || 0))
          .sort((a, b) => Number(a.min_amount || 0) - Number(b.min_amount || 0))[0];
        empty.textContent = nextHigher
          ? `No slab matched this amount. Add ${Number(nextHigher.min_amount || 0) - amount} ${coin} more to unlock ${Number(nextHigher.rate_inr || 0).toFixed(4)} rate.`
          : 'No admin rate slab matches this amount. Please enter an amount within an active admin slab range.';
        return;
      }
      empty.style.display = 'none';

      matchingSlabs
        .sort((a, b) => (selectedSellerQuote?.quote_slab_id === a.quote_slab_id ? -1 : 0) || Number(b.rate_inr || 0) - Number(a.rate_inr || 0))
        .forEach((slab, index) => {
          const finalRate = Number(slab.rate_inr || 0);
          const estimated = amount * finalRate;
          const isSelected = selectedSellerQuote && (selectedSellerQuote.quote_slab_id === slab.quote_slab_id || selectedSellerQuote.id === slab.id);
          const card = document.createElement('div');
          card.className = 'quote-card' + ((isSelected || index === 0) ? ' recommended' : '');
          card.innerHTML = `
            <div class="badge ${(isSelected || index === 0) ? '' : 'neutral'}">${isSelected ? 'Chosen Quote' : index === 0 ? 'Recommended' : 'Available'}</div>
            <h4>${escapeHtml(slab.quote_name || slab.quote_type || 'Quote')}</h4>
            <p>${escapeHtml(slab.description || 'Admin-created quote slab')}</p>
            <div class="kv-list">
              <div class="kv-row"><span>Rate</span><strong>${Number(finalRate).toFixed(4)}</strong></div>
              <div class="kv-row"><span>Estimated INR</span><strong>${fmtInr(estimated)}</strong></div>
              <div class="kv-row"><span>Payout Time</span><strong>${escapeHtml(slab.payout_time_label || '-')}</strong></div>
              <div class="kv-row"><span>Amount Slab</span><strong>${escapeHtml(slabRangeLabel(slab))}</strong></div>
            </div>
            <div class="action-row top-gap-sm"><button class="btn btn-primary select-quote">Create Sell Order</button></div>`;

          card.querySelector('.select-quote').addEventListener('click', async () => {
            const payload = {
              user_id: profile.id,
              bank_account_id: payout.id,
              quote_template_id: slab.quote_template_id || null,
              quote_slab_id: slab.quote_slab_id || slab.id || null,
              coin_symbol: coin,
              network,
              crypto_amount: amount,
              locked_rate_inr: finalRate,
              spread_percent: Number(slab.spread_percent || 0),
              estimated_inr_payout: estimated,
              payout_method: payout.payment_method,
              payout_label: payoutDestinationLabel(payout),
              payout_account_holder_name: payout.account_holder_name || null,
              payout_bank_name: payout.bank_name || null,
              payout_account_number: payout.account_number || null,
              payout_ifsc_code: payout.ifsc_code || null,
              payout_upi_id: payout.upi_id || null,
              payout_details: payout,
              deposit_wallet_address: activeWallet.wallet_address,
              deposit_wallet_qr_url: activeWallet.qr_data_url || activeWallet.qr_image_url || activeWallet.qr_code_url || null,
              status: profile.kyc_status === 'verified' ? 'awaiting_transfer' : 'awaiting_kyc'
            };
            const { data: order, error } = await sellerClient.from('sell_orders').insert(payload).select().single();
            if (error) return setText('quote-calc-message', error.message);
            await audit('sell_order_created', 'sell_orders', order.id, { coin, network, amount, payout_method: payout.payment_method, quote_type: slab.quote_type, quote_slab_id: slab.quote_slab_id || slab.id });
            setText('quote-calc-message', `Order created. Send ${amount} ${coin} to the shown wallet.`);
            selectedSellerQuote = null;
            setSelectedQuoteBanner();
            await loadSellerStats(profile);
            document.querySelector('.side-link[data-target="seller-sell"]')?.click();
            renderDepositOrderBox(order);
          });
          container.appendChild(card);
        });
    });
    qs('refresh-quotes-btn')?.addEventListener('click', () => renderAvailableQuotesPage());
    qs('quotes-amount')?.addEventListener('input', () => renderAvailableQuotesPage());
    qs('bank-account-select')?.addEventListener('change', onPayoutSelectorChange);
    setSelectedQuoteBanner();
    resetSellerNewOrderState();
    await renderAvailableQuotesPage();
    qs('bank-account-select')?.addEventListener('change', onPayoutSelectorChange);
  }




  function isSellerOrderComplete(order) {
    return ['completed', 'paid', 'cancelled', 'rejected'].includes(String(order?.status || '').toLowerCase());
  }

  async function getLatestActiveSellerOrder(userId) {
    if (!userId) return null;
    const { data, error } = await sellerClient
      .from('sell_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8);

    if (error) {
      console.warn('Latest active order lookup failed:', error.message);
      return null;
    }

    return (data || []).find((order) => !isSellerOrderComplete(order)) || null;
  }

  function toggleSellerNewOrderLocked(isLocked) {
    qs('active-order-lock-banner')?.classList.toggle('hidden-flow-card', !isLocked);
    qs('seller-sell-start-card')?.classList.toggle('hidden-flow-card', isLocked);
    qs('show-quotes-btn')?.toggleAttribute('disabled', !!isLocked);
  }

  async function showLatestActiveOrderIfAny(profile, options = {}) {
    const activeOrder = await getLatestActiveSellerOrder(profile?.id);
    if (!activeOrder) {
      toggleSellerNewOrderLocked(false);
      if (options.resetWhenNone) resetSellerNewOrderState();
      return null;
    }

    toggleSellerNewOrderLocked(true);
    qs('quotes-container') && (qs('quotes-container').innerHTML = '');
    qs('quotes-empty') && (qs('quotes-empty').textContent = 'आपका एक active order चल रहा है. नया rate/order complete होने के बाद ही start होगा.');
    qs('quotes-empty') && (qs('quotes-empty').style.display = 'block');

    await renderDepositOrderBox(activeOrder);
    qs('seller-order-payment-card')?.classList.remove('hidden-flow-card');
    if (activeOrder.tx_hash) qs('seller-order-tracking-card')?.classList.remove('hidden-flow-card');

    if (options.scroll) {
      qs('seller-order-payment-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return activeOrder;
  }

  function resetSellerNewOrderState(force = false) {
    const paymentCard = qs('seller-order-payment-card');
    const trackingCard = qs('seller-order-tracking-card');
    const depositBox = qs('deposit-order-box');
    const trackingBox = qs('seller-post-payment-tracking');
    const quoteMsg = qs('quote-calc-message');

    if (!force && !qs('active-order-lock-banner')?.classList.contains('hidden-flow-card')) return;
    paymentCard?.classList.add('hidden-flow-card');
    trackingCard?.classList.add('hidden-flow-card');

    if (depositBox) {
      depositBox.innerHTML = '<div class="empty-state">Create Sell Order करने के बाद order summary, wallet address, QR और TX hash submit option यहाँ दिखेगा.</div>';
    }
    if (trackingBox) {
      trackingBox.innerHTML = '<div class="empty-state">TX hash submit करने के बाद tracking status यहाँ दिखेगा.</div>';
    }
    if (quoteMsg) {
      quoteMsg.textContent = '';
      quoteMsg.classList.remove('error', 'pending');
    }
  }

  function setSelectedQuoteBanner() {
    const banner = qs('selected-quote-banner');
    const hint = qs('quotes-selected-hint');
    if (!selectedSellerQuote) {
      if (banner) banner.innerHTML = 'Select a quote from Rate Board to prefill this sell request, or search manually below.';
      if (hint) hint.innerHTML = 'Choose a slab to continue with sell request.';
      return;
    }
    const slabLabel = `${Number(selectedSellerQuote.min_amount ?? selectedSellerQuote.min_crypto_amount ?? 0)} - ${(selectedSellerQuote.max_amount ?? selectedSellerQuote.max_crypto_amount) ? Number(selectedSellerQuote.max_amount ?? selectedSellerQuote.max_crypto_amount) : 'Unlimited'} ${selectedSellerQuote.coin_symbol}`;
    const html = `<div class="kv-row"><span>Chosen Quote</span><strong>${escapeHtml(selectedSellerQuote.quote_name || selectedSellerQuote.quote_type || 'Quote')}</strong></div>
      <div class="kv-row"><span>Coin / Network</span><strong>${escapeHtml(selectedSellerQuote.coin_symbol)} / ${escapeHtml(selectedSellerQuote.network)}</strong></div>
      <div class="kv-row"><span>Slab</span><strong>${escapeHtml(slabLabel)}</strong></div>
      <div class="kv-row"><span>Rate</span><strong>${Number(selectedSellerQuote.rate_inr || 0).toFixed(4)}</strong></div>`;
    if (banner) banner.innerHTML = html;
    if (hint) hint.innerHTML = `Selected ${escapeHtml(selectedSellerQuote.quote_name || selectedSellerQuote.quote_type)} • ${escapeHtml(slabLabel)} • Rate ${Number(selectedSellerQuote.rate_inr || 0).toFixed(4)}`;
  }

  function primeSellFormFromQuote(quote) {
    selectedSellerQuote = quote;
    if (qs('sell-coin')) qs('sell-coin').value = quote.coin_symbol || '';
    const coinSelect = qs('sell-coin');
    if (coinSelect) coinSelect.dispatchEvent(new Event('change'));
    if (qs('sell-network')) qs('sell-network').value = quote.network || '';
    if (qs('sell-amount')) qs('sell-amount').value = Number(quote.min_amount ?? quote.min_crypto_amount ?? 0);
    setSelectedQuoteBanner();
    document.querySelector('.side-link[data-target="seller-sell"]')?.click();
    setText('quote-calc-message', 'Chosen quote prefilled. Select payout method and click Get Best Admin Rate to confirm this slab.');
  }

  function buildQuoteCard(quote, amount) {
    const qualifies = amount ? slabMatchesAmount(quote, amount) : false;
    const higherUnlock = amount && amount < Number(quote.min_amount || 0) ? `Add ${Number(quote.min_amount || 0) - amount} ${quote.coin_symbol} to unlock this rate.` : '';
    return `<div class="quote-card${qualifies ? ' recommended' : ''}">
      <div class="badge ${qualifies ? '' : 'neutral'}">${qualifies ? 'You qualify' : 'Available'}</div>
      <h4>${escapeHtml(quote.quote_name || quote.quote_type || 'Quote')}</h4>
      <p>${escapeHtml(quote.description || 'Sell directly from this available quote slab.')}</p>
      <div class="kv-list">
        <div class="kv-row"><span>Coin / Network</span><strong>${escapeHtml(quote.coin_symbol)} / ${escapeHtml(quote.network)}</strong></div>
        <div class="kv-row"><span>Amount Slab</span><strong>${Number(quote.min_amount || 0)} - ${quote.max_amount ? Number(quote.max_amount) : 'Unlimited'}</strong></div>
        <div class="kv-row"><span>Rate</span><strong>${Number(quote.rate_inr || 0).toFixed(4)}</strong></div>
        <div class="kv-row"><span>Payout Time</span><strong>${escapeHtml(quote.payout_time_label || '-')}</strong></div>
      </div>
      ${higherUnlock ? `<div class="tiny-note top-gap-sm">${escapeHtml(higherUnlock)}</div>` : ''}
      <div class="action-row top-gap-sm"><button class="btn btn-primary quote-sell-now">Use This Rate</button></div>
    </div>`;
  }

  async function renderAvailableQuotesPage(prefillCoin, prefillNetwork) {
    const amount = Number(val('quotes-amount') || 0);
    const coin = (val('quotes-coin') || prefillCoin || '').toUpperCase();
    const network = (val('quotes-network') || prefillNetwork || '').toUpperCase();
    const [{ data: templates }, { data: slabs }, { data: rates }] = await Promise.all([
      sellerClient.from('quote_templates').select('*').eq('is_enabled', true).order('sort_order', { ascending: true }),
      sellerClient.from('quote_slabs').select('*').eq('is_enabled', true).order('coin_symbol').order('network').order('min_amount'),
      sellerClient.from('coin_rates').select('*').eq('is_active', true).order('coin_symbol').order('network')
    ]);
    const allSlabs = (slabs || []).map((s) => {
      const tpl = (templates || []).find((t) => t.id === s.quote_template_id || t.quote_type === s.quote_type);
      return {
        ...s,
        quote_name: tpl?.quote_name || s.quote_type,
        description: tpl?.description || '',
        payout_time_label: tpl?.payout_time_label || '-',
        coin_symbol: (s.coin_symbol || '').toUpperCase(),
        network: (s.network || '').toUpperCase(),
        min_amount: Number(s.min_amount ?? s.min_crypto_amount ?? 0),
        max_amount: s.max_amount ?? s.max_crypto_amount,
        rate_inr: Number(s.rate_inr || 0)
      };
    }).filter((s) => s.coin_symbol && s.network);

    const uniqueCoins = [...new Set(allSlabs.map((s) => s.coin_symbol))];
    const coinSel = qs('quotes-coin');
    const netSel = qs('quotes-network');
    if (coinSel && !coinSel.dataset.loaded) {
      coinSel.innerHTML = uniqueCoins.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      coinSel.dataset.loaded = '1';
      if (prefillCoin) coinSel.value = prefillCoin;
    }
    const fillNetworks = () => {
      const selectedCoin = (coinSel?.value || uniqueCoins[0] || '').toUpperCase();
      const nets = [...new Set(allSlabs.filter((s) => s.coin_symbol === selectedCoin).map((s) => s.network))];
      if (netSel) netSel.innerHTML = nets.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      if (prefillNetwork) netSel.value = prefillNetwork;
    };
    if (coinSel && !coinSel.dataset.bound) {
      coinSel.addEventListener('change', () => { fillNetworks(); renderAvailableQuotesPage(); });
      coinSel.dataset.bound = '1';
    }
    if (netSel && !netSel.dataset.bound) {
      netSel.addEventListener('change', () => renderAvailableQuotesPage());
      netSel.dataset.bound = '1';
    }
    fillNetworks();

    const selectedCoin = (coinSel?.value || coin || '').toUpperCase();
    const selectedNetwork = (netSel?.value || network || '').toUpperCase();
    const visible = allSlabs.filter((s) => (!selectedCoin || s.coin_symbol === selectedCoin) && (!selectedNetwork || s.network === selectedNetwork));
    const container = qs('quotes-slabs-container');
    const empty = qs('quotes-slabs-empty');
    if (!container || !empty) return;
    container.innerHTML = '';
    if (!visible.length) {
      empty.style.display = 'block';
      setText('quotes-page-message', 'No quote slabs found for this coin/network.');
      return;
    }
    empty.style.display = 'none';
    setText('quotes-page-message', amount ? 'Matching slabs are highlighted as You qualify.' : 'See all available slabs below.');
    visible.sort((a,b) => (a.min_amount-b.min_amount) || (b.rate_inr-a.rate_inr)).forEach((quote) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = buildQuoteCard(quote, amount);
      wrap.querySelector('.quote-sell-now').addEventListener('click', () => primeSellFormFromQuote(quote));
      container.appendChild(wrap.firstElementChild);
    });
  }

  async function loadSellerDashboard() {
    const user = await ensureAuth('login.html', sellerClient);
    if (!user) return;
    bindSidebar();
    let profile = await getProfile(sellerClient);
    if (!profile) {
      profile = await ensureSellerProfileRecord(user, { email: user.email });
    }
    if (!profile) {
      await sellerClient.auth.signOut();
      window.location.href = 'login.html';
      return;
    }
    setText('seller-top-name', profile.full_name || profile.email || 'Seller');
    renderProfileBoxes(profile);

    if (qs('sell-coin')) qs('sell-coin').value = 'USDT';
    if (qs('quotes-coin')) qs('quotes-coin').value = 'USDT';
    if (qs('sell-network')) qs('sell-network').value = 'TRC20';
    if (qs('quotes-network')) qs('quotes-network').value = 'TRC20';


    if (qs('sell-network')) qs('sell-network').value = 'TRC20';
    if (qs('quotes-network')) qs('quotes-network').value = 'TRC20';

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


    qs('copy-telegram-support')?.addEventListener('click', async () => {
      const ok = await copyText('@anmolaro');
      flashInlineCopyState(qs('copy-telegram-support'), ok, '✓');
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

  function adminStatusMeta(status) {
    const map = {
      draft: { label: 'Draft', sub: 'Order not started', cls: 'neutral' },
      quote_selected: { label: 'Quote Locked', sub: 'Awaiting seller action', cls: 'pending' },
      awaiting_kyc: { label: 'Awaiting KYC', sub: 'Seller KYC required', cls: 'pending' },
      awaiting_transfer: { label: 'Crypto Sent', sub: 'Awaiting review', cls: 'pending' },
      awaiting_confirmations: { label: 'Crypto Received', sub: 'Waiting confirmations', cls: 'active' },
      payout_in_progress: { label: 'Payout Sent', sub: 'Waiting confirmation', cls: 'active' },
      completed: { label: 'Completed', sub: 'Amount received', cls: 'active' },
      cancelled: { label: 'Cancelled', sub: 'Cancelled by admin', cls: 'cancelled' },
      rejected: { label: 'Rejected', sub: 'Rejected by admin', cls: 'rejected' }
    };
    return map[status] || { label: status || 'Unknown', sub: '', cls: 'neutral' };
  }

  function shortOrderId(id) {
    if (!id) return '-';
    return id.length > 14 ? `${id.slice(0, 14)}…` : id;
  }

  function payoutDisplay(row) {
    const d = payoutDetailFromRow(row);
    const value = d.method === 'upi'
      ? (d.upi || '-')
      : `${d.bank || 'Bank'} • A/C: ${d.account || '-'} • IFSC: ${d.ifsc || '-'}`;
    const extra = d.method === 'upi'
      ? `Holder: ${d.holder || '-'}`
      : `Holder: ${d.holder || '-'}`;
    return { ...d, value, extra };
  }

  function buildOrderTimeline(row) {
    const steps = [
      { key: 'awaiting_transfer', title: 'Order Created', done: true, time: row.created_at },
      { key: 'awaiting_transfer', title: 'Crypto Sent by Seller', done: ['awaiting_transfer','awaiting_confirmations','payout_in_progress','completed'].includes(row.status), time: row.created_at },
      { key: 'awaiting_confirmations', title: 'Crypto Received by Admin', done: ['awaiting_confirmations','payout_in_progress','completed'].includes(row.status), time: row.updated_at },
      { key: 'payout_in_progress', title: 'Payout Initiated', done: ['payout_in_progress','completed'].includes(row.status), time: row.updated_at },
      { key: 'completed', title: 'Amount Received by Seller', done: row.status === 'completed', time: row.completed_at || row.updated_at }
    ];
    return steps.map((step) => `
      <div class="timeline-row ${step.done ? 'done' : ''}">
        <span class="timeline-dot"></span>
        <div class="timeline-copy">
          <strong>${escapeHtml(step.title)}</strong>
          <span>${step.done ? 'Completed' : 'Pending'}</span>
        </div>
        <div class="timeline-time">${step.done && step.time ? fmtDate(step.time) : '--'}</div>
      </div>`).join('');
  }

  function renderAdminOrderDetail(row) {
    if (!row) {
      setHtml('admin-order-summary', '<div class="empty-state">Select an order to view details.</div>');
      setHtml('admin-order-wallet', '<div class="empty-state">Deposit wallet details will appear here.</div>');
      setHtml('admin-order-payout', '<div class="empty-state">Payout details will appear here.</div>');
      setHtml('admin-order-timeline', '<div class="empty-state">Order progress will appear here.</div>');
      setHtml('admin-order-detail-actions', '');
      return;
    }
    const payout = payoutDisplay(row);
    setHtml('admin-order-summary', `
      <div class="summary-row"><span>Order ID</span><strong>${escapeHtml(row.id)}</strong></div>
      <div class="summary-row"><span>Transaction ID</span><strong>${escapeHtml(row.tx_hash || 'Pending')}</strong></div>
      <div class="summary-row"><span>Seller</span><strong>${escapeHtml(row.profiles?.full_name || row.profiles?.email || '-')} ${row.profiles?.mobile ? '(' + escapeHtml(row.profiles.mobile) + ')' : ''}</strong></div>
      <div class="summary-row"><span>Coin / Network</span><strong>${escapeHtml(row.coin_symbol)} (${escapeHtml(row.network)})</strong></div>
      <div class="summary-row"><span>Amount</span><strong>${escapeHtml(row.crypto_amount)} ${escapeHtml(row.coin_symbol)}</strong></div>
      <div class="summary-row"><span>INR Amount</span><strong>${fmtInr(row.estimated_inr_payout)}</strong></div>
      <div class="summary-row"><span>Rate</span><strong>${escapeHtml(Number(row.locked_rate_inr || 0).toFixed(4))}</strong></div>
      <div class="summary-row"><span>Created On</span><strong>${fmtDate(row.created_at)}</strong></div>`);
    setHtml('admin-order-wallet', `
      <div class="wallet-grid-mini">
        <div class="qr-preview-box fancy-qr">${row.deposit_wallet_qr_url || row.deposit_wallet_address ? `<img src="${escapeHtml(row.deposit_wallet_qr_url || 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(row.deposit_wallet_address || ''))}" alt="QR" />` : '<div class="empty-state">No QR</div>'}</div>
        <div class="summary-list compact-summary">
          <div class="summary-row"><span>Wallet Address</span><strong class="break-anywhere">${escapeHtml(row.deposit_wallet_address || 'Not assigned')}</strong></div>
          <div class="summary-row"><span>Network</span><strong>${escapeHtml(row.network || '-')}</strong></div>
          <div class="summary-row"><span>Wallet Label</span><strong>${escapeHtml(row.wallet_label || 'Auto Assigned')}</strong></div>
        </div>
      </div>`);
    setHtml('admin-order-payout', `
      ${payoutDetailsKvMarkup(row, 'summary-row')}
      <div class="summary-row"><span>Status</span><strong>${chip(row.status)}</strong></div>
      <div class="top-gap-sm"><button id="admin-view-payout-details" data-id="${row.id}" data-payout='${encodePayoutDataAttr(row)}' onclick="event.stopPropagation(); return toggleInlinePayoutDetails(this.getAttribute('data-payout'),'admin-payout-inline',this);" class="btn btn-secondary btn-xs">View Payout Details</button></div>
      <div id="admin-payout-inline" class="inline-payout-box"></div>`);
    setHtml('admin-order-timeline', buildOrderTimeline(row));

  }

  function adminOrderActionButtons(row) {
    const buttons = [];
    if (['awaiting_transfer','awaiting_confirmations'].includes(row.status)) {
      buttons.push(`<button class="btn btn-primary btn-xs js-order-received" data-id="${row.id}">Mark Crypto Received</button>`);
    }
    if (row.status === 'awaiting_confirmations') {
      buttons.push(`<button class="btn btn-secondary btn-xs js-order-payout" data-id="${row.id}">Start Payout</button>`);
    }
    if (row.status === 'payout_in_progress') {
      buttons.push(`<button class="btn btn-primary btn-xs js-order-paid" data-id="${row.id}">Mark Paid</button>`);
    }
    buttons.push(`<button class="btn btn-secondary btn-xs js-order-view" data-id="${row.id}">View Details</button>`);
    if (!['completed','cancelled'].includes(row.status)) {
      buttons.push(`<button class="btn btn-danger btn-xs js-order-cancel" data-id="${row.id}">Cancel</button>`);
    }
    return `<div class="actions-stack">${buttons.join('')}</div>`;
  }


  async function ensureReferralRewardForOrder(orderId) {
    try {
      const { data: order, error: orderError } = await adminClient
        .from('sell_orders')
        .select('id,user_id,estimated_inr_payout,status')
        .eq('id', orderId)
        .single();

      if (orderError || !order) return;
      if (!['completed','paid'].includes(String(order.status || '').toLowerCase())) return;

      const { data: sellerProfile, error: profileError } = await adminClient
        .from('profiles')
        .select('id,referred_by')
        .eq('id', order.user_id)
        .single();

      if (profileError || !sellerProfile) return;

      const referrerId = sellerProfile?.referred_by;
      if (!referrerId || referrerId === order.user_id) return;

      const { data: existing } = await adminClient
        .from('referral_rewards')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

      if (existing?.id) return;

      const orderAmount = Number(order.estimated_inr_payout || 0);
      if (!orderAmount) return;

      const rewardPercent = 0.10;
      const rewardAmount = +(orderAmount * 0.001).toFixed(2);

      const { error: insertError } = await adminClient.from('referral_rewards').insert({
        referrer_user_id: referrerId,
        referred_user_id: order.user_id,
        order_id: order.id,
        order_inr_amount: orderAmount,
        reward_percent: rewardPercent,
        reward_amount_inr: rewardAmount,
        reward_status: 'pending'
      });

      if (insertError) console.warn('Referral reward insert failed:', insertError.message);
    } catch (e) {
      console.warn('Referral reward generation failed', e);
    }
  }


  
  function referralRewardValue(row) {
    return Number(row?.reward_amount_inr ?? row?.reward_amount ?? row?.amount_inr ?? row?.amount ?? 0);
  }

  function referralWithdrawalValue(row) {
    return Number(row?.amount_inr ?? row?.amount ?? 0);
  }

  function referralStatusText(value, fallback = 'pending') {
    return String(value || fallback).toLowerCase();
  }

function availableReferralBalance(rewards, withdrawals) {
    const totalRewards = (rewards || [])
      .filter((r) => !['rejected','cancelled'].includes(referralStatusText(r.reward_status || r.status)))
      .reduce((sum, r) => sum + referralRewardValue(r), 0);

    const totalWithdrawals = (withdrawals || [])
      .filter((w) => !['rejected','cancelled'].includes(referralStatusText(w.status, 'requested')))
      .reduce((sum, w) => sum + referralWithdrawalValue(w), 0);

    return Math.max(0, +(totalRewards - totalWithdrawals).toFixed(2));
  }

  
  
  function showAppToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `app-toast ${type}`;
    clearTimeout(window.__appToastTimer);
    window.__appToastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
    requestAnimationFrame(() => toast.classList.add('show'));
  }

function confirmAdminAction(message) {
    return window.confirm(message || 'Are you sure you want to continue?');
  }

async function updateAdminOrderStatus(id, status, triggerButton = null) {
    const originalText = triggerButton ? triggerButton.textContent : '';
    try {
      if (triggerButton) {
        triggerButton.disabled = true;
        triggerButton.textContent = 'Updating...';
      }

      const payload = {
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null
      };

      const { error } = await adminClient
        .from('sell_orders')
        .update(payload)
        .eq('id', id);

      if (error) {
        alert(error.message || 'Order status update failed');
        return;
      }

      if (status === 'completed') {
        await ensureReferralRewardForOrder(id);
      }

      try {
        await audit('order_status_updated', 'sell_orders', id, { status });
      } catch (_) {}

      await loadAdminOrders(id);
      await loadAdminStats();
      alert('Order status updated successfully');
    } catch (err) {
      alert(err?.message || 'Order status update failed');
    } finally {
      if (triggerButton) {
        triggerButton.disabled = false;
        triggerButton.textContent = originalText;
      }
    }
  }

  async function loadAdminOrders(selectedOrderId = null) {
    const { data } = await adminClient
      .from('sell_orders')
      .select('*, profiles!sell_orders_user_id_fkey(full_name,email,mobile)')
      .order('created_at', { ascending: false });

    const body = qs('admin-orders-body');
    const pagination = qs('admin-orders-pagination');
    const search = val('admin-order-search').toLowerCase();
    if (!body) return;

    const rows = (data || []).filter((row) => {
      if (!search) return true;
      return [row.id, row.profiles?.full_name, row.profiles?.email, row.profiles?.mobile, row.payout_upi_id, row.payout_account_number]
        .filter(Boolean).join(' ').toLowerCase().includes(search);
    });

    window.__adminOrderRows = rows;

    const pageSize = 5;
    let currentPage = Number(window.__adminOrdersPage || 1);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

    if (selectedOrderId) {
      const selectedIndex = rows.findIndex((r) => r.id === selectedOrderId);
      if (selectedIndex >= 0) currentPage = Math.floor(selectedIndex / pageSize) + 1;
    }

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    window.__adminOrdersPage = currentPage;

    const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const completed = rows.filter((r) => r.status === 'completed').length;
    const inProgress = rows.filter((r) => ['awaiting_transfer','awaiting_confirmations','payout_in_progress'].includes(r.status)).length;
    const cancelled = rows.filter((r) => r.status === 'cancelled').length;

    setHtml('admin-order-stats', `
      <div class="card kpi-card"><div><span>Total Orders</span><strong>${rows.length}</strong><small>All Time</small></div></div>
      <div class="card kpi-card success"><div><span>Completed</span><strong>${completed}</strong><small>${rows.length ? Math.round((completed/rows.length)*100) : 0}% Success</small></div></div>
      <div class="card kpi-card warning"><div><span>In Progress</span><strong>${inProgress}</strong><small>${rows.length ? ((inProgress/rows.length)*100).toFixed(1) : 0}% Active</small></div></div>
      <div class="card kpi-card danger"><div><span>Cancelled</span><strong>${cancelled}</strong><small>${rows.length ? ((cancelled/rows.length)*100).toFixed(1) : 0}% Cancelled</small></div></div>`);

    body.innerHTML = !pageRows.length ? '<tr><td colspan="8">No sell orders found.</td></tr>' : '';
    let selectedMatched = false;

    pageRows.forEach((row, index) => {
      const userName = row.profiles?.full_name || row.profiles?.email || '-';
      const payout = payoutDisplay(row);
      const statusMeta = adminStatusMeta(row.status);
      const globalIndex = ((currentPage - 1) * pageSize) + index;
      const isSelected = selectedOrderId ? row.id === selectedOrderId : globalIndex === 0;
      if (isSelected) selectedMatched = true;

      const tr = document.createElement('tr');
      tr.className = isSelected ? 'is-selected' : '';
      tr.innerHTML = `
        <td>
          <div class="order-id-stack"><strong>#${escapeHtml(shortOrderId(row.id))}</strong><button class="mini-copy js-copy-order" data-copy="${escapeHtml(row.id)}">⧉</button></div>
          <div class="tiny-note">TXN: ${escapeHtml(row.tx_hash || 'Pending')}</div>
        </td>
        <td>
          <div class="seller-mini"><span class="seller-avatar">${escapeHtml((userName || 'S').slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(userName)}</strong><div class="tiny-note">${escapeHtml(row.profiles?.mobile || row.profiles?.email || '')}</div></div></div>
        </td>
        <td>
          <div><strong>${escapeHtml(row.coin_symbol)} (${escapeHtml(row.network)})</strong></div>
          <div class="tiny-note">${escapeHtml(row.crypto_amount)} ${escapeHtml(row.coin_symbol)}</div>
        </td>
        <td>${fmtInr(row.estimated_inr_payout)}</td>
        <td>
          <div class="payout-cell-line"><strong>${escapeHtml(payout.label)}</strong><button class="mini-view-btn js-payout-view" data-id="${row.id}" data-payout='${encodePayoutDataAttr(row)}'>View</button></div>
          <div class="tiny-note">${escapeHtml(payout.value || '-')}</div>
        </td>
        <td><div>${chip(statusMeta.label, statusMeta.cls)}</div><div class="tiny-note top-gap-xs">${escapeHtml(statusMeta.sub)}</div></td>
        <td>${fmtDate(row.created_at)}</td>
        <td>${adminOrderActionButtons(row)}</td>`;

      tr.querySelector('.js-copy-order')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await copyText(row.id);
        flashInlineCopyState(e.currentTarget, ok, '✓');
      });

      tr.querySelectorAll('.js-payout-view').forEach((btn) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderAdminOrderDetail(row);
        selectAdminOrderRow(tr);
        setTimeout(() => {
          const detailBtn = qs('#admin-view-payout-details');
          if (detailBtn) {
            toggleInlinePayoutDetails(detailBtn.getAttribute('data-payout'), 'admin-payout-inline', detailBtn);
          }
        }, 0);
      }));

      tr.querySelectorAll('.js-order-view').forEach((btn) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderAdminOrderDetail(row);
        selectAdminOrderRow(tr);
      }));
      tr.querySelectorAll('.js-order-received').forEach((btn) => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateAdminOrderStatus(row.id, 'awaiting_confirmations', e.currentTarget);
      }));
      tr.querySelectorAll('.js-order-payout').forEach((btn) => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateAdminOrderStatus(row.id, 'payout_in_progress', e.currentTarget);
      }));
      tr.querySelectorAll('.js-order-paid').forEach((btn) => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateAdminOrderStatus(row.id, 'completed', e.currentTarget);
      }));
      tr.querySelectorAll('.js-order-cancel').forEach((btn) => btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateAdminOrderStatus(row.id, 'cancelled', e.currentTarget);
      }));

      tr.addEventListener('click', () => {
        renderAdminOrderDetail(row);
        selectAdminOrderRow(tr);
      });

      body.appendChild(tr);
      if (isSelected) renderAdminOrderDetail(row);
    });

    if (pagination) {
      const from = rows.length ? ((currentPage - 1) * pageSize) + 1 : 0;
      const to = Math.min(currentPage * pageSize, rows.length);
      const pageButtons = Array.from({ length: totalPages }, (_, i) => {
        const page = i + 1;
        return `<button class="orders-page-btn ${page === currentPage ? 'active' : ''}" data-page="${page}">${page}</button>`;
      }).join('');

      pagination.innerHTML = `
        <div class="orders-page-info">Showing ${from}-${to} of ${rows.length} orders</div>
        <div class="orders-page-controls">
          <button class="orders-page-btn" data-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>
          ${pageButtons}
          <button class="orders-page-btn" data-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage === totalPages ? 'disabled' : ''}>Next ›</button>
        </div>`;

      pagination.querySelectorAll('.orders-page-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          window.__adminOrdersPage = Number(btn.dataset.page || 1);
          await loadAdminOrders();
        });
      });
    }

    if (!rows.length) {
      renderAdminOrderDetail(null);
    } else if (selectedOrderId && !selectedMatched) {
      renderAdminOrderDetail(rows[0]);
    } else if (!selectedOrderId && pageRows.length) {
      renderAdminOrderDetail(pageRows[0]);
    }
  }

  function selectAdminOrderRow(activeRow) {
    qs('admin-orders-body')?.querySelectorAll('tr').forEach((tr) => tr.classList.remove('is-selected'));
    activeRow?.classList.add('is-selected');
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
        if (!confirmAdminAction('Approve this KYC request?')) return;
        await adminClient.from('kyc_submissions').update({ status: 'verified', review_note: 'Approved by admin' }).eq('id', row.id);
        await adminClient.from('profiles').update({ kyc_status: 'verified' }).eq('id', row.user_id);
        await audit('kyc_approved', 'kyc_submissions', row.id, {});
        await loadAdminKyc();
        await loadAdminUsers();
        await loadAdminStats();
      });
      tr.querySelector('.kyc-reject').addEventListener('click', async () => {
        if (!confirmAdminAction('Reject this KYC request?')) return;
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
    const [
      { count: usersCount },
      { count: ordersCount },
      { count: kycPending },
      { data: completedOrders },
      { count: cryptoCheckCount },
      { count: payoutProgressCount }
    ] = await Promise.all([
      adminClient.from('profiles').select('*', { count: 'exact', head: true }),
      adminClient.from('sell_orders').select('*', { count: 'exact', head: true }),
      adminClient.from('profiles').select('*', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
      adminClient.from('sell_orders').select('estimated_inr_payout').eq('status', 'completed'),
      adminClient.from('sell_orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_confirmations'),
      adminClient.from('sell_orders').select('*', { count: 'exact', head: true }).eq('status', 'payout_in_progress')
    ]);

    const volume = (completedOrders || []).reduce((sum, row) => sum + Number(row.estimated_inr_payout || 0), 0);

    setHtml('admin-stats', `
      <div class="card stat-card admin-stat-card"><span class="stat-icon">▣</span><small>Total Orders</small><strong>${ordersCount || 0}</strong><em>↗ Live count</em></div>
      <div class="card stat-card admin-stat-card warning"><span class="stat-icon">⌕</span><small>Pending Crypto Check</small><strong>${cryptoCheckCount || 0}</strong><em>↗ Needs review</em></div>
      <div class="card stat-card admin-stat-card success"><span class="stat-icon">✓</span><small>Payouts In Progress</small><strong>${payoutProgressCount || 0}</strong><em>↗ Active payouts</em></div>
      <div class="card stat-card admin-stat-card rupee"><span class="stat-icon">₹</span><small>Completed Volume</small><strong>${fmtInr(volume)}</strong><em>↗ Paid orders</em></div>`);

    await renderAdminOverviewRecentOrder();
  }

  function adminMiniStep(row, key) {
    const status = row?.status || '';
    const doneMap = {
      created: true,
      sent: ['awaiting_transfer','awaiting_confirmations','payout_in_progress','completed'].includes(status),
      received: ['awaiting_confirmations','payout_in_progress','completed'].includes(status),
      payout: ['payout_in_progress','completed'].includes(status),
      paid: status === 'completed'
    };
    return !!doneMap[key];
  }

  function adminOverviewStep(title, time, done, active) {
    return `
      <div class="admin-order-step ${done ? 'done' : ''} ${active ? 'active' : ''}">
        <span>${done ? '✓' : active ? '●' : ''}</span>
        <strong>${escapeHtml(title)}</strong>
        <small>${time ? fmtDate(time) : '-'}</small>
      </div>`;
  }

  async function renderAdminOverviewRecentOrder() {
    const box = qs('admin-overview-recent-order');
    if (!box) return;

    const { data: row, error } = await adminClient
      .from('sell_orders')
      .select('*, profiles!sell_orders_user_id_fkey(full_name,email,mobile)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !row) {
      box.innerHTML = '<div class="empty-state">No recent orders found.</div>';
      return;
    }

    const userName = row.profiles?.full_name || row.profiles?.email || 'Seller';
    const initials = (userName || 'AD').slice(0, 2).toUpperCase();
    const payout = payoutDisplay(row);
    const statusMeta = adminStatusMeta(row.status);
    const amount = Number(row.crypto_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });

    box.innerHTML = `
      <div class="admin-order-head">
        <div><span class="admin-order-label">Order ID</span> <strong>#${escapeHtml(shortOrderId(row.id))}</strong></div>
        <span class="admin-order-status ${escapeHtml(statusMeta.cls || '')}">● ${escapeHtml(statusMeta.label)}</span>
      </div>

      <div class="admin-order-main">
        <div class="admin-seller-block">
          <span class="admin-seller-avatar">${escapeHtml(initials)}</span>
          <div>
            <h4>${escapeHtml(userName)}</h4>
            <p>${escapeHtml(row.profiles?.email || '')}</p>
            <p>☎ ${escapeHtml(row.profiles?.mobile || '-')}</p>
          </div>
        </div>
        <div class="admin-order-facts">
          <div><span>INR Amount</span><strong>${fmtInr(row.estimated_inr_payout)}</strong></div>
          <div><span>Selling Amount</span><strong>${escapeHtml(amount)} ${escapeHtml(row.coin_symbol || 'USDT')}</strong></div>
          <div><span>Payout Method</span><strong>${escapeHtml((payout.method || row.payout_method || 'bank').toUpperCase())}</strong></div>
          <div><span>Bank / UPI Details</span><strong>${escapeHtml(payout.value || payout.label || '-')}</strong></div>
        </div>
      </div>

      <div class="admin-order-steps">
        ${adminOverviewStep('Order Created', row.created_at, adminMiniStep(row, 'created'), false)}
        ${adminOverviewStep('Crypto Sent', row.tx_hash ? row.updated_at : null, adminMiniStep(row, 'sent'), row.status === 'awaiting_transfer')}
        ${adminOverviewStep('Crypto Received', row.updated_at, adminMiniStep(row, 'received'), row.status === 'awaiting_confirmations')}
        ${adminOverviewStep('Payout Started', row.updated_at, adminMiniStep(row, 'payout'), row.status === 'payout_in_progress')}
        ${adminOverviewStep('Paid', row.completed_at || row.updated_at, adminMiniStep(row, 'paid'), false)}
      </div>

      <div class="admin-order-actions">
        <button class="btn btn-secondary btn-xs js-overview-view">👁 View Details</button>
        <button class="btn btn-secondary btn-xs js-overview-received" ${adminMiniStep(row, 'received') ? 'disabled' : ''}>✓ Crypto Received</button>
        <button class="btn btn-secondary btn-xs js-overview-payout" ${adminMiniStep(row, 'payout') || !adminMiniStep(row, 'received') ? 'disabled' : ''}>➤ Start Payout</button>
        <button class="btn btn-primary btn-xs js-overview-paid" ${row.status !== 'payout_in_progress' ? 'disabled' : ''}>✓ Mark Paid</button>
      </div>`;

    box.querySelector('.js-overview-view')?.addEventListener('click', async () => {
      document.querySelector('.side-link[data-target="admin-orders"]')?.click();
      await loadAdminOrders(row.id);
    });
    box.querySelector('.js-overview-received')?.addEventListener('click', async (e) => updateAdminOrderStatus(row.id, 'awaiting_confirmations', e.currentTarget));
    box.querySelector('.js-overview-payout')?.addEventListener('click', async (e) => updateAdminOrderStatus(row.id, 'payout_in_progress', e.currentTarget));
    box.querySelector('.js-overview-paid')?.addEventListener('click', async (e) => updateAdminOrderStatus(row.id, 'completed', e.currentTarget));
  }

  async function loadAdminReferralPanel() {
    const [{ data: rewards }, { data: withdrawals }] = await Promise.all([
      adminClient.from('referral_rewards').select('*, referrer:referrer_user_id(full_name,email,mobile), referred:referred_user_id(full_name,email,mobile)').order('created_at', { ascending: false }),
      adminClient.from('referral_withdrawals').select('*, user:user_id(full_name,email,mobile)').order('created_at', { ascending: false })
    ]);

    const totalRewards = (rewards || []).reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    const pendingRewards = (rewards || []).filter((r) => r.reward_status !== 'paid').reduce((s, r) => s + Number(r.reward_amount_inr || 0), 0);
    const requestedWithdrawals = (withdrawals || []).filter((w) => ['requested','approved','processing'].includes(w.status)).reduce((s, w) => s + Number(w.amount_inr || 0), 0);
    const paidWithdrawals = (withdrawals || []).filter((w) => w.status === 'paid').reduce((s, w) => s + Number(w.amount_inr || 0), 0);

    setHtml('admin-referral-stats', `
      <div class="card stat-card"><strong>${fmtInr(totalRewards)}</strong><span>Total Rewards</span></div>
      <div class="card stat-card"><strong>${fmtInr(pendingRewards)}</strong><span>Unpaid Rewards</span></div>
      <div class="card stat-card"><strong>${fmtInr(requestedWithdrawals)}</strong><span>Withdrawal Requests</span></div>
      <div class="card stat-card"><strong>${fmtInr(paidWithdrawals)}</strong><span>Paid Withdrawals</span></div>`);

    const rewardBody = qs('admin-referral-rewards-body');
    if (rewardBody) {
      rewardBody.innerHTML = !(rewards || []).length ? '<tr><td colspan="7">No referral rewards yet.</td></tr>' : (rewards || []).map((r) => `
        <tr>
          <td>${escapeHtml(r.referrer?.full_name || r.referrer?.email || '-')}<div class="tiny-note">${escapeHtml(r.referrer?.mobile || '')}</div></td>
          <td>${escapeHtml(r.referred?.full_name || r.referred?.email || '-')}<div class="tiny-note">${escapeHtml(r.referred?.mobile || '')}</div></td>
          <td class="code-small">${escapeHtml(r.order_id || '-')}</td>
          <td>${fmtInr(r.order_inr_amount || 0)}</td>
          <td>${fmtInr(r.reward_amount_inr || 0)}</td>
          <td>${chip(r.reward_status)}</td>
          <td>
            <div class="actions-stack">
              ${r.reward_status !== 'approved' && r.reward_status !== 'paid' ? `<button class="btn btn-secondary btn-xs js-ref-approve" data-id="${r.id}">Approve</button>` : ''}
              ${r.reward_status !== 'paid' ? `<button class="btn btn-primary btn-xs js-ref-paid" data-id="${r.id}">Mark Paid</button>` : ''}
              ${r.reward_status !== 'rejected' && r.reward_status !== 'paid' ? `<button class="btn btn-danger btn-xs js-ref-reject" data-id="${r.id}">Reject</button>` : ''}
            </div>
          </td>
        </tr>`).join('');

      rewardBody.querySelectorAll('.js-ref-approve').forEach((btn) => btn.addEventListener('click', async () => updateReferralReward(btn.dataset.id, 'approved')));
      rewardBody.querySelectorAll('.js-ref-paid').forEach((btn) => btn.addEventListener('click', async () => updateReferralReward(btn.dataset.id, 'paid')));
      rewardBody.querySelectorAll('.js-ref-reject').forEach((btn) => btn.addEventListener('click', async () => updateReferralReward(btn.dataset.id, 'rejected')));
    }

    const withdrawBody = qs('admin-ref-withdrawals-body');
    if (withdrawBody) {
      withdrawBody.innerHTML = !(withdrawals || []).length ? '<tr><td colspan="6">No referral withdrawal requests.</td></tr>' : (withdrawals || []).map((w) => `
        <tr>
          <td>${escapeHtml(w.user?.full_name || w.user?.email || '-')}<div class="tiny-note">${escapeHtml(w.user?.mobile || '')}</div></td>
          <td>${fmtInr(w.amount_inr || 0)}</td>
          <td>
            <strong>${escapeHtml(w.payout_label || 'Saved payout method')}</strong>
            <div class="tiny-note break-anywhere">${escapeHtml(w.payout_details?.upi_id || w.payout_details?.account_number || '')}</div>
            <div class="tiny-note">${escapeHtml(w.payout_details?.account_holder_name || '')}</div>
            <button class="btn btn-secondary btn-xs js-ref-wd-payout" data-payout='${escapeHtml(JSON.stringify(w.payout_details || {}))}'>View Payout</button>
          </td>
          <td>${chip(w.status)}</td>
          <td>${fmtDate(w.created_at)}</td>
          <td>
            <div class="actions-stack">
              ${w.status !== 'approved' && w.status !== 'paid' ? `<button class="btn btn-secondary btn-xs js-wd-approve" data-id="${w.id}">Approve</button>` : ''}
              ${w.status !== 'paid' ? `<button class="btn btn-primary btn-xs js-wd-paid" data-id="${w.id}">Mark Paid</button>` : ''}
              ${w.status !== 'rejected' && w.status !== 'paid' ? `<button class="btn btn-danger btn-xs js-wd-reject" data-id="${w.id}">Reject</button>` : ''}
            </div>
          </td>
        </tr>`).join('');

      withdrawBody.querySelectorAll('.js-wd-approve').forEach((btn) => btn.addEventListener('click', async () => updateReferralWithdrawal(btn.dataset.id, 'approved')));
      withdrawBody.querySelectorAll('.js-wd-paid').forEach((btn) => btn.addEventListener('click', async () => updateReferralWithdrawal(btn.dataset.id, 'paid')));
      withdrawBody.querySelectorAll('.js-wd-reject').forEach((btn) => btn.addEventListener('click', async () => updateReferralWithdrawal(btn.dataset.id, 'rejected')));
      withdrawBody.querySelectorAll('.js-ref-wd-payout').forEach((btn) => btn.addEventListener('click', () => {
        try {
          const details = JSON.parse(btn.getAttribute('data-payout') || '{}');
          openPayoutDetailsModal(details);
        } catch (_) {
          alert('Payout details not found');
        }
      }));
    }
  }

  async function updateReferralReward(id, status) {
        if (!confirmAdminAction(`Confirm referral reward ${status}?`)) return;
const payload = { reward_status: status };
    if (status === 'paid') payload.paid_at = new Date().toISOString();
    const { error } = await adminClient.from('referral_rewards').update(payload).eq('id', id);
    if (error) return alert(error.message);
    await loadAdminReferralPanel();
  }

  async function updateReferralWithdrawal(id, status) {
        if (!confirmAdminAction(`Confirm referral withdrawal ${status}?`)) return;
const payload = { status };
    if (status === 'paid') payload.paid_at = new Date().toISOString();
    const { error } = await adminClient.from('referral_withdrawals').update(payload).eq('id', id);
    if (error) return alert(error.message);
    await loadAdminReferralPanel();
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

    function closeAdminFloatingPanels() {
      qs('admin-quick-menu')?.classList.add('hidden');
      qs('admin-notification-panel')?.classList.add('hidden');
    }

    qs('admin-more-menu-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      qs('admin-notification-panel')?.classList.add('hidden');
      qs('admin-quick-menu')?.classList.toggle('hidden');
    });

    qs('admin-menu-close')?.addEventListener('click', closeAdminFloatingPanels);

    qs('admin-notification-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      qs('admin-quick-menu')?.classList.add('hidden');
      qs('admin-notification-panel')?.classList.toggle('hidden');
    });

    qs('admin-notification-close')?.addEventListener('click', closeAdminFloatingPanels);

    qs('admin-floating-logout')?.addEventListener('click', async () => {
      await adminClient.auth.signOut();
      window.location.href = 'admin-login.html';
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.admin-floating-menu') && !e.target.closest('#admin-more-menu-btn') && !e.target.closest('.admin-notification-panel') && !e.target.closest('#admin-notification-btn')) {
        closeAdminFloatingPanels();
      }
    });

    qs('admin-quick-menu')?.querySelectorAll('.floating-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeAdminFloatingPanels();
      });
    });


    qs('admin-order-search')?.addEventListener('input', async () => {
      window.__adminOrdersPage = 1;
      await loadAdminOrders();
    });
    qs('admin-order-filter-btn')?.addEventListener('click', async () => {
      window.__adminOrdersPage = 1;
      await loadAdminOrders();
    });

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


  if (!window.__payoutViewDelegationBound) {
    window.__payoutViewDelegationBound = true;
    document.addEventListener('click', (e) => {
      const payoutBtn = e.target.closest('.js-payout-view');
      if (payoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        const raw = payoutBtn.getAttribute('data-payout');
        if (raw) {
          try {
            openPayoutDetailsModal(JSON.parse(raw));
          } catch (err) {
            alert('Payout details not found');
          }
        } else {
          const id = payoutBtn.getAttribute('data-id');
          const row = (window.__adminOrderRows || []).find((r) => r.id === id);
          if (row) {
            openPayoutDetailsModal(buildPayoutDetails(row));
          } else {
            alert('Payout details not found');
          }
        }
        return;
      }
      const detailBtn = e.target.closest('#admin-view-payout-details');
      if (detailBtn) {
        e.preventDefault();
        const raw = detailBtn.getAttribute('data-payout');
        if (raw) {
          try {
            openPayoutDetailsModal(JSON.parse(raw));
          } catch (err) {
            alert('Payout details not found');
          }
        } else {
          const id = detailBtn.getAttribute('data-id');
          const row = (window.__adminOrderRows || []).find((r) => r.id === id);
          if (row) {
            openPayoutDetailsModal(buildPayoutDetails(row));
          } else {
            alert('Payout details not found');
          }
        }
      }
    });
  }


  // telegram-support-copy-delegated
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#copy-telegram-support');
    if (!btn) return;
    const ok = await copyText('@anmolaro');
    flashInlineCopyState(btn, ok, '✓');
  });

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
