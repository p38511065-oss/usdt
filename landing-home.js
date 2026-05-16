
(function () {
  const client = window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  const ratesBody = document.getElementById('lpRatesBody');
  const marketPrice = document.getElementById('lpMarketPrice');
  const marketPriceMirror = document.getElementById('lpMarketPriceMirror');
  const marketChange = document.getElementById('lpMarketChange');
  const marketChangeMirror = document.getElementById('lpMarketChangeMirror');

  const terminalTooltipRate = document.getElementById('lpTerminalTooltipRate');
  const currentRateStat = document.getElementById('lpCurrentRateStat');
  const highRateStat = document.getElementById('lpHighRateStat');
  const lowRateStat = document.getElementById('lpLowRateStat');
  const volumeStat = document.getElementById('lpVolumeStat');
  const batchPercent = document.getElementById('lpBatchPercent');
  const batchCapacity = document.getElementById('lpBatchCapacity');
  const batchRemaining = document.getElementById('lpBatchRemaining');
  const batchSlots = document.getElementById('lpBatchSlots');
  const batchOrders = document.getElementById('lpBatchOrders');
  const batchActionNote = document.getElementById('lpBatchActionNote');


  function money(n) {
    const num = Number(n || 0);
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function amount(n) {
    const num = Number(n || 0);
    return num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function slabMin(row) {
    return Number(row.min_amount ?? row.min_crypto_amount ?? 0);
  }

  function slabMax(row) {
    const value = row.max_amount ?? row.max_crypto_amount;
    if (value === null || value === undefined || value === '') return null;
    return Number(value);
  }

  function rangeLabel(row) {
    const min = slabMin(row);
    const max = slabMax(row);
    return max ? `${amount(min)} – ${amount(max)} USDT` : `${amount(min)}+ USDT`;
  }

  function quoteLabel(type) {
    const t = String(type || 'standard').toLowerCase();
    if (t.includes('bulk')) return ['Bulk OTC', 'highest'];
    if (t.includes('priority')) return ['Priority', 'best'];
    if (t.includes('fast')) return ['Fast Payout', 'better'];
    return ['Standard', 'standard'];
  }

  function normalizeRows(rows) {
    return (rows || [])
      .filter((row) => {
        const coin = String(row.coin_symbol || row.coin || '').toUpperCase();
        const network = String(row.network || '').toUpperCase();
        const enabled = row.is_enabled ?? row.is_active ?? row.status;
        const enabledOk = enabled === true || enabled === 'true' || enabled === 'active' || enabled === 'enabled' || enabled === null || enabled === undefined;
        return coin === 'USDT' &&
          (network === 'TRC20' || network === 'TRON' || network === '') &&
          enabledOk &&
          Number(row.rate_inr || row.buy_rate_inr || row.rate || 0) > 0;
      })
      .map((row) => ({
        ...row,
        rate_inr: Number(row.rate_inr || row.buy_rate_inr || row.rate || 0)
      }))
      .sort((a, b) => slabMin(a) - slabMin(b));
  }

  async function fetchAdminSlabs() {
    if (!client) {
      throw new Error('Supabase client not ready');
    }

    // Try specific selected columns first.
    let result = await client
      .from('quote_slabs')
      .select('id, quote_type, coin_symbol, network, min_amount, max_amount, min_crypto_amount, max_crypto_amount, rate_inr, buy_rate_inr, is_enabled, is_active, status')
      .eq('coin_symbol', 'USDT');

    // If schema cache does not know one of the optional columns, use select('*').
    if (result.error) {
      result = await client
        .from('quote_slabs')
        .select('*')
        .eq('coin_symbol', 'USDT');
    }

    if (result.error) {
      throw result.error;
    }

    return normalizeRows(result.data || []);
  }

  function renderEmpty(message) {
    if (marketPrice) marketPrice.textContent = '--';
    if (marketPriceMirror) marketPriceMirror.textContent = '--';
    if (marketChange) marketChange.textContent = 'Admin rates not loaded';
    if (marketChangeMirror) marketChangeMirror.textContent = message;
    if (ratesBody) {
      ratesBody.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
    }
  }

  function renderRows(rows) {
    if (!ratesBody) return;

    if (!rows.length) {
      renderEmpty('No active rate slabs found for USDT/TRC20.');
      return;
    }

    const rates = rows.map((row) => Number(row.rate_inr || 0)).filter(Boolean);
    const highestRate = Math.max(...rates);
    const lowestRate = Math.min(...rates);
    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
    const rangeText = highestRate === lowestRate ? money(highestRate) : `${money(lowestRate)} – ${money(highestRate)}`;
    if (marketPrice) marketPrice.textContent = rangeText;
    if (marketPriceMirror) marketPriceMirror.textContent = rangeText;
    if (marketChange) marketChange.textContent = 'Rate range by quantity slabs';
    if (marketChangeMirror) marketChangeMirror.textContent = 'Exact rate shows after amount selection';
    if (terminalTooltipRate) terminalTooltipRate.textContent = money(highestRate);
    if (currentRateStat) currentRateStat.textContent = rangeText;
    if (highRateStat) highRateStat.textContent = money(highestRate);
    if (lowRateStat) lowRateStat.textContent = money(lowestRate);
    if (volumeStat) volumeStat.textContent = 'After Amount';


    ratesBody.innerHTML = rows.map((row) => {
      const [label, cls] = quoteLabel(row.quote_type);
      return `
        <tr>
          <td><strong>${rangeLabel(row)}</strong></td>
          <td><strong>${money(row.rate_inr)} / USDT</strong></td>
          <td><span class="neo-pill ${cls}">${label}</span></td>
          <td><a class="neo-btn primary" href="login.html">Sell Now</a></td>
        </tr>
      `;
    }).join('');
  }


  async function loadLandingBatchStatus() {
    if (!client) return;
    try {
      const { data: batch, error } = await client
        .from('order_batches')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !batch) return;

      const limit = Number(batch.order_limit || 0);
      const usedOrders = Number(batch.used_orders || 0);
      const capacity = Number(batch.usdt_capacity || 0);
      const usedUsdt = Number(batch.used_usdt || 0);
      const remainingUsdt = Math.max(0, capacity - usedUsdt);
      const remainingSlots = Math.max(0, limit - usedOrders);
      const percent = capacity ? Math.min(100, Math.round((usedUsdt / capacity) * 100)) : 0;

      if (batchPercent) batchPercent.textContent = `${percent}%`;
      const ring = document.querySelector('.mockup-ring');
      if (ring) ring.style.background = `conic-gradient(#37ffc1 0 ${percent}%, rgba(119,190,255,.14) ${percent}% 100%)`;
      if (batchCapacity) batchCapacity.textContent = `${amount(capacity)} USDT`;
      if (batchRemaining) batchRemaining.textContent = `${amount(remainingUsdt)} USDT`;
      if (batchSlots) batchSlots.textContent = `${remainingSlots} / ${limit}`;
      if (batchOrders) batchOrders.textContent = `${usedOrders}`;
      if (batchActionNote) batchActionNote.textContent = remainingSlots > 0 && remainingUsdt > 0 ? 'Orders open for verified sellers' : 'Batch full or paused';
    } catch (err) {
      console.warn('Landing batch status load error:', err);
    }
  }


  async function initLandingRates() {
    if (ratesBody) {
      ratesBody.innerHTML = '<tr><td colspan="4">Loading verified USDT quote slabs...</td></tr>';
    }

    try {
      const rows = await fetchAdminSlabs();
      renderRows(rows);
      await loadLandingBatchStatus();
    } catch (error) {
      console.warn('Landing rate slabs load error:', error);
      renderEmpty('Could not load verified rate slabs. Please try again later.');
    }
  }

  initLandingRates();
  loadLandingBatchStatus();
})();
