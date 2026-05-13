
(function(){
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || !window.supabase) return;
  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const tbody = document.getElementById('lpRatesBody');
  const marketPrice = document.getElementById('lpMarketPrice');
  const marketChange = document.getElementById('lpMarketChange');
  if (!tbody) return;

  function fmtRange(min, max){
    const a = Number(min || 0).toLocaleString('en-IN', {maximumFractionDigits:0});
    if (max === null || max === undefined) return `${a}+ USDT`;
    const b = Number(max || 0).toLocaleString('en-IN', {maximumFractionDigits:0});
    return `${a} – ${b} USDT`;
  }

  function tagMeta(type){
    const t = String(type || 'standard').toLowerCase();
    if (t.includes('bulk')) return ['Highest','lp-rate-highest'];
    if (t.includes('priority')) return ['Best','lp-rate-best'];
    if (t.includes('fast')) return ['Better','lp-rate-better'];
    return ['Standard','lp-rate-standard'];
  }

  async function loadLandingSlabs(){
    try{
      const { data, error } = await client
        .from('quote_slabs')
        .select('quote_type,min_amount,max_amount,min_crypto_amount,max_crypto_amount,rate_inr,is_enabled,coin_symbol,network')
        .eq('coin_symbol','USDT')
        .eq('network','TRC20')
        .eq('is_enabled', true)
        .order('min_amount',{ascending:true});

      if (error) throw error;

      if (!data || !data.length){
        tbody.innerHTML = '<tr><td colspan="4" class="lp-loading">No active USDT quote slabs found.</td></tr>';
        marketPrice.textContent = '₹0.00';
        marketChange.textContent = 'No active quotes';
        return;
      }

      const rates = data.map(r => Number(r.rate_inr || 0));
      const highest = Math.max(...rates);
      marketPrice.textContent = `₹${highest.toFixed(2)}`;
      marketChange.textContent = '+ Live Admin Quotes';

      tbody.innerHTML = data.map((row) => {
        const min = row.min_amount ?? row.min_crypto_amount ?? 0;
        const max = row.max_amount ?? row.max_crypto_amount;
        const [label, cls] = tagMeta(row.quote_type);
        return `
          <tr>
            <td>${fmtRange(min, max)}</td>
            <td>₹${Number(row.rate_inr || 0).toFixed(2)} / USDT</td>
            <td><span class="lp-rate-tag ${cls}">${label}</span></td>
            <td><a class="lp-inline-btn" href="login.html">Get Quote</a></td>
          </tr>
        `;
      }).join('');
    } catch(err){
      console.error(err);
      tbody.innerHTML = '<tr><td colspan="4" class="lp-loading">Could not load live quote slabs.</td></tr>';
      marketPrice.textContent = '₹0.00';
      marketChange.textContent = 'Load failed';
    }
  }

  loadLandingSlabs();
})();
