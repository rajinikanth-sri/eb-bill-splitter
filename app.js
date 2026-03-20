// ── Firebase config ───────────────────────────────────────
// IMPORTANT: Replace these values with your own Firebase project config
// Get them from: https://console.firebase.google.com → Your project → Project settings → Your apps
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCfcVsbDTv6kN8hR940O20Eei3syZhXpcc",
  authDomain:        "eb-bill-splitter.firebaseapp.com",
  projectId:         "eb-bill-splitter",
  storageBucket:     "eb-bill-splitter.firebasestorage.app",
  messagingSenderId: "983597766188",
  appId:             "1:983597766188:web:16a8e66efdb525838aa389"
};

// ── App state ─────────────────────────────────────────────
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
  userId: null,
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
  db: null,
  syncing: false
};

function uid(){ return 'id'+Date.now()+Math.random().toString(36).slice(2,5); }
function userDocId(){ return 'user_'+state.userId; }

// ── Firebase init ─────────────────────────────────────────
function initFirebase(){
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    state.db = firebase.firestore();
    console.log('Firebase connected');
    return true;
  } catch(e) {
    console.warn('Firebase init failed:', e);
    return false;
  }
}

// ── User identity ─────────────────────────────────────────
// Each device gets a unique user ID stored in localStorage
// Share this ID to access the same data on another device
function getOrCreateUserId(){
  let id = localStorage.getItem('eb_user_id');
  if(!id){
    id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    localStorage.setItem('eb_user_id', id);
  }
  return id;
}

function showUserId(){
  const id = state.userId;
  const msg = `Your User ID:\n\n${id}\n\nShare this ID to access your data on another device.\nOn the other device: Settings → Enter User ID → Load data.`;
  alert(msg);
}

function promptSwitchUser(){
  const newId = prompt('Enter User ID to load data from another device:\n(Leave blank to cancel)');
  if(!newId || !newId.trim()) return;
  const cleaned = newId.trim();
  if(cleaned === state.userId){ alert('That is already your current ID.'); return; }
  if(confirm(`Switch to User ID:\n${cleaned}\n\nThis will load that user's data. Continue?`)){
    localStorage.setItem('eb_user_id', cleaned);
    state.userId = cleaned;
    location.reload();
  }
}

// ── Cloud storage ─────────────────────────────────────────
async function cloudSaveSettings(){
  if(!state.db){ localSaveSettings(); return; }
  setSyncIndicator(true);
  try {
    await state.db.collection('users').doc(userDocId()).set({
      settings: state.settings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch(e) {
    console.error('Save settings failed:', e);
    localSaveSettings(); // fallback
  } finally { setSyncIndicator(false); }
}

async function cloudSaveHistory(){
  if(!state.db){ localSaveHistory(); return; }
  setSyncIndicator(true);
  try {
    await state.db.collection('users').doc(userDocId()).set({
      history: state.history,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch(e) {
    console.error('Save history failed:', e);
    localSaveHistory();
  } finally { setSyncIndicator(false); }
}

async function cloudLoadState(){
  // Always load local fallback first for instant render
  localLoadState();

  if(!state.db) return;
  setSyncIndicator(true);
  try {
    const doc = await state.db.collection('users').doc(userDocId()).get();
    if(doc.exists){
      const data = doc.data();
      if(data.settings) state.settings = { ...state.settings, ...data.settings };
      if(data.history)  state.history  = data.history;
      // Also cache locally for offline
      localSaveSettings();
      localSaveHistory();
    }
  } catch(e) {
    console.warn('Cloud load failed, using local cache:', e);
  } finally { setSyncIndicator(false); }
}

// ── Local storage fallback ────────────────────────────────
function localSaveSettings(){ localStorage.setItem('eb_settings', JSON.stringify(state.settings)); }
function localSaveHistory(){  localStorage.setItem('eb_history',  JSON.stringify(state.history));  }
function localLoadState(){
  try{ const s=localStorage.getItem('eb_settings'); if(s) state.settings={...state.settings,...JSON.parse(s)}; }catch(e){}
  try{ const h=localStorage.getItem('eb_history');  if(h) state.history=JSON.parse(h); }catch(e){}
}

// Convenience aliases used throughout
const saveSettings = cloudSaveSettings;
const saveHistory  = cloudSaveHistory;

// ── Sync indicator ────────────────────────────────────────
function setSyncIndicator(on){
  state.syncing = on;
  const el = document.getElementById('sync-indicator');
  if(el) el.style.display = on ? 'flex' : 'none';
}

// ── Tabs ──────────────────────────────────────────────────
function switchTab(tab){
  document.querySelectorAll('.tab-item').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='panel-'+tab));
  if(tab==='history')  renderHistory();
  if(tab==='settings') renderSettings();
  if(tab==='calculate'){ renderCalcSections(); setTimeout(applyAutofill,80); }
  document.querySelector('.scroll-body').scrollTop=0;
}

// ── Calculate: render meter input sections ────────────────
function renderCalcSections(){
  let html='';
  state.settings.mainMeters.forEach((m,mi)=>{
    const linked=state.settings.tenants.filter(t=>m.tenantIds.includes(t.id));
    const n=linked.length;
    const subRows = n>0 ? linked.map((t,ti)=>`
      <div class="submeter-item">
        <div class="submeter-name"><div class="submeter-dot"></div>${t.name}</div>
        <div class="submeter-fields">
          <div class="form-group" style="margin-bottom:0;">
            <label>Previous (kWh)</label>
            <input type="number" id="m${mi}_t${ti}_prev" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})"/>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Current (kWh)</label>
            <input type="number" id="m${mi}_t${ti}_curr" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})"/>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Usage</label>
            <div class="usage-chip" id="m${mi}_t${ti}_usage">— kWh</div>
          </div>
        </div>
      </div>`).join('') : `<div class="info-box">No tenants linked. Go to Settings → Main meters.</div>`;

    html+=`
    <div class="card card-meter">
      <div class="meter-header">
        <span class="badge badge-blue">Meter ${mi+1}</span>
        <span class="meter-title">${m.name}</span>
        <span class="meter-sub">${n} tenant${n!==1?'s':''}</span>
      </div>
      <div class="form-row-3">
        <div class="form-group"><label>Previous (kWh)</label><input type="number" id="m${mi}_prev" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})"/></div>
        <div class="form-group"><label>Current (kWh)</label><input type="number" id="m${mi}_curr" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})"/></div>
        <div class="form-group"><label>Rate (₹/kWh)</label><input type="number" id="m${mi}_rate" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="onMeterChange(${mi})"/></div>
      </div>
      <div class="usage-line" id="m${mi}_usage_line">
        <div class="usage-stat"><span class="usage-stat-label">Main usage</span><span class="usage-stat-val" id="m${mi}_usage_val">—</span></div>
        <div class="usage-stat"><span class="usage-stat-label">Auto energy charge</span><span class="usage-stat-val" id="m${mi}_auto_energy">₹—</span></div>
      </div>
      <div class="form-row-2">
        <div class="form-group"><label>Energy charge (₹)</label><input type="number" id="m${mi}_energy" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Fixed charge (₹)</label><input type="number" id="m${mi}_fixed" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Common area (₹)</label><input type="number" id="m${mi}_common" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Tax (₹) <span style="color:var(--text3);font-size:11px;font-weight:400;">by usage</span></label><input type="number" id="m${mi}_tax" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
      </div>
      <div class="total-bar">
        <span class="total-label">Computed total</span>
        <span class="total-val" id="m${mi}_computed">₹0.00</span>
      </div>
      <div class="form-group"><label>Confirm total bill (₹)</label><input type="number" id="m${mi}_confirm" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
      <div class="alert" id="m${mi}_warn" style="display:none;margin-top:8px;">⚠️ Charges don't match the confirmed total bill.</div>
      <div class="submeter-block">
        <div class="submeter-block-label">Sub-meter readings</div>
        ${subRows}
        <div class="alert" id="m${mi}_sub_warn" style="display:none;margin-top:8px;"></div>
      </div>
    </div>`;
  });
  document.getElementById('calc-meters').innerHTML=html;
}

function onMeterChange(mi){
  const prev=parseFloat(document.getElementById(`m${mi}_prev`)?.value)||0;
  const curr=parseFloat(document.getElementById(`m${mi}_curr`)?.value)||0;
  const rate=parseFloat(document.getElementById(`m${mi}_rate`)?.value)||0;
  const usage=Math.max(0,curr-prev);
  const line=document.getElementById(`m${mi}_usage_line`);
  if(usage>0){
    line.style.display='flex';
    document.getElementById(`m${mi}_usage_val`).textContent=usage.toFixed(2)+' kWh';
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
    const chip=document.getElementById(`m${mi}_t${ti}_usage`);
    if(chip) chip.textContent=u.toFixed(2)+' kWh';
    subTotal+=u;
  });
  const warn=document.getElementById(`m${mi}_sub_warn`);
  if(warn){
    if(mainUsage>0&&subTotal>0&&Math.abs(subTotal-mainUsage)>0.5){
      warn.style.display='block';
      warn.textContent=`⚠️ Sub-meters: ${subTotal.toFixed(2)} kWh vs main: ${mainUsage.toFixed(2)} kWh (diff: ${(mainUsage-subTotal).toFixed(2)} kWh)`;
    } else warn.style.display='none';
  }
}

// ── Calculate split ───────────────────────────────────────
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

  if(!meterResults.length){ alert('No meters with linked tenants. Check Settings.'); return; }
  state.lastResult={period,date,meterResults};
  document.getElementById('result-content').innerHTML=buildResultsHTML(period,meterResults);
  document.getElementById('result-section').style.display='block';
  setTimeout(()=>document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'}),100);
}

function initials(name){ return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

function buildMessage(split,period,meterName,bd){
  return (state.settings.msgTemplate||DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g,(_,k)=>{
    const map={name:split.name,meter:meterName,period,prev:split.prev.toFixed(2),curr:split.curr.toFixed(2),usage:split.usage.toFixed(2),rate:bd.rate.toFixed(2),total_energy_amt:bd.totalEnergy.toFixed(2),energy_amt:split.energyAmt.toFixed(2),fixed_total:bd.fixedAmt.toFixed(2),fixed_amt:split.fixedAmt.toFixed(2),common_amt:split.commonAmt.toFixed(2),tax_amt:split.taxAmt.toFixed(2),total:split.total.toFixed(2),num_splits:String(bd.numSplits)};
    return map[k]!==undefined?map[k]:'{'+k+'}';
  });
}

function buildResultsHTML(period,meterResults){
  return meterResults.map(mr=>{
    const {meterName,billData:bd,splits}=mr;
    let tTot=0;
    const rows=splits.map(s=>{ tTot+=s.total; return `<tr>
      <td class="cell-name">${s.name}</td>
      <td class="cell-amt">${s.usage.toFixed(2)}</td>
      <td class="cell-amt">₹${s.energyAmt.toFixed(2)}</td>
      <td class="cell-amt">₹${(s.fixedAmt+s.commonAmt).toFixed(2)}</td>
      <td class="cell-amt">₹${s.taxAmt.toFixed(2)}</td>
      <td class="cell-total">₹${s.total.toFixed(2)}</td>
    </tr>`; }).join('');

    const waButtons=splits.map(s=>{
      if(!s.phone) return `<div class="wa-no-num">${s.name} — no WhatsApp number saved</div>`;
      const url=`https://wa.me/${s.phone}?text=${encodeURIComponent(buildMessage(s,period,meterName,bd))}`;
      return `<a href="${url}" target="_blank" class="wa-row">
        <div class="wa-avatar">${initials(s.name)}</div>
        <div class="wa-info"><div class="wa-name">${s.name}</div><div class="wa-amount">₹${s.total.toFixed(2)} due</div></div>
        <span style="font-size:20px;color:var(--wa);">→</span>
      </a>`;
    }).join('');

    return `<div class="card card-result">
      <div class="meter-header">
        <span class="badge badge-green">✓ Result</span>
        <span class="meter-title">${meterName}</span>
      </div>
      <div class="metric-grid">
        <div class="metric"><div class="metric-label">Total bill</div><div class="metric-val">₹${bd.totalBill.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Main usage</div><div class="metric-val">${bd.mainUsage.toFixed(2)} <span style="font-size:13px;font-weight:600;">kWh</span></div></div>
        <div class="metric"><div class="metric-label">Rate per unit</div><div class="metric-val">₹${bd.rate.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Tenants</div><div class="metric-val">${splits.length}</div></div>
      </div>
      <div class="split-table-wrap">
        <table class="split-table">
          <thead><tr><th>Tenant</th><th>kWh</th><th>Energy</th><th>Fixed+Com</th><th>Tax</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Total</td><td colspan="4"></td><td>₹${tTot.toFixed(2)}</td></tr></tfoot>
        </table>
      </div>
      <div class="wa-section">
        <div class="wa-label">Send via WhatsApp</div>
        <div class="wa-btn-list">${waButtons}</div>
      </div>
    </div>`;
  }).join('');
}

async function saveToHistory(){
  if(!state.lastResult){ alert('Calculate first.'); return; }
  state.history.unshift({...state.lastResult,savedAt:new Date().toISOString()});
  await saveHistory();
  const btn=document.getElementById('save-btn');
  btn.innerHTML='<span>✓</span> Saved & synced!'; btn.disabled=true;
  setTimeout(()=>{ btn.innerHTML='<span>💾</span> Save to history'; btn.disabled=false; },2500);
}

// ── Auto-fill previous readings ───────────────────────────
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
    document.getElementById('autofill-text').textContent=`From "${last.period}" — just enter current readings`;
    document.getElementById('autofill-banner').style.display='flex';
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
      ['prev','curr'].forEach(f=>{ const el=document.getElementById(`m${mi}_t${ti}_${f}`); if(el) el.value=''; });
      const chip=document.getElementById(`m${mi}_t${ti}_usage`); if(chip) chip.textContent='— kWh';
    });
    const comp=document.getElementById(`m${mi}_computed`); if(comp) comp.textContent='₹0.00';
    const ul=document.getElementById(`m${mi}_usage_line`); if(ul) ul.style.display='none';
  });
  document.getElementById('result-section').style.display='none';
}

// ── Settings ──────────────────────────────────────────────
function renderSettings(){
  document.getElementById('set-cycle').value=state.settings.cycle;
  document.getElementById('set-msg-template').value=state.settings.msgTemplate||DEFAULT_TEMPLATE;
  document.getElementById('set-msg-template').oninput=updateMsgPreview;
  // Show User ID
  const uidEl=document.getElementById('user-id-display');
  if(uidEl) uidEl.textContent=state.userId;
  renderTenants(); renderMetersSettings(); updateMsgPreview();
}

function renderTenants(){
  document.getElementById('tenant-list').innerHTML=state.settings.tenants.map((t,i)=>`
    <div class="tenant-card">
      <div class="tenant-card-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="tenant-num">${i+1}</div>
          <span style="font-size:14px;font-weight:700;">${t.name}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeTenant('${t.id}')">Remove</button>
      </div>
      <div class="form-row-2">
        <div class="form-group" style="margin-bottom:0;"><label>Name</label><input type="text" class="t-name" data-id="${t.id}" value="${t.name}"/></div>
        <div class="form-group" style="margin-bottom:0;"><label>WhatsApp number</label><input type="tel" class="t-phone" data-id="${t.id}" inputmode="numeric" placeholder="919876543210" value="${t.phone||''}"/></div>
      </div>
    </div>`).join('');
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

function syncMeterNamesFromDOM(){
  document.querySelectorAll('.m-name').forEach(el=>{
    const m=state.settings.mainMeters.find(x=>x.id===el.dataset.id);
    if(m&&el.value.trim()) m.name=el.value.trim();
  });
}

function renderMetersSettings(){
  document.getElementById('meter-list').innerHTML=state.settings.mainMeters.map((m,mi)=>{
    const chips=state.settings.tenants.map(t=>`
      <span class="tenant-chip ${m.tenantIds.includes(t.id)?'selected':''}" onclick="toggleTenant('${m.id}','${t.id}')">${t.name}</span>`).join('');
    return `<div class="card card-meter" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span class="badge badge-blue">Meter ${mi+1}</span>
        <button class="btn btn-danger btn-sm" onclick="removeMeter('${m.id}')">Remove</button>
      </div>
      <div class="form-group"><label>Meter name</label><input type="text" class="m-name" data-id="${m.id}" value="${m.name}"/></div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px;">Linked tenants</label>
        <div class="chip-wrap">${chips||'<span style="font-size:13px;color:var(--text3);">Add tenants above first</span>'}</div>
      </div>
    </div>`;
  }).join('');
}

function addMeter(){
  syncMeterNamesFromDOM();
  state.settings.mainMeters.push({id:uid(),name:'Meter '+(state.settings.mainMeters.length+1),tenantIds:[]});
  renderMetersSettings();
}

function removeMeter(id){
  if(state.settings.mainMeters.length<=1){ alert('At least one meter required.'); return; }
  syncMeterNamesFromDOM();
  state.settings.mainMeters=state.settings.mainMeters.filter(m=>m.id!==id);
  renderMetersSettings();
}

function toggleTenant(meterId,tenantId){
  syncMeterNamesFromDOM();
  const m=state.settings.mainMeters.find(x=>x.id===meterId); if(!m) return;
  if(m.tenantIds.includes(tenantId)) m.tenantIds=m.tenantIds.filter(x=>x!==tenantId);
  else m.tenantIds.push(tenantId);
  renderMetersSettings();
}

async function applySettings(){
  state.settings.cycle=document.getElementById('set-cycle').value;
  state.settings.msgTemplate=document.getElementById('set-msg-template').value||DEFAULT_TEMPLATE;
  document.querySelectorAll('.t-name').forEach(el=>{ const t=state.settings.tenants.find(x=>x.id===el.dataset.id); if(t) t.name=el.value.trim()||t.name; });
  document.querySelectorAll('.t-phone').forEach(el=>{ const t=state.settings.tenants.find(x=>x.id===el.dataset.id); if(t) t.phone=el.value.trim(); });
  document.querySelectorAll('.m-name').forEach(el=>{ const m=state.settings.mainMeters.find(x=>x.id===el.dataset.id); if(m) m.name=el.value.trim()||m.name; });
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  await saveSettings();
  renderCalcSections();
  alert('✓ Settings saved & synced!');
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

// ── History ───────────────────────────────────────────────
function renderHistory(){
  const el=document.getElementById('history-list');
  document.getElementById('history-detail').style.display='none';
  if(!state.history.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No records yet</div><div class="empty-sub">Calculate and save a bill to see it here</div></div>`;
    return;
  }
  el.innerHTML=state.history.map((rec,idx)=>{
    const d=rec.savedAt?new Date(rec.savedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    const totalBill=(rec.meterResults||[]).reduce((s,mr)=>s+parseFloat(mr.billData.totalBill||0),0);
    const meters=(rec.meterResults||[]).length;
    return `<div class="history-item">
      <div class="history-icon">⚡</div>
      <div class="history-info">
        <div class="history-period">${rec.period}${idx===0?' <span class="badge badge-green" style="margin-left:4px;">latest</span>':''}</div>
        <div class="history-meta">${meters} meter${meters!==1?'s':''} · ₹${totalBill.toFixed(2)} · ${d}</div>
      </div>
      <div class="history-actions">
        <button class="btn btn-sm" onclick="viewRecord(${idx})">View</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecord(${idx})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function viewRecord(idx){
  const rec=state.history[idx];
  const det=document.getElementById('history-detail');
  det.innerHTML=`<div style="margin-bottom:6px;font-size:17px;font-weight:800;">${rec.period}</div>${buildResultsHTML(rec.period,rec.meterResults||[])}`;
  det.style.display='block';
  det.scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteRecord(idx){
  if(!confirm('Delete this record?')) return;
  state.history.splice(idx,1); await saveHistory(); renderHistory();
  document.getElementById('history-detail').style.display='none';
}

async function clearHistory(){
  if(!confirm('Clear all history? This cannot be undone.')) return;
  state.history=[]; await saveHistory(); renderHistory();
}

// ── Excel export ──────────────────────────────────────────
function exportExcel(){
  if(!state.history.length){ alert('No history to export yet.'); return; }
  if(typeof XLSX==='undefined'){ alert('Excel library loading, try again.'); return; }
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
  const detData=[['Detailed Splits'],[], ['Period','Meter','Tenant','Prev','Curr','kWh','Energy','Fixed','Common','Tax','Total']];
  state.history.forEach(rec=>{
    (rec.meterResults||[]).forEach(mr=>{
      mr.splits.forEach(s=>detData.push([rec.period,mr.meterName,s.name,parseFloat(s.prev||0),parseFloat(s.curr||0),parseFloat(s.usage||0),parseFloat(s.energyAmt||0),parseFloat(s.fixedAmt||0),parseFloat(s.commonAmt||0),parseFloat(s.taxAmt||0),parseFloat(s.total||0)]));
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
      const d=[['Period: '+rec.period,'Meter: '+mr.meterName],[],['Main Prev',parseFloat(bd.mainPrev||0),'Rate',parseFloat(bd.rate||0)],['Main Curr',parseFloat(bd.mainCurr||0),'Energy (₹)',parseFloat(bd.totalEnergy||0)],['Usage (kWh)',parseFloat(bd.mainUsage||0),'Fixed (₹)',parseFloat(bd.fixedAmt||0)],['','','Common (₹)',parseFloat(bd.commonAmt||0)],['','','Tax (₹)',parseFloat(bd.taxAmt||0)],['','','Total (₹)',parseFloat(bd.totalBill||0)],[],['Tenant','Prev','Curr','kWh','Energy','Fixed','Common','Tax','Total']];
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

// ── Init ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async ()=>{
  // Get/create user ID
  state.userId = getOrCreateUserId();

  // Init Firebase
  const firebaseOk = initFirebase();

  // Load state (cloud if available, local otherwise)
  await cloudLoadState();

  // Boot UI
  document.getElementById('reading-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  renderCalcSections();
  setTimeout(applyAutofill,100);

  // Show connection status
  const statusEl = document.getElementById('sync-status');
  if(statusEl){
    statusEl.textContent = firebaseOk ? '☁️ Cloud sync on' : '📱 Offline mode';
    statusEl.style.color = firebaseOk ? 'var(--green-txt)' : 'var(--text3)';
  }

  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
});
