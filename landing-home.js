
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

  function fallbackRows() {
    return [
      { quote_type: 'standard', coin_symbol: 'USDT', network: 'TRC20', min_amount: 100, max_amount: 999, rate_inr: 82.70, is_enabled: true },
      { quote_type: 'standard', coin_symbol: 'USDT', network: 'TRC20', min_amount: 1000, max_amount: 4999, rate_inr: 82.95, is_enabled: true },
      { quote_type: 'standard', coin_symbol: 'USDT', network: 'TRC20', min_amount: 5000, max_amount: 19999, rate_inr: 83.10, is_enabled: true },
      { quote_type: 'standard', coin_symbol: 'USDT', network: 'TRC20', min_amount: 20000, max_amount: null, rate_inr: 83.30, is_enabled: true }
    ];
  }

  async function fetchSlabs() {
    if (!client) return fallbackRows();

    // First try normal active slabs query.
    let result = await client
      .from('quote_slabs')
      .select('id, quote_type, coin_symbol, network, min_amount, max_amount, min_crypto_amount, max_crypto_amount, rate_inr, spread_percent, is_enabled')
      .eq('coin_symbol', 'USDT')
      .eq('network', 'TRC20')
      .order('min_amount', { ascending: true });

    // Some old schemas / cache can fail on min_amount ordering.
    if (result.error) {
      result = await client
        .from('quote_slabs')
        .select('*')
        .eq('coin_symbol', 'USDT')
        .eq('network', 'TRC20');
    }

    if (result.error) {
      console.warn('Landing quote slabs query failed:', result.error.message);
      return fallbackRows();
    }

    let rows = (result.data || [])
      .filter((row) => {
        const enabled = row.is_enabled;
        return enabled === true || enabled === 'true' || enabled === null || enabled === undefined;
      })
      .filter((row) => Number(row.rate_inr || 0) > 0)
      .sort((a, b) => slabMin(a) - slabMin(b));

    // If exact network case does not match, try broader USDT-only fallback.
    if (!rows.length) {
      const broad = await client
        .from('quote_slabs')
        .select('*')
        .eq('coin_symbol', 'USDT');

      if (!broad.error) {
        rows = (broad.data || [])
          .filter((row) => {
            const network = String(row.network || '').toUpperCase();
            const enabled = row.is_enabled;
            return (network === 'TRC20' || network === 'TRON' || network === '') &&
              (enabled === true || enabled === 'true' || enabled === null || enabled === undefined) &&
              Number(row.rate_inr || 0) > 0;
          })
          .sort((a, b) => slabMin(a) - slabMin(b));
      }
    }

    return rows.length ? rows : fallbackRows();
  }

  function renderRows(rows) {
    if (!ratesBody) return;

    const highestRate = Math.max(...rows.map((row) => Number(row.rate_inr || 0)));
    if (marketPrice) marketPrice.textContent = money(highestRate);
    if (marketPriceMirror) marketPriceMirror.textContent = money(highestRate);
    if (marketChange) marketChange.textContent = '+ Live admin rates';
    if (marketChangeMirror) marketChangeMirror.textContent = 'Updated from quote slabs';

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
      ratesBody.innerHTML = '<tr><td colspan="4">Loading USDT/INR live quote slabs...</td></tr>';
    }

    try {
      const rows = await fetchSlabs();
      renderRows(rows);
    } catch (error) {
      console.warn('Landing rates load error:', error);
      renderRows(fallbackRows());
    }
  }

  initLandingRates();
})();
