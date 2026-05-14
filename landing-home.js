
(function () {
  const client = window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  const ratesBody = document.getElementById('lpRatesBody');
  const marketPrice = document.getElementById('lpMarketPrice');
  const marketPriceMirror = document.getElementById('lpMarketPriceMirror');
  const marketChange = document.getElementById('lpMarketChange');
  const marketChangeMirror = document.getElementById('lpMarketChangeMirror');

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
      renderEmpty('No active admin quote slabs found for USDT/TRC20.');
      return;
    }

    const highestRate = Math.max(...rows.map((row) => Number(row.rate_inr || 0)));
    if (marketPrice) marketPrice.textContent = money(highestRate);
    if (marketPriceMirror) marketPriceMirror.textContent = money(highestRate);
    if (marketChange) marketChange.textContent = '+ Admin live slabs';
    if (marketChangeMirror) marketChangeMirror.textContent = 'Loaded from admin quote slabs';

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

  async function initLandingRates() {
    if (ratesBody) {
      ratesBody.innerHTML = '<tr><td colspan="4">Loading admin-created USDT quote slabs...</td></tr>';
    }

    try {
      const rows = await fetchAdminSlabs();
      renderRows(rows);
    } catch (error) {
      console.warn('Landing admin quote slabs load error:', error);
      renderEmpty('Could not load admin-created quote slabs. Please check Supabase RLS/select permission for quote_slabs.');
    }
  }

  initLandingRates();
})();
