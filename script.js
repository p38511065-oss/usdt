function setActiveTab(target){
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.style.display='none');
  document.querySelector(`[data-tab="${target}"]`)?.classList.add('active');
  const panel=document.getElementById(target);
  if(panel) panel.style.display='block';
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>setActiveTab(btn.dataset.tab));
  });
  if(document.querySelector('.tab-btn')) setActiveTab('login-panel');

  document.querySelectorAll('[data-fill-estimate]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const amount = Number(document.getElementById('sellAmount')?.value || 25000);
      const rate = 83.15;
      const est = Math.round(amount * rate).toLocaleString('en-IN');
      const target = document.getElementById('estimateINR');
      if(target) target.textContent = `₹${est}`;
      const preview = document.getElementById('selectedAmountPreview');
      if(preview) preview.textContent = `${amount.toLocaleString('en-IN')} USDT`;
    });
  });

  document.querySelectorAll('[data-copy]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const text = btn.getAttribute('data-copy');
      try{ await navigator.clipboard.writeText(text); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1200);}catch(e){}
    })
  })
});
