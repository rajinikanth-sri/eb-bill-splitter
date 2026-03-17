const DEFAULT_TEMPLATE =
`*EB Bill {period} — {meter}:*
===================
*{name}:*
READING {curr} - {prev} = {usage}
Total Energy Charge: {total_energy_amt} ({rate}*)
Energy Charges: {energy_amt} ({rate} * {usage} Units)
Fixed Charge: {fixed_total}/{num_splits} = {fixed_amt}
Common Area: {common_amt}
Tax: {tax_amt}
*Total: ₹{total}*`;

let state = {
  settings: {
    cycle: 'monthly',
    msgTemplate: DEFAULT_TEMPLATE,
    tenants: [
      { id: 't1', name: 'Tenant 1', phone: '' },
      { id: 't2', name: 'Tenant 2', phone: '' },
      { id: 't3', name: 'Tenant 3', phone: '' }
    ],
    mainMeters: [
      { id: 'm1', name: 'EB Main Meter', tenantIds: ['t1','t2','t3'] }
    ]
  },
  history: [],
  lastResult: null,
  activeTab: 'calculate'
};

function uid(){ return 'id'+Date.now()+Math.random().toString(36).slice(2,5); }

// ── STORAGE ──────────────────────────────────────────────
function saveSettings(){ localStorage.setItem('eb_settings', JSON.stringify(state.settings)); }
function saveHistory(){ localStorage.setItem('eb_history', JSON.stringify(state.history)); }
function loadState(){
  try{ const s=localStorage.getItem('eb_settings'); if(s) state.settings={...state.settings,...JSON.parse(s)}; }catch(e){}
  try{ const h=localStorage.getItem('eb_history'); if(h) state.history=JSON.parse(h); }catch(e){}
}

// ── TABS ──────────────────────────────────────────────
function switchTab(tab){
  state.activeTab = tab;
  document.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === 'panel-'+tab));
  if(tab === 'history') renderHistory();
  if(tab === 'settings') renderSettings();
  if(tab === 'calculate') { renderCalcSections(); applyAutofill(); }
  document.querySelector('.scroll-body').scrollTop = 0;
}

// ── CALCULATE ────────────────────────────────────────────
function renderCalcSections(){
  let html = '';
  state.settings.mainMeters.forEach((m, mi) => {
    const linked = state.settings.tenants.filter(t => m.tenantIds.includes(t.id));
    const n = linked.length;
    html += `
    <div class="card card-accent">
      <div class="meter-header">
        <span class="meter-badge">Meter ${mi+1}</span>
        <span style="font-size:15px;font-weight:600;">${m.name}</span>
        <span style="font-size:12px;color:var(--text3);">${n} tenant${n!==1?'s':''}</span>
      </div>

      <div class="form-row-3">
        <div class="form-group"><label>Prev (kWh)</label><input type="number" id="m${mi}_prev" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})" /></div>
        <div class="form-group"><label>Curr (kWh)</label><input type="number" id="m${mi}_curr" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})" /></div>
        <div class="form-group"><label>Rate (₹)</label><input type="number" id="m${mi}_rate" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})" /></div>
      </div>

      <div id="m${mi}_usage_line" style="display:none;padding:8px 10px;background:var(--surface2);border-radius:8px;font-size:13px;margin-bottom:10px;">
        Usage: <b id="m${mi}_usage_val">—</b> kWh &nbsp;·&nbsp; Energy: <b id="m${mi}_auto_energy">₹—</b>
      </div>

      <div class="form-row-2">
        <div class="form-group"><label>Energy charge (₹)</label><input type="number" id="m${mi}_energy" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})" /></div>
        <div class="form-group"><label>Fixed charge (₹)</label><input type="number" id="m${mi}_fixed" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})" /></div>
        <div class="form-group"><label>Common area (₹)</label><input type="number" id="m${mi}_common" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})" /></div>
        <div class="form-group"><label>Tax ₹ <span style="color:var(--text3);font-size:11px;">by usage</span></label><input type="number" id="m${mi}_tax" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})" /></div>
      </div>

      <div class="total-bar">
        <span class="total-label">Computed total</span>
        <span class="total-val" id="m${mi}_computed">₹0.00</span>
      </div>
      <div class="form-group"><label>Confirm total bill (₹)</label><input type="number" id="m${mi}_confirm" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})" /></div>
      <div id="m${mi}_warn" class="alert" style="display:none;">Charges don't match confirmed total.</div>

      ${n > 0 ? `
      <div style="margin-top:8px;">
        <div class="section-label">Sub-meter readings</div>
        ${linked.map((t,ti) => `
          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${t.name}</div>
            <div class="form-row-3">
              <div class="form-group"><label>Prev (kWh)</label><input type="number" id="m${mi}_t${ti}_prev" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})" /></div>
              <div class="form-group"><label>Curr (kWh)</label><input type="number" id="m${mi}_t${ti}_curr" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})" /></div>
              <div class="form-group"><label>Usage</label><div style="padding:10px 12px;background:var(--surface2);border-radius:8px;font-size:14px;font-weight:600;" id="m${mi}_t${ti}_usage">— kWh</div></div>
            </div>
          </div>`).join('')}
        <div id="m${mi}_sub_warn" class="alert" style="display:none;"></div>
      </div>` : `<div class="info-box">No tenants linked. Go to Settings → Meters to link tenants.</div>`}
    </div>`;
  });
  document.getElementById('calc-meters').innerHTML = html;
}

function onMeterChange(mi){
  const prev=parseFloat(document.getElementById(`m${mi}_prev`)?.value)||0;
  const curr=parseFloat(document.getElementById(`m${mi}_curr`)?.value)||0;
  const rate=parseFloat(document.getElementById(`m${mi}_rate`)?.value)||0;
  const usage=Math.max(0,curr-prev);
  const line=document.getElementById(`m${mi}_usage_line`);
  if(usage>0){
    line.style.display='block';
    document.getElementById(`m${mi}_usage_val`).textContent=usage.toFixed(2);
    document.getElementById(`m${mi}_auto_energy`).textContent=rate>0?'₹'+(rate*usage).toFixed(2):'₹—';
    if(rate>0){ const el=document.getElementById(`m${mi}_energy`); if(el&&!parseFloat(el.value)) el.value=(rate*usage).toFixed(2); }
  } else { line.style.display='none'; }
  syncMeter(mi); updateSubUsage(mi);
}

function syncMeter(mi){
  const e=parseFloat(document.getElementById(`m${mi}_energy`)?.value)||0;
  const f=parseFloat(document.getElementById(`m${mi}_fixed`)?.value)||0;
  const c=parseFloat(document.getElementById(`m${mi}_common`)?.value)||0;
  const t=parseFloat(document.getElementById(`m${mi}_tax`)?.value)||0;
  const sum=e+f+c+t;
  const comp=document.getElementById(`m${mi}_computed`); if(comp) comp.textContent='₹'+sum.toFixed(2);
  const conf=parseFloat(document.getElementById(`m${mi}_confirm`)?.value)||0;
  const warn=document.getElementById(`m${mi}_warn`);
  if(warn) warn.style.display=(conf>0&&Math.abs(sum-conf)>0.5)?'block':'none';
}

function updateSubUsage(mi){
  const m=state.settings.mainMeters[mi]; if(!m) return;
  const linked=state.settings.tenants.filter(t=>m.tenantIds.includes(t.id));
  const mainP=parseFloat(document.getElementById(`m${mi}_prev`)?.value)||0;
  const mainC=parseFloat(document.getElementById(`m${mi}_curr`)?.value)||0;
  const mainUsage=Math.max(0,mainC-mainP);
  let subTotal=0;
  linked.forEach((_,ti)=>{
    const p=parseFloat(document.getElementById(`m${mi}_t${ti}_prev`)?.value)||0;
    const c=parseFloat(document.getElementById(`m${mi}_t${ti}_curr`)?.value)||0;
    const u=Math.max(0,c-p);
    const el=document.getElementById(`m${mi}_t${ti}_usage`); if(el) el.textContent=u.toFixed(2)+' kWh';
    subTotal+=u;
  });
  const warn=document.getElementById(`m${mi}_sub_warn`);
  if(warn){
    if(mainUsage>0&&subTotal>0&&Math.abs(subTotal-mainUsage)>0.5){
      warn.style.display='block';
      warn.textContent=`Sub-meters: ${subTotal.toFixed(2)} kWh vs main: ${mainUsage.toFixed(2)} kWh (diff: ${(mainUsage-subTotal).toFixed(2)} kWh)`;
    } else warn.style.display='none';
  }
}

function calculateAll(){
  const period=document.getElementById('period-label').value||'Unnamed';
  const date=document.getElementById('reading-date').value;
  const meterResults=[];

  state.settings.mainMeters.forEach((m,mi)=>{
    const linked=state.settings.tenants.filter(t=>m.tenantIds.includes(t.id));
    const n=linked.length; if(!n) return;
    const mainPrev=parseFloat(document.getElementById(`m${mi}_prev`)?.value)||0;
    const mainCurr=parseFloat(document.getElementById(`m${mi}_curr`)?.value)||0;
    const mainUsage=Math.max(0,mainCurr-mainPrev);
    const rate=parseFloat(document.getElementById(`m${mi}_rate`)?.value)||0;
    const totalEnergy=parseFloat(document.getElementById(`m${mi}_energy`)?.value)||0;
    const fixedAmt=parseFloat(document.getElementById(`m${mi}_fixed`)?.value)||0;
    const commonAmt=parseFloat(document.getElementById(`m${mi}_common`)?.value)||0;
    const taxAmt=parseFloat(document.getElementById(`m${mi}_tax`)?.value)||0;
    const totalBill=parseFloat(document.getElementById(`m${mi}_confirm`)?.value)||(totalEnergy+fixedAmt+commonAmt+taxAmt);

    const subPrevs=[],subCurrs=[],usages=[]; let subTotal=0;
    linked.forEach((_,ti)=>{
      const p=parseFloat(document.getElementById(`m${mi}_t${ti}_prev`)?.value)||0;
      const c=parseFloat(document.getElementById(`m${mi}_t${ti}_curr`)?.value)||0;
      subPrevs.push(p); subCurrs.push(c);
      const u=Math.max(0,c-p); usages.push(u); subTotal+=u;
    });

    const effUsage=subTotal>0?subTotal:mainUsage;
    const perFixed=n>0?fixedAmt/n:0, perCommon=n>0?commonAmt/n:0;
    const billData={rate,totalEnergy,mainUsage,mainPrev,mainCurr,fixedAmt,commonAmt,taxAmt,totalBill,numSplits:n};
    const splits=[]; let runE=0,runT=0;
    linked.forEach((t,ti)=>{
      const ratio=effUsage>0?usages[ti]/effUsage:(1/n);
      const myE=(ti<n-1)?totalEnergy*ratio:totalEnergy-runE; runE+=myE;
      const myT=(ti<n-1)?taxAmt*ratio:taxAmt-runT; runT+=myT;
      splits.push({tenantId:t.id,name:t.name,phone:t.phone||'',prev:subPrevs[ti],curr:subCurrs[ti],usage:usages[ti],energyAmt:myE,fixedAmt:perFixed,commonAmt:perCommon,taxAmt:myT,total:myE+perFixed+perCommon+myT});
    });
    meterResults.push({meterId:m.id,meterName:m.name,billData,splits});
  });

  if(!meterResults.length){ alert('No meters with linked tenants found. Check Settings.'); return; }
  state.lastResult={period,date,meterResults};
  renderResults(period,meterResults);
  document.getElementById('result-section').style.display='block';
  setTimeout(()=>document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'}),100);
}

function buildMessage(split,period,meterName,bd){
  return (state.settings.msgTemplate||DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g,(_,k)=>{
    const map={name:split.name,meter:meterName,period,prev:split.prev.toFixed(2),curr:split.curr.toFixed(2),usage:split.usage.toFixed(2),rate:bd.rate.toFixed(2),total_energy_amt:bd.totalEnergy.toFixed(2),energy_amt:split.energyAmt.toFixed(2),fixed_total:bd.fixedAmt.toFixed(2),fixed_amt:split.fixedAmt.toFixed(2),common_amt:split.commonAmt.toFixed(2),tax_amt:split.taxAmt.toFixed(2),total:split.total.toFixed(2),num_splits:String(bd.numSplits)};
    return map[k]!==undefined?map[k]:'{'+k+'}';
  });
}

function renderResults(period,meterResults){
  let html='';
  meterResults.forEach(mr=>{
    const {meterName,billData:bd,splits}=mr;
    let tTot=0;
    const rows=splits.map(s=>{ tTot+=s.total; return `<tr><td style="font-weight:600;">${s.name}</td><td>${s.usage.toFixed(2)}</td><td>₹${s.energyAmt.toFixed(2)}</td><td>₹${(s.fixedAmt+s.commonAmt).toFixed(2)}</td><td>₹${s.taxAmt.toFixed(2)}</td><td style="font-weight:700;">₹${s.total.toFixed(2)}</td></tr>`; }).join('');
    const waButtons=splits.map(s=>{
      if(!s.phone) return `<div style="padding:8px 12px;border:1px solid var(--border2);border-radius:8px;font-size:13px;color:var(--text3);">${s.name}: no number</div>`;
      const url=`https://wa.me/${s.phone}?text=${encodeURIComponent(buildMessage(s,period,meterName,bd))}`;
      return `<a href="${url}" target="_blank" style="text-decoration:none;"><button class="btn btn-wa btn-sm"><svg class="wa-icon" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>${s.name} · ₹${s.total.toFixed(2)}</button></a>`;
    }).join('');

    html+=`<div class="card" style="margin-bottom:10px;">
      <div class="meter-header"><span class="meter-badge">Result</span><span style="font-weight:600;">${meterName}</span></div>
      <div class="metric-row">
        <div class="metric"><div class="metric-label">Total bill</div><div class="metric-val">₹${bd.totalBill.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Usage</div><div class="metric-val">${bd.mainUsage.toFixed(2)} kWh</div></div>
        <div class="metric"><div class="metric-label">Rate</div><div class="metric-val">₹${bd.rate.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Tenants</div><div class="metric-val">${splits.length}</div></div>
      </div>
      <div style="overflow-x:auto;">
        <table class="split-table">
          <thead><tr><th>Tenant</th><th>kWh</th><th>Energy</th><th>Fixed+Com</th><th>Tax</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Total</td><td colspan="4"></td><td style="font-weight:700;">₹${tTot.toFixed(2)}</td></tr></tfoot>
        </table>
      </div>
      <div style="margin-top:12px;">
        <div class="section-label" style="margin-bottom:8px;">Send via WhatsApp</div>
        <div style="display:flex;flex-direction:column;gap:8px;">${waButtons}</div>
      </div>
    </div>`;
  });
  document.getElementById('result-content').innerHTML=html;
}

function saveToHistory(){
  if(!state.lastResult){ alert('Calculate first.'); return; }
  state.history.unshift({...state.lastResult, savedAt:new Date().toISOString()});
  saveHistory();
  const btn=document.getElementById('save-btn');
  btn.textContent='✓ Saved!'; btn.disabled=true;
  setTimeout(()=>{ btn.textContent='Save to history'; btn.disabled=false; },2000);
}

function applyAutofill(){
  if(!state.history.length) return;
  const last=state.history[0];
  if(!last.meterResults) return;
  let filled=0;
  last.meterResults.forEach((mr,mi)=>{
    const ep=document.getElementById(`m${mi}_prev`);
    if(ep&&mr.billData.mainCurr){ ep.value=parseFloat(mr.billData.mainCurr).toFixed(2); filled++; }
    mr.splits.forEach((s,ti)=>{
      const el=document.getElementById(`m${mi}_t${ti}_prev`);
      if(el&&s.curr!==undefined){ el.value=parseFloat(s.curr).toFixed(2); filled++; }
    });
    onMeterChange(mi);
  });
  if(filled>0){
    const b=document.getElementById('autofill-banner');
    document.getElementById('autofill-text').textContent=`Previous readings filled from "${last.period}"`;
    b.style.display='flex';
  }
}

function clearAutofill(){
  document.getElementById('autofill-banner').style.display='none';
  state.settings.mainMeters.forEach((_,mi)=>{
    const el=document.getElementById(`m${mi}_prev`); if(el) el.value='';
    state.settings.tenants.filter(t=>state.settings.mainMeters[mi].tenantIds.includes(t.id)).forEach((_,ti)=>{
      const ep=document.getElementById(`m${mi}_t${ti}_prev`); if(ep) ep.value='';
    });
    onMeterChange(mi);
  });
}

function clearForm(){
  clearAutofill();
  state.settings.mainMeters.forEach((_,mi)=>{
    ['prev','curr','rate','energy','fixed','common','tax','confirm'].forEach(f=>{ const el=document.getElementById(`m${mi}_${f}`); if(el) el.value=''; });
    state.settings.tenants.filter(t=>state.settings.mainMeters[mi].tenantIds.includes(t.id)).forEach((_,ti)=>{
      const ep=document.getElementById(`m${mi}_t${ti}_prev`); if(ep) ep.value='';
      const ec=document.getElementById(`m${mi}_t${ti}_curr`); if(ec) ec.value='';
      const eu=document.getElementById(`m${mi}_t${ti}_usage`); if(eu) eu.textContent='— kWh';
    });
    const comp=document.getElementById(`m${mi}_computed`); if(comp) comp.textContent='₹0.00';
    const ul=document.getElementById(`m${mi}_usage_line`); if(ul) ul.style.display='none';
  });
  document.getElementById('result-section').style.display='none';
}

// ── SETTINGS ─────────────────────────────────────────────
function renderSettings(){
  document.getElementById('set-cycle').value=state.settings.cycle;
  document.getElementById('set-msg-template').value=state.settings.msgTemplate||DEFAULT_TEMPLATE;
  document.getElementById('set-msg-template').oninput=updateMsgPreview;
  renderTenants(); renderMetersSettings(); updateMsgPreview();
}

function renderTenants(){
  const html=state.settings.tenants.map((t,i)=>`
    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:600;font-size:14px;">Tenant ${i+1}</span>
        <button class="btn btn-danger btn-sm" onclick="removeTenant('${t.id}')">Remove</button>
      </div>
      <div class="form-group"><label>Name</label><input type="text" class="t-name" data-id="${t.id}" value="${t.name}" /></div>
      <div class="form-group" style="margin-bottom:0;"><label>WhatsApp number</label><input type="tel" class="t-phone" data-id="${t.id}" inputmode="numeric" placeholder="919876543210" value="${t.phone||''}" /></div>
    </div>`).join('');
  document.getElementById('tenant-list').innerHTML=html;
}

function addTenant(){
  state.settings.tenants.push({id:uid(),name:'Tenant '+(state.settings.tenants.length+1),phone:''});
  renderTenants(); renderMetersSettings();
}

function removeTenant(id){
  state.settings.tenants=state.settings.tenants.filter(t=>t.id!==id);
  state.settings.mainMeters.forEach(m=>{ m.tenantIds=m.tenantIds.filter(tid=>tid!==id); });
  renderTenants(); renderMetersSettings();
}

function addMeter(){
  state.settings.mainMeters.push({id:uid(),name:'Meter '+(state.settings.mainMeters.length+1),tenantIds:[]});
  renderMetersSettings();
}

function removeMeter(id){
  if(state.settings.mainMeters.length<=1){ alert('At least one meter required.'); return; }
  state.settings.mainMeters=state.settings.mainMeters.filter(m=>m.id!==id);
  renderMetersSettings();
}

function renderMetersSettings(){
  const html=state.settings.mainMeters.map((m,mi)=>{
    const chips=state.settings.tenants.map(t=>`
      <span class="tenant-chip ${m.tenantIds.includes(t.id)?'selected':''}" onclick="toggleTenant('${m.id}','${t.id}')">${t.name}</span>`).join('');
    return `<div class="card card-accent" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span class="meter-badge">Meter ${mi+1}</span>
        <button class="btn btn-danger btn-sm" onclick="removeMeter('${m.id}')">Remove</button>
      </div>
      <div class="form-group"><label>Meter name</label><input type="text" class="m-name" data-id="${m.id}" value="${m.name}" /></div>
      <div><label style="font-size:13px;color:var(--text2);display:block;margin-bottom:6px;">Linked tenants</label>
        <div>${chips||'<span style="font-size:13px;color:var(--text3);">Add tenants above first</span>'}</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('meter-list').innerHTML=html;
}

function toggleTenant(meterId,tenantId){
  const m=state.settings.mainMeters.find(x=>x.id===meterId); if(!m) return;
  if(m.tenantIds.includes(tenantId)) m.tenantIds=m.tenantIds.filter(x=>x!==tenantId);
  else m.tenantIds.push(tenantId);
  renderMetersSettings();
}

function applySettings(){
  state.settings.cycle=document.getElementById('set-cycle').value;
  state.settings.msgTemplate=document.getElementById('set-msg-template').value||DEFAULT_TEMPLATE;
  document.querySelectorAll('.t-name').forEach(el=>{ const t=state.settings.tenants.find(x=>x.id===el.dataset.id); if(t) t.name=el.value.trim()||t.name; });
  document.querySelectorAll('.t-phone').forEach(el=>{ const t=state.settings.tenants.find(x=>x.id===el.dataset.id); if(t) t.phone=el.value.trim(); });
  document.querySelectorAll('.m-name').forEach(el=>{ const m=state.settings.mainMeters.find(x=>x.id===el.dataset.id); if(m) m.name=el.value.trim()||m.name; });
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  saveSettings();
  renderCalcSections();
  alert('Settings saved!');
}

function updateMsgPreview(){
  const tmpl=document.getElementById('set-msg-template')?.value||DEFAULT_TEMPLATE;
  const name=state.settings.tenants[0]?.name||'First Floor';
  const meter=state.settings.mainMeters[0]?.name||'EB Main Meter';
  const preview=tmpl.replace(/\{(\w+)\}/g,(_,k)=>{
    const map={name,meter,period:'JAN 2026',prev:'6594.48',curr:'6895.10',usage:'300.62',rate:'10.97',total_energy_amt:'3298.57',energy_amt:'1039.48',fixed_total:'856.00',fixed_amt:'285.33',common_amt:'100.00',tax_amt:'57.60',total:'1482.41',num_splits:'3'};
    return map[k]!==undefined?map[k]:'{'+k+'}';
  });
  const el=document.getElementById('msg-preview'); if(el) el.textContent=preview;
}

// ── HISTORY ──────────────────────────────────────────────
function renderHistory(){
  const el=document.getElementById('history-list');
  if(!state.history.length){ el.innerHTML='<div class="empty">No records yet.<br>Calculate and save a bill to see it here.</div>'; return; }
  el.innerHTML=state.history.map((rec,idx)=>{
    const d=rec.savedAt?new Date(rec.savedAt).toLocaleDateString('en-IN'):'—';
    const totalBill=(rec.meterResults||[]).reduce((s,mr)=>s+parseFloat(mr.billData.totalBill||0),0);
    return `<div class="history-item">
      <div>
        <div style="font-weight:600;font-size:15px;">${rec.period} ${idx===0?'<span class="badge badge-success">latest</span>':''}</div>
        <div style="font-size:13px;color:var(--text3);">${(rec.meterResults||[]).length} meters · ₹${totalBill.toFixed(2)} · ${d}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm" onclick="viewRecord(${idx})">View</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecord(${idx})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function viewRecord(idx){
  const rec=state.history[idx];
  let html=`<div style="font-size:17px;font-weight:700;margin-bottom:14px;">${rec.period}</div>`;
  (rec.meterResults||[]).forEach(mr=>{
    const rows=mr.splits.map(s=>`<tr><td style="font-weight:600;">${s.name}</td><td>${parseFloat(s.usage).toFixed(2)}</td><td>₹${parseFloat(s.energyAmt).toFixed(2)}</td><td>₹${(parseFloat(s.fixedAmt)+parseFloat(s.commonAmt)).toFixed(2)}</td><td>₹${parseFloat(s.taxAmt).toFixed(2)}</td><td style="font-weight:700;">₹${parseFloat(s.total).toFixed(2)}</td></tr>`).join('');
    const waButtons=mr.splits.filter(s=>s.phone).map(s=>{
      const url=`https://wa.me/${s.phone}?text=${encodeURIComponent(buildMessage(s,rec.period,mr.meterName,mr.billData))}`;
      return `<a href="${url}" target="_blank" style="text-decoration:none;"><button class="btn btn-wa btn-sm">${s.name} ↗</button></a>`;
    }).join('');
    html+=`<div class="card" style="margin-bottom:10px;">
      <div class="meter-header"><span class="meter-badge">Meter</span><span style="font-weight:600;">${mr.meterName}</span></div>
      <div class="metric-row">
        <div class="metric"><div class="metric-label">Bill</div><div class="metric-val">₹${parseFloat(mr.billData.totalBill).toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Usage</div><div class="metric-val">${parseFloat(mr.billData.mainUsage).toFixed(2)} kWh</div></div>
      </div>
      <div style="overflow-x:auto;"><table class="split-table"><thead><tr><th>Tenant</th><th>kWh</th><th>Energy</th><th>Fixed</th><th>Tax</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${waButtons?`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">${waButtons}</div>`:''}
    </div>`;
  });
  document.getElementById('history-detail').innerHTML=html;
  document.getElementById('history-detail').style.display='block';
  document.getElementById('history-detail').scrollIntoView({behavior:'smooth',block:'start'});
}

function deleteRecord(idx){
  if(!confirm('Delete this record?')) return;
  state.history.splice(idx,1); saveHistory(); renderHistory();
  document.getElementById('history-detail').style.display='none';
}

function clearHistory(){
  if(!confirm('Clear all history? This cannot be undone.')) return;
  state.history=[]; saveHistory(); renderHistory();
  document.getElementById('history-detail').style.display='none';
}

// ── EXCEL EXPORT ──────────────────────────────────────────
function exportExcel(){
  if(!state.history.length){ alert('No history to export yet.'); return; }
  if(typeof XLSX==='undefined'){ alert('Excel library not loaded yet. Try again in a moment.'); return; }
  const wb=XLSX.utils.book_new();
  const sumData=[['EB Bill History — Summary'],[], ['Period','Meter','Usage (kWh)','Rate (₹)','Energy (₹)','Fixed (₹)','Common (₹)','Tax (₹)','Total (₹)','Tenants']];
  state.history.forEach(rec=>{
    (rec.meterResults||[]).forEach(mr=>{
      sumData.push([rec.period,mr.meterName,parseFloat(mr.billData.mainUsage||0),parseFloat(mr.billData.rate||0),parseFloat(mr.billData.totalEnergy||0),parseFloat(mr.billData.fixedAmt||0),parseFloat(mr.billData.commonAmt||0),parseFloat(mr.billData.taxAmt||0),parseFloat(mr.billData.totalBill||0),mr.splits.length]);
    });
  });
  const ws1=XLSX.utils.aoa_to_sheet(sumData);
  ws1['!cols']=[14,20,14,10,12,12,12,10,12,8].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws1,'Summary');
  const detData=[['Detailed Splits'],[], ['Period','Meter','Tenant','Prev','Curr','kWh','Energy (₹)','Fixed (₹)','Common (₹)','Tax (₹)','Total (₹)']];
  state.history.forEach(rec=>{
    (rec.meterResults||[]).forEach(mr=>{
      mr.splits.forEach(s=>{ detData.push([rec.period,mr.meterName,s.name,parseFloat(s.prev||0),parseFloat(s.curr||0),parseFloat(s.usage||0),parseFloat(s.energyAmt||0),parseFloat(s.fixedAmt||0),parseFloat(s.commonAmt||0),parseFloat(s.taxAmt||0),parseFloat(s.total||0)]); });
      detData.push([]);
    });
  });
  const ws2=XLSX.utils.aoa_to_sheet(detData);
  ws2['!cols']=[14,20,20,10,10,12,12,12,12,10,12].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws2,'Detailed Splits');
  state.history.forEach(rec=>{
    (rec.meterResults||[]).forEach(mr=>{
      const sn=(rec.period+' '+mr.meterName).replace(/[\/\\?\*\[\]:]/g,'-').substring(0,31);
      const bd=mr.billData;
      const d=[['Period: '+rec.period,'Meter: '+mr.meterName],[],['Main Prev',parseFloat(bd.mainPrev||0),'Rate',parseFloat(bd.rate||0)],['Main Curr',parseFloat(bd.mainCurr||0),'Energy (₹)',parseFloat(bd.totalEnergy||0)],['Usage (kWh)',parseFloat(bd.mainUsage||0),'Fixed (₹)',parseFloat(bd.fixedAmt||0)],['','','Common (₹)',parseFloat(bd.commonAmt||0)],['','','Tax (₹)',parseFloat(bd.taxAmt||0)],['','','Total Bill (₹)',parseFloat(bd.totalBill||0)],[],['Tenant','Prev','Curr','kWh','Energy','Fixed','Common','Tax','Total']];
      mr.splits.forEach(s=>d.push([s.name,parseFloat(s.prev||0),parseFloat(s.curr||0),parseFloat(s.usage||0),parseFloat(s.energyAmt||0),parseFloat(s.fixedAmt||0),parseFloat(s.commonAmt||0),parseFloat(s.taxAmt||0),parseFloat(s.total||0)]));
      const sr=11,er=sr+mr.splits.length-1;
      d.push(['TOTAL',`=SUM(B${sr}:B${er})`,`=SUM(C${sr}:C${er})`,`=SUM(D${sr}:D${er})`,`=SUM(E${sr}:E${er})`,`=SUM(F${sr}:F${er})`,`=SUM(G${sr}:G${er})`,`=SUM(H${sr}:H${er})`,`=SUM(I${sr}:I${er})`]);
      const ws=XLSX.utils.aoa_to_sheet(d);
      ws['!cols']=[22,10,10,12,12,12,12,10,12].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb,ws,sn);
    });
  });
  XLSX.writeFile(wb,'EB_Bills_'+new Date().toISOString().slice(0,10)+'.xlsx');
}

function exportJSON(){
  const blob=new Blob([JSON.stringify({settings:state.settings,history:state.history},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='eb-bill-backup.json'; a.click();
}

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded',()=>{
  loadState();
  document.getElementById('reading-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  renderCalcSections();
  setTimeout(applyAutofill, 100);

  // Register service worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
});
