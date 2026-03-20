// ── Firebase config ───────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

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

// ── State ─────────────────────────────────────────────────
let state = {
  userId: null, db: null, syncing: false,
  // Buildings: [{id, name, address, floors, description}]
  buildings: [],
  // Tenants: [{id, buildingId, name, unit, phone, email, idType, idNumber,
  //            occupiedDate, agreementStart, agreementEnd, deposit, rent, status, notes}]
  tenants: [],
  settings: {
    cycle: 'monthly',
    msgTemplate: DEFAULT_TEMPLATE,
    mainMeters: [{ id: 'm1', name: 'EB Main Meter', tenantIds: [] }]
  },
  history: [],
  lastResult: null,
  activeTab: 'dashboard'
};

const AVATAR_COLORS = ['#1E6FFF','#12B76A','#7C3AED','#0D9488','#F59E0B','#EF4444'];
function uid(){ return 'id'+Date.now()+Math.random().toString(36).slice(2,6); }
function avatarColor(name){ let h=0; for(let c of name) h=(h*31+c.charCodeAt(0))%AVATAR_COLORS.length; return AVATAR_COLORS[h]; }
function initials(name){ return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

// ── Firebase ──────────────────────────────────────────────
function initFirebase(){
  try{ firebase.initializeApp(FIREBASE_CONFIG); state.db=firebase.firestore(); return true; }
  catch(e){ return false; }
}
function userDoc(){ return state.db.collection('users').doc('user_'+state.userId); }

async function cloudSave(key, data){
  localSet(key, data);
  if(!state.db) return;
  setSyncIndicator(true);
  try{ await userDoc().set({[key]: data, updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); }
  catch(e){ console.warn('Cloud save failed',e); }
  finally{ setSyncIndicator(false); }
}

async function cloudLoad(){
  localLoad();
  if(!state.db) return;
  setSyncIndicator(true);
  try{
    const doc = await userDoc().get();
    if(doc.exists){
      const d = doc.data();
      if(d.buildings) state.buildings = d.buildings;
      if(d.tenants)   state.tenants   = d.tenants;
      if(d.settings)  state.settings  = {...state.settings,...d.settings};
      if(d.history)   state.history   = d.history;
      localSet('buildings', state.buildings);
      localSet('tenants',   state.tenants);
      localSet('settings',  state.settings);
      localSet('history',   state.history);
    }
  } catch(e){ console.warn('Cloud load failed',e); }
  finally{ setSyncIndicator(false); }
}

function localSet(k,v){ localStorage.setItem('eb_'+k, JSON.stringify(v)); }
function localGet(k,def){ try{ const v=localStorage.getItem('eb_'+k); return v?JSON.parse(v):def; }catch(e){return def;} }
function localLoad(){
  state.buildings = localGet('buildings',[]);
  state.tenants   = localGet('tenants',[]);
  state.settings  = {...state.settings,...localGet('settings',{})};
  state.history   = localGet('history',[]);
}

const saveBuildings = ()=> cloudSave('buildings', state.buildings);
const saveTenants   = ()=> cloudSave('tenants',   state.tenants);
const saveSettings  = ()=> cloudSave('settings',  state.settings);
const saveHistory   = ()=> cloudSave('history',   state.history);

function setSyncIndicator(on){
  state.syncing=on;
  const el=document.getElementById('sync-indicator'); if(el) el.style.display=on?'flex':'none';
}

function getOrCreateUserId(){
  let id=localStorage.getItem('eb_user_id');
  if(!id){ id='usr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('eb_user_id',id); }
  return id;
}

// ── Tab navigation ────────────────────────────────────────
function switchTab(tab){
  state.activeTab=tab;
  document.querySelectorAll('.tab-item').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='panel-'+tab));
  const renders={dashboard:renderDashboard, buildings:renderBuildings, tenants:renderTenantList, calculate:()=>{renderCalcSections();setTimeout(applyAutofill,80);}, history:renderHistory, settings:renderSettingsPanel};
  if(renders[tab]) renders[tab]();
  document.querySelector('.scroll-body').scrollTop=0;
}

// ── DASHBOARD ─────────────────────────────────────────────
function renderDashboard(){
  const activeT   = state.tenants.filter(t=>t.status==='active');
  const vacantU   = countVacantUnits();
  const expiring  = getExpiringTenants(30);
  const expired   = state.tenants.filter(t=>isExpired(t.agreementEnd));
  const totalBill = state.history[0] ? (state.history[0].meterResults||[]).reduce((s,mr)=>s+parseFloat(mr.billData.totalBill||0),0) : 0;

  document.getElementById('dashboard-content').innerHTML=`
    <div class="dash-grid">
      <div class="dash-stat">
        <div class="dash-stat-icon">🏢</div>
        <div class="dash-stat-val">${state.buildings.length}</div>
        <div class="dash-stat-label">Buildings</div>
        <div class="dash-stat-sub">${totalUnits()} total units</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-icon">👥</div>
        <div class="dash-stat-val">${activeT.length}</div>
        <div class="dash-stat-label">Active tenants</div>
        <div class="dash-stat-sub">${vacantU} vacant unit${vacantU!==1?'s':''}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-icon">⚡</div>
        <div class="dash-stat-val">${state.history.length}</div>
        <div class="dash-stat-label">Bills generated</div>
        <div class="dash-stat-sub">${state.history.length?'Last: '+state.history[0].period:'No records yet'}</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-icon">💰</div>
        <div class="dash-stat-val">₹${totalBill>0?totalBill.toFixed(0):'—'}</div>
        <div class="dash-stat-label">Last bill total</div>
        <div class="dash-stat-sub">${state.history.length?state.history[0].period:'No bills yet'}</div>
      </div>
    </div>

    ${expiring.length||expired.length ? `
    <div class="card">
      <div class="section-label">⚠️ Agreement alerts</div>
      ${expired.map(t=>`
        <div class="expiry-item">
          <div class="expiry-dot expiry-dot-red"></div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:13px;">${t.name}</div>
            <div style="font-size:12px;color:var(--text3);">${getBuildingName(t.buildingId)} · ${t.unit||'—'}</div>
          </div>
          <span class="badge badge-red">Expired</span>
        </div>`).join('')}
      ${expiring.map(t=>`
        <div class="expiry-item">
          <div class="expiry-dot expiry-dot-amber"></div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:13px;">${t.name}</div>
            <div style="font-size:12px;color:var(--text3);">${getBuildingName(t.buildingId)} · ${t.unit||'—'} · Expires ${fmtDate(t.agreementEnd)}</div>
          </div>
          <span class="badge badge-amber">Expiring</span>
        </div>`).join('')}
    </div>` : ''}

    ${state.buildings.length===0 ? `
    <div class="empty">
      <div class="empty-icon">🏢</div>
      <div class="empty-title">No buildings yet</div>
      <div class="empty-sub">Add a building to get started</div>
      <button class="btn btn-primary" style="margin-top:14px;" onclick="switchTab('buildings')">Add building</button>
    </div>` : `
    <div class="card">
      <div class="section-label">Quick actions</div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="switchTab('calculate')">⚡ New bill</button>
        <button class="btn btn-ghost" onclick="openAddTenantModal()">👤 Add tenant</button>
        <button class="btn btn-ghost" onclick="switchTab('buildings')">🏢 Manage buildings</button>
      </div>
    </div>`}
  `;
}

function totalUnits(){ return state.buildings.reduce((s,b)=>s+(parseInt(b.units)||0),0); }
function countVacantUnits(){
  const occupied = new Set(state.tenants.filter(t=>t.status==='active').map(t=>t.buildingId+'_'+t.unit));
  return Math.max(0, totalUnits() - occupied.size);
}
function getBuildingName(id){ const b=state.buildings.find(x=>x.id===id); return b?b.name:'—'; }
function isExpired(dateStr){ if(!dateStr) return false; return new Date(dateStr) < new Date(); }
function daysUntil(dateStr){ if(!dateStr) return null; return Math.ceil((new Date(dateStr)-new Date())/(1000*60*60*24)); }
function getExpiringTenants(days){ return state.tenants.filter(t=>{ const d=daysUntil(t.agreementEnd); return d!==null && d>=0 && d<=days && t.status==='active'; }); }
function fmtDate(d){ if(!d) return '—'; try{ return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }catch(e){return d;} }
function agreementStatus(t){
  if(!t.agreementEnd) return {label:'No end date',cls:'badge-blue'};
  if(isExpired(t.agreementEnd)) return {label:'Expired',cls:'badge-red'};
  const d=daysUntil(t.agreementEnd);
  if(d<=30) return {label:`Expires in ${d}d`,cls:'badge-amber'};
  return {label:'Active',cls:'badge-green'};
}

// ── BUILDINGS ─────────────────────────────────────────────
function renderBuildings(){
  const el=document.getElementById('buildings-content');
  if(!state.buildings.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">🏢</div><div class="empty-title">No buildings yet</div><div class="empty-sub">Add your first building to get started</div></div>`;
    return;
  }
  el.innerHTML=state.buildings.map(b=>{
    const bTenants=state.tenants.filter(t=>t.buildingId===b.id&&t.status==='active');
    return `<div class="building-card">
      <div class="building-header">
        <div class="building-icon">🏢</div>
        <div class="building-info">
          <div class="building-name">${b.name}</div>
          <div class="building-address">${b.address||'No address'}</div>
        </div>
      </div>
      <div class="building-stats">
        <div class="building-stat"><div class="building-stat-val">${parseInt(b.units)||0}</div><div class="building-stat-label">Units</div></div>
        <div class="building-stat"><div class="building-stat-val">${bTenants.length}</div><div class="building-stat-label">Tenants</div></div>
        <div class="building-stat"><div class="building-stat-val">${b.floors||'—'}</div><div class="building-stat-label">Floors</div></div>
      </div>
      ${b.description?`<div style="padding:10px 14px;font-size:13px;color:var(--text2);border-top:1px solid var(--border);">${b.description}</div>`:''}
      <div class="building-actions">
        <button class="btn btn-sm btn-primary" onclick="openBuildingTenants('${b.id}')">👥 View tenants</button>
        <button class="btn btn-sm btn-ghost" onclick="openEditBuilding('${b.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBuilding('${b.id}')">Remove</button>
      </div>
    </div>`;
  }).join('');
}

function openAddBuildingModal(editId){
  const b = editId ? state.buildings.find(x=>x.id===editId) : null;
  showModal('building-modal',`${b?'Edit':'Add'} building`,`
    <div class="form-group"><label>Building name *</label><input type="text" id="bld-name" placeholder="e.g. Sunrise Apartments" value="${b?b.name:''}"/></div>
    <div class="form-group"><label>Address</label><input type="text" id="bld-addr" placeholder="Street, City" value="${b?b.address||'':''}"/></div>
    <div class="form-row-2">
      <div class="form-group"><label>Number of units</label><input type="number" id="bld-units" placeholder="0" min="0" value="${b?b.units||'':''}"/></div>
      <div class="form-group"><label>Number of floors</label><input type="number" id="bld-floors" placeholder="0" min="0" value="${b?b.floors||'':''}"/></div>
    </div>
    <div class="form-group"><label>Description / notes</label><textarea id="bld-desc" rows="3" placeholder="Optional notes about the building">${b?b.desc||'':''}</textarea></div>
  `,[
    {label:'Cancel', cls:'btn-ghost', action: closeModal},
    {label: b?'Save changes':'Add building', cls:'btn-primary', action: ()=>saveBuilding(editId)}
  ]);
}

async function saveBuilding(editId){
  const name=document.getElementById('bld-name').value.trim();
  if(!name){alert('Building name is required.');return;}
  const data={name, address:document.getElementById('bld-addr').value.trim(), units:document.getElementById('bld-units').value||0, floors:document.getElementById('bld-floors').value||0, desc:document.getElementById('bld-desc').value.trim()};
  if(editId){ const i=state.buildings.findIndex(x=>x.id===editId); if(i>=0) state.buildings[i]={...state.buildings[i],...data}; }
  else { state.buildings.push({id:uid(),...data}); }
  await saveBuildings(); closeModal(); renderBuildings();
}

async function deleteBuilding(id){
  const bTenants=state.tenants.filter(t=>t.buildingId===id);
  if(bTenants.length&&!confirm(`This building has ${bTenants.length} tenant(s). Delete anyway?`)) return;
  if(!confirm('Delete this building?')) return;
  state.buildings=state.buildings.filter(x=>x.id!==id);
  await saveBuildings(); renderBuildings();
}

function openEditBuilding(id){ openAddBuildingModal(id); }

function openBuildingTenants(buildingId){
  const b=state.buildings.find(x=>x.id===buildingId);
  const bTenants=state.tenants.filter(t=>t.buildingId===buildingId);
  showModal('building-tenants-modal',`${b.name} — Tenants`,
    bTenants.length ? bTenants.map(t=>buildTenantCard(t,true)).join('') :
    `<div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No tenants</div><div class="empty-sub">Add tenants to this building</div></div>`,
    [{label:'Close',cls:'btn-ghost',action:closeModal},{label:'+ Add tenant',cls:'btn-primary',action:()=>{closeModal();openAddTenantModal(buildingId);}}]
  );
}

// ── TENANTS ───────────────────────────────────────────────
function renderTenantList(){
  const el=document.getElementById('tenants-content');
  // Group by building
  if(!state.tenants.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No tenants yet</div><div class="empty-sub">Add tenants from the Buildings tab or button below</div></div>`;
    return;
  }
  // Filter controls
  const filter=document.getElementById('tenant-filter')?.value||'all';
  let list=state.tenants;
  if(filter==='active') list=list.filter(t=>t.status==='active');
  if(filter==='inactive') list=list.filter(t=>t.status!=='active');
  if(filter==='expiring') list=getExpiringTenants(30);
  el.innerHTML=list.map(t=>buildTenantCard(t,false)).join('')||'<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No tenants match filter</div></div>';
}

function buildTenantCard(t, compact){
  const status=agreementStatus(t);
  const color=avatarColor(t.name);
  return `<div class="tenant-card-full">
    <div class="tenant-card-header">
      <div class="tenant-avatar" style="background:${color};">${initials(t.name)}</div>
      <div class="tenant-info">
        <div class="tenant-name">${t.name}</div>
        <div class="tenant-unit">${getBuildingName(t.buildingId)}${t.unit?' · '+t.unit:''}</div>
      </div>
      <span class="badge ${status.cls}">${status.label}</span>
    </div>
    ${!compact?`<div class="tenant-body">
      ${t.phone?`<div class="tenant-detail-row"><div class="tenant-detail-icon">📞</div><div class="tenant-detail-label">Phone</div><div class="tenant-detail-val"><a href="tel:${t.phone}" style="color:var(--accent-txt);text-decoration:none;">${t.phone}</a></div></div>`:''}
      ${t.email?`<div class="tenant-detail-row"><div class="tenant-detail-icon">✉️</div><div class="tenant-detail-label">Email</div><div class="tenant-detail-val">${t.email}</div></div>`:''}
      ${t.idType?`<div class="tenant-detail-row"><div class="tenant-detail-icon">🪪</div><div class="tenant-detail-label">ID</div><div class="tenant-detail-val">${t.idType}${t.idNumber?' · '+t.idNumber:''}</div></div>`:''}
      <div class="tenant-detail-row"><div class="tenant-detail-icon">📅</div><div class="tenant-detail-label">Move-in</div><div class="tenant-detail-val">${fmtDate(t.occupiedDate)}</div></div>
      <div class="tenant-detail-row"><div class="tenant-detail-icon">📋</div><div class="tenant-detail-label">Agreement</div><div class="tenant-detail-val">${fmtDate(t.agreementStart)} → ${fmtDate(t.agreementEnd)}</div></div>
      ${t.rent?`<div class="tenant-detail-row"><div class="tenant-detail-icon">💰</div><div class="tenant-detail-label">Monthly rent</div><div class="tenant-detail-val">₹${t.rent}</div></div>`:''}
      ${t.deposit?`<div class="tenant-detail-row"><div class="tenant-detail-icon">🔒</div><div class="tenant-detail-label">Deposit</div><div class="tenant-detail-val">₹${t.deposit}</div></div>`:''}
      ${t.notes?`<div class="tenant-detail-row"><div class="tenant-detail-icon">📝</div><div class="tenant-detail-label">Notes</div><div class="tenant-detail-val">${t.notes}</div></div>`:''}
    </div>`:''}
    <div class="tenant-actions">
      ${t.phone?`<a href="https://wa.me/${t.phone}" target="_blank" class="btn btn-sm btn-wa">💬 WhatsApp</a>`:''}
      <button class="btn btn-sm btn-ghost" onclick="openEditTenantModal('${t.id}')">Edit</button>
      <button class="btn btn-sm btn-danger" onclick="deleteTenant('${t.id}')">Remove</button>
    </div>
  </div>`;
}

function openAddTenantModal(presetBuildingId){
  const buildingOptions=state.buildings.map(b=>`<option value="${b.id}"${presetBuildingId===b.id?' selected':''}>${b.name}</option>`).join('');
  if(!state.buildings.length){alert('Add a building first before adding tenants.');switchTab('buildings');return;}
  showModal('tenant-modal','Add tenant',`
    <div class="form-group"><label>Full name *</label><input type="text" id="tn-name" placeholder="Tenant full name"/></div>
    <div class="form-row-2">
      <div class="form-group"><label>Building *</label><select id="tn-building"><option value="">Select building</option>${buildingOptions}</select></div>
      <div class="form-group"><label>Unit / floor</label><input type="text" id="tn-unit" placeholder="e.g. 1st Floor, A1"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Phone (WhatsApp)</label><input type="tel" id="tn-phone" inputmode="numeric" placeholder="919876543210"/></div>
      <div class="form-group"><label>Email</label><input type="email" id="tn-email" placeholder="email@example.com" inputmode="email"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>ID type</label><select id="tn-idtype"><option value="">Select</option><option>Aadhaar</option><option>PAN</option><option>Passport</option><option>Voter ID</option><option>Driving Licence</option><option>Other</option></select></div>
      <div class="form-group"><label>ID number</label><input type="text" id="tn-idnum" placeholder="ID number"/></div>
    </div>
    <div style="height:1px;background:var(--border);margin:4px 0 12px;"></div>
    <div class="form-row-2">
      <div class="form-group"><label>Move-in / occupied date</label><input type="date" id="tn-occupied"/></div>
      <div class="form-group"><label>Agreement start date</label><input type="date" id="tn-agr-start"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Agreement end date</label><input type="date" id="tn-agr-end"/></div>
      <div class="form-group"><label>Status</label><select id="tn-status"><option value="active">Active</option><option value="inactive">Inactive / vacated</option></select></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Monthly rent (₹)</label><input type="number" id="tn-rent" inputmode="decimal" placeholder="0"/></div>
      <div class="form-group"><label>Security deposit (₹)</label><input type="number" id="tn-deposit" inputmode="decimal" placeholder="0"/></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="tn-notes" rows="2" placeholder="Any additional notes"></textarea></div>
  `,[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Add tenant',cls:'btn-primary',action:()=>saveTenantFromModal(null)}
  ]);
}

function openEditTenantModal(id){
  const t=state.tenants.find(x=>x.id===id); if(!t) return;
  const buildingOptions=state.buildings.map(b=>`<option value="${b.id}"${t.buildingId===b.id?' selected':''}>${b.name}</option>`).join('');
  showModal('tenant-edit-modal','Edit tenant',`
    <div class="form-group"><label>Full name *</label><input type="text" id="tn-name" value="${t.name||''}"/></div>
    <div class="form-row-2">
      <div class="form-group"><label>Building *</label><select id="tn-building"><option value="">Select</option>${buildingOptions}</select></div>
      <div class="form-group"><label>Unit / floor</label><input type="text" id="tn-unit" value="${t.unit||''}"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Phone (WhatsApp)</label><input type="tel" id="tn-phone" inputmode="numeric" value="${t.phone||''}"/></div>
      <div class="form-group"><label>Email</label><input type="email" id="tn-email" value="${t.email||''}"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>ID type</label><select id="tn-idtype"><option value="">Select</option><option${t.idType==='Aadhaar'?' selected':''}>Aadhaar</option><option${t.idType==='PAN'?' selected':''}>PAN</option><option${t.idType==='Passport'?' selected':''}>Passport</option><option${t.idType==='Voter ID'?' selected':''}>Voter ID</option><option${t.idType==='Driving Licence'?' selected':''}>Driving Licence</option><option${t.idType==='Other'?' selected':''}>Other</option></select></div>
      <div class="form-group"><label>ID number</label><input type="text" id="tn-idnum" value="${t.idNumber||''}"/></div>
    </div>
    <div style="height:1px;background:var(--border);margin:4px 0 12px;"></div>
    <div class="form-row-2">
      <div class="form-group"><label>Move-in date</label><input type="date" id="tn-occupied" value="${t.occupiedDate||''}"/></div>
      <div class="form-group"><label>Agreement start</label><input type="date" id="tn-agr-start" value="${t.agreementStart||''}"/></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Agreement end</label><input type="date" id="tn-agr-end" value="${t.agreementEnd||''}"/></div>
      <div class="form-group"><label>Status</label><select id="tn-status"><option value="active"${t.status==='active'?' selected':''}>Active</option><option value="inactive"${t.status==='inactive'?' selected':''}>Inactive / vacated</option></select></div>
    </div>
    <div class="form-row-2">
      <div class="form-group"><label>Monthly rent (₹)</label><input type="number" id="tn-rent" value="${t.rent||''}"/></div>
      <div class="form-group"><label>Security deposit (₹)</label><input type="number" id="tn-deposit" value="${t.deposit||''}"/></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="tn-notes" rows="2">${t.notes||''}</textarea></div>
  `,[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Save changes',cls:'btn-primary',action:()=>saveTenantFromModal(id)}
  ]);
}

async function saveTenantFromModal(editId){
  const name=document.getElementById('tn-name').value.trim();
  const buildingId=document.getElementById('tn-building').value;
  if(!name){alert('Tenant name is required.');return;}
  if(!buildingId){alert('Please select a building.');return;}
  const data={
    name, buildingId,
    unit:document.getElementById('tn-unit').value.trim(),
    phone:document.getElementById('tn-phone').value.trim(),
    email:document.getElementById('tn-email').value.trim(),
    idType:document.getElementById('tn-idtype').value,
    idNumber:document.getElementById('tn-idnum').value.trim(),
    occupiedDate:document.getElementById('tn-occupied').value,
    agreementStart:document.getElementById('tn-agr-start').value,
    agreementEnd:document.getElementById('tn-agr-end').value,
    status:document.getElementById('tn-status').value,
    rent:document.getElementById('tn-rent').value,
    deposit:document.getElementById('tn-deposit').value,
    notes:document.getElementById('tn-notes').value.trim()
  };
  if(editId){ const i=state.tenants.findIndex(x=>x.id===editId); if(i>=0) state.tenants[i]={...state.tenants[i],...data}; }
  else { state.tenants.push({id:uid(),...data}); }
  await saveTenants(); closeModal();
  if(state.activeTab==='tenants') renderTenantList();
  if(state.activeTab==='dashboard') renderDashboard();
  // Keep billing settings in sync
  syncTenantsToSettings();
}

async function deleteTenant(id){
  if(!confirm('Remove this tenant?')) return;
  state.tenants=state.tenants.filter(x=>x.id!==id);
  // Remove from meter links too
  state.settings.mainMeters.forEach(m=>{m.tenantIds=m.tenantIds.filter(tid=>tid!==id);});
  await saveTenants(); await saveSettings();
  if(state.activeTab==='tenants') renderTenantList();
  if(state.activeTab==='dashboard') renderDashboard();
}

// Keep billing tenants in sync with tenant master list
function syncTenantsToSettings(){
  // Auto-link active tenants to first meter if no meters configured yet
  const activeIds=state.tenants.filter(t=>t.status==='active').map(t=>t.id);
  state.settings.mainMeters.forEach(m=>{
    m.tenantIds=m.tenantIds.filter(id=>activeIds.includes(id));
  });
}

// ── CALCULATE ─────────────────────────────────────────────
function renderCalcSections(){
  const activeTenants=state.tenants.filter(t=>t.status==='active');
  let html='';
  state.settings.mainMeters.forEach((m,mi)=>{
    const linked=activeTenants.filter(t=>m.tenantIds.includes(t.id));
    const n=linked.length;
    const subRows=n>0?linked.map((t,ti)=>`
      <div class="submeter-item">
        <div class="submeter-name"><div class="submeter-dot"></div>${t.name}<span style="font-size:11px;color:var(--text3);margin-left:4px;">${t.unit?'· '+t.unit:''}</span></div>
        <div class="submeter-fields">
          <div class="form-group" style="margin-bottom:0;"><label>Previous (kWh)</label><input type="number" id="m${mi}_t${ti}_prev" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})"/></div>
          <div class="form-group" style="margin-bottom:0;"><label>Current (kWh)</label><input type="number" id="m${mi}_t${ti}_curr" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="updateSubUsage(${mi})"/></div>
          <div class="form-group" style="margin-bottom:0;"><label>Usage</label><div class="usage-chip" id="m${mi}_t${ti}_usage">— kWh</div></div>
        </div>
      </div>`).join(''):`<div class="info-box">No tenants linked. Go to Settings → Meters to link tenants.</div>`;

    html+=`<div class="card card-accent-blue">
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
        <div class="usage-stat"><span class="usage-stat-label">Auto energy</span><span class="usage-stat-val" id="m${mi}_auto_energy">₹—</span></div>
      </div>
      <div class="form-row-2">
        <div class="form-group"><label>Energy charge (₹)</label><input type="number" id="m${mi}_energy" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Fixed charge (₹)</label><input type="number" id="m${mi}_fixed" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Common area (₹)</label><input type="number" id="m${mi}_common" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
        <div class="form-group"><label>Tax (₹) <span style="color:var(--text3);font-size:11px;font-weight:400;">by usage</span></label><input type="number" id="m${mi}_tax" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
      </div>
      <div class="total-bar"><span class="total-label">Computed total</span><span class="total-val" id="m${mi}_computed">₹0.00</span></div>
      <div class="form-group"><label>Confirm total bill (₹)</label><input type="number" id="m${mi}_confirm" inputmode="decimal" placeholder="0.00" min="0" step="0.01" oninput="syncMeter(${mi})"/></div>
      <div class="alert" id="m${mi}_warn" style="display:none;margin-top:8px;">⚠️ Charges don't match confirmed total.</div>
      <div class="submeter-block"><div class="submeter-block-label">Sub-meter readings</div>${subRows}<div class="alert" id="m${mi}_sub_warn" style="display:none;margin-top:8px;"></div></div>
    </div>`;
  });
  document.getElementById('calc-meters').innerHTML=html||'<div class="info-box">Configure meters in Settings first.</div>';
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
    if(rate>0){const el=document.getElementById(`m${mi}_energy`);if(el&&!parseFloat(el.value))el.value=(rate*usage).toFixed(2);}
  } else {line.style.display='none';}
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
  const linked=state.tenants.filter(t=>t.status==='active'&&m.tenantIds.includes(t.id));
  const mainP=parseFloat(document.getElementById(`m${mi}_prev`)?.value)||0;
  const mainC=parseFloat(document.getElementById(`m${mi}_curr`)?.value)||0;
  const mainUsage=Math.max(0,mainC-mainP);
  let subTotal=0;
  linked.forEach((_,ti)=>{
    const p=parseFloat(document.getElementById(`m${mi}_t${ti}_prev`)?.value)||0;
    const c=parseFloat(document.getElementById(`m${mi}_t${ti}_curr`)?.value)||0;
    const u=Math.max(0,c-p);
    const chip=document.getElementById(`m${mi}_t${ti}_usage`); if(chip) chip.textContent=u.toFixed(2)+' kWh';
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

function calculateAll(){
  const period=document.getElementById('period-label').value||'Unnamed';
  const date=document.getElementById('reading-date').value;
  const meterResults=[];
  state.settings.mainMeters.forEach((m,mi)=>{
    const linked=state.tenants.filter(t=>t.status==='active'&&m.tenantIds.includes(t.id));
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
      splits.push({tenantId:t.id,name:t.name,phone:t.phone||'',unit:t.unit||'',prev:subPrevs[ti],curr:subCurrs[ti],usage:usages[ti],energyAmt:myE,fixedAmt:perFixed,commonAmt:perCommon,taxAmt:myT,total:myE+perFixed+perCommon+myT});
    });
    meterResults.push({meterId:m.id,meterName:m.name,billData,splits});
  });
  if(!meterResults.length){alert('No meters with linked active tenants. Check Settings.');return;}
  state.lastResult={period,date,meterResults};
  document.getElementById('result-content').innerHTML=buildResultsHTML(period,meterResults);
  document.getElementById('result-section').style.display='block';
  setTimeout(()=>document.getElementById('result-section').scrollIntoView({behavior:'smooth',block:'start'}),100);
}

function buildMessage(split,period,meterName,bd){
  return (state.settings.msgTemplate||DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g,(_,k)=>{
    const map={name:split.name,meter:meterName,period,prev:split.prev.toFixed(2),curr:split.curr.toFixed(2),usage:split.usage.toFixed(2),rate:bd.rate.toFixed(2),total_energy_amt:bd.totalEnergy.toFixed(2),energy_amt:split.energyAmt.toFixed(2),fixed_total:bd.fixedAmt.toFixed(2),fixed_amt:split.fixedAmt.toFixed(2),common_amt:split.commonAmt.toFixed(2),tax_amt:split.taxAmt.toFixed(2),total:split.total.toFixed(2),num_splits:String(bd.numSplits)};
    return map[k]!==undefined?map[k]:'{'+k+'}';
  });
}

function buildResultsHTML(period,meterResults){
  return meterResults.map(mr=>{
    const {meterName,billData:bd,splits}=mr; let tTot=0;
    const rows=splits.map(s=>{tTot+=s.total;return `<tr><td class="cell-name">${s.name}${s.unit?`<div style="font-size:11px;color:var(--text3);">${s.unit}</div>`:''}</td><td class="cell-amt">${s.usage.toFixed(2)}</td><td class="cell-amt">₹${s.energyAmt.toFixed(2)}</td><td class="cell-amt">₹${(s.fixedAmt+s.commonAmt).toFixed(2)}</td><td class="cell-amt">₹${s.taxAmt.toFixed(2)}</td><td class="cell-total">₹${s.total.toFixed(2)}</td></tr>`;}).join('');
    const waButtons=splits.map(s=>{
      if(!s.phone) return `<div class="wa-no-num">${s.name} — no WhatsApp number</div>`;
      const url=`https://wa.me/${s.phone}?text=${encodeURIComponent(buildMessage(s,period,meterName,bd))}`;
      return `<a href="${url}" target="_blank" class="wa-row"><div class="wa-avatar" style="background:${avatarColor(s.name)};">${initials(s.name)}</div><div class="wa-info"><div class="wa-name">${s.name}</div><div class="wa-amount">₹${s.total.toFixed(2)} due</div></div><span style="font-size:20px;color:var(--wa);">→</span></a>`;
    }).join('');
    return `<div class="card card-accent-green">
      <div class="meter-header"><span class="badge badge-green">✓ Result</span><span class="meter-title">${meterName}</span></div>
      <div class="metric-grid">
        <div class="metric"><div class="metric-label">Total bill</div><div class="metric-val">₹${bd.totalBill.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Main usage</div><div class="metric-val">${bd.mainUsage.toFixed(2)} kWh</div></div>
        <div class="metric"><div class="metric-label">Rate</div><div class="metric-val">₹${bd.rate.toFixed(2)}</div></div>
        <div class="metric"><div class="metric-label">Tenants</div><div class="metric-val">${splits.length}</div></div>
      </div>
      <div class="split-table-wrap"><table class="split-table">
        <thead><tr><th>Tenant</th><th>kWh</th><th>Energy</th><th>Fixed+Com</th><th>Tax</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td colspan="4"></td><td>₹${tTot.toFixed(2)}</td></tr></tfoot>
      </table></div>
      <div class="wa-section"><div class="wa-label">Send via WhatsApp</div>${waButtons}</div>
    </div>`;
  }).join('');
}

async function saveToHistory(){
  if(!state.lastResult){alert('Calculate first.');return;}
  state.history.unshift({...state.lastResult,savedAt:new Date().toISOString()});
  await saveHistory();
  const btn=document.getElementById('save-btn');
  btn.innerHTML='<span>✓</span> Saved!'; btn.disabled=true;
  setTimeout(()=>{btn.innerHTML='<span>💾</span> Save to history';btn.disabled=false;},2500);
}

function applyAutofill(){
  if(!state.history.length) return;
  const last=state.history[0]; if(!last.meterResults) return;
  let filled=0;
  last.meterResults.forEach((mr,mi)=>{
    const ep=document.getElementById(`m${mi}_prev`);
    if(ep&&mr.billData.mainCurr){ep.value=parseFloat(mr.billData.mainCurr).toFixed(2);filled++;}
    mr.splits.forEach((s,ti)=>{
      const el=document.getElementById(`m${mi}_t${ti}_prev`);
      if(el&&s.curr!==undefined){el.value=parseFloat(s.curr).toFixed(2);filled++;}
    });
    onMeterChange(mi);
  });
  if(filled>0){
    document.getElementById('autofill-text').textContent=`From "${last.period}" — enter current readings`;
    document.getElementById('autofill-banner').style.display='flex';
  }
}

function clearAutofill(){
  document.getElementById('autofill-banner').style.display='none';
  state.settings.mainMeters.forEach((_,mi)=>{
    const el=document.getElementById(`m${mi}_prev`); if(el) el.value='';
    state.tenants.filter(t=>t.status==='active'&&state.settings.mainMeters[mi].tenantIds.includes(t.id)).forEach((_,ti)=>{
      const ep=document.getElementById(`m${mi}_t${ti}_prev`); if(ep) ep.value='';
    });
    onMeterChange(mi);
  });
}

function clearForm(){
  clearAutofill();
  state.settings.mainMeters.forEach((_,mi)=>{
    ['prev','curr','rate','energy','fixed','common','tax','confirm'].forEach(f=>{const el=document.getElementById(`m${mi}_${f}`);if(el)el.value='';});
    state.tenants.filter(t=>t.status==='active'&&state.settings.mainMeters[mi].tenantIds.includes(t.id)).forEach((_,ti)=>{
      ['prev','curr'].forEach(f=>{const el=document.getElementById(`m${mi}_t${ti}_${f}`);if(el)el.value='';});
      const chip=document.getElementById(`m${mi}_t${ti}_usage`);if(chip)chip.textContent='— kWh';
    });
    const comp=document.getElementById(`m${mi}_computed`);if(comp)comp.textContent='₹0.00';
    const ul=document.getElementById(`m${mi}_usage_line`);if(ul)ul.style.display='none';
  });
  document.getElementById('result-section').style.display='none';
}

// ── HISTORY ───────────────────────────────────────────────
function renderHistory(){
  const el=document.getElementById('history-list');
  document.getElementById('history-detail').style.display='none';
  if(!state.history.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No records yet</div><div class="empty-sub">Calculate and save a bill to see it here</div></div>`;return;}
  el.innerHTML=state.history.map((rec,idx)=>{
    const d=rec.savedAt?new Date(rec.savedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    const totalBill=(rec.meterResults||[]).reduce((s,mr)=>s+parseFloat(mr.billData.totalBill||0),0);
    return `<div class="history-item">
      <div class="history-icon">⚡</div>
      <div class="history-info">
        <div class="history-period">${rec.period}${idx===0?' <span class="badge badge-green" style="margin-left:4px;">latest</span>':''}</div>
        <div class="history-meta">${(rec.meterResults||[]).length} meter(s) · ₹${totalBill.toFixed(2)} · ${d}</div>
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
  det.innerHTML=`<div style="font-size:17px;font-weight:800;margin-bottom:8px;">${rec.period}</div>${buildResultsHTML(rec.period,rec.meterResults||[])}`;
  det.style.display='block';
  det.scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteRecord(idx){if(!confirm('Delete?'))return;state.history.splice(idx,1);await saveHistory();renderHistory();document.getElementById('history-detail').style.display='none';}
async function clearHistory(){if(!confirm('Clear all history?'))return;state.history=[];await saveHistory();renderHistory();}

// ── SETTINGS ──────────────────────────────────────────────
function renderSettingsPanel(){
  document.getElementById('set-cycle').value=state.settings.cycle;
  document.getElementById('set-msg-template').value=state.settings.msgTemplate||DEFAULT_TEMPLATE;
  document.getElementById('set-msg-template').oninput=updateMsgPreview;
  const uid=state.userId||'—';
  const el1=document.getElementById('user-id-display');if(el1)el1.textContent=uid;
  const el2=document.getElementById('uid-box-display');if(el2)el2.textContent=uid;
  renderMeterSettings(); updateMsgPreview();
}

function renderMeterSettings(){
  const activeTenants=state.tenants.filter(t=>t.status==='active');
  document.getElementById('meter-settings-list').innerHTML=state.settings.mainMeters.map((m,mi)=>{
    const chips=activeTenants.map(t=>`<span class="tenant-chip ${m.tenantIds.includes(t.id)?'selected':''}" onclick="toggleMeterTenant('${m.id}','${t.id}')">${t.name}${t.unit?' ('+t.unit+')':''}</span>`).join('');
    return `<div class="card card-accent-blue" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span class="badge badge-blue">Meter ${mi+1}</span>
        <button class="btn btn-danger btn-sm" onclick="removeMeterFromSettings('${m.id}')">Remove</button>
      </div>
      <div class="form-group"><label>Meter name</label><input type="text" class="m-name" data-id="${m.id}" value="${m.name}"/></div>
      <div><label style="font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px;">Linked active tenants</label>
        <div class="chip-wrap">${chips||'<span style="font-size:13px;color:var(--text3);">No active tenants — add from Buildings or Tenants tab</span>'}</div>
      </div>
    </div>`;
  }).join('');
}

function toggleMeterTenant(meterId,tenantId){
  syncMeterNamesFromDOM();
  const m=state.settings.mainMeters.find(x=>x.id===meterId);if(!m)return;
  if(m.tenantIds.includes(tenantId)) m.tenantIds=m.tenantIds.filter(x=>x!==tenantId);
  else m.tenantIds.push(tenantId);
  renderMeterSettings();
}

function syncMeterNamesFromDOM(){
  document.querySelectorAll('.m-name').forEach(el=>{
    const m=state.settings.mainMeters.find(x=>x.id===el.dataset.id);
    if(m&&el.value.trim()) m.name=el.value.trim();
  });
}

function addMeterToSettings(){
  syncMeterNamesFromDOM();
  state.settings.mainMeters.push({id:uid(),name:'Meter '+(state.settings.mainMeters.length+1),tenantIds:[]});
  renderMeterSettings();
}

function removeMeterFromSettings(id){
  if(state.settings.mainMeters.length<=1){alert('At least one meter required.');return;}
  syncMeterNamesFromDOM();
  state.settings.mainMeters=state.settings.mainMeters.filter(m=>m.id!==id);
  renderMeterSettings();
}

async function applySettings(){
  syncMeterNamesFromDOM();
  state.settings.cycle=document.getElementById('set-cycle').value;
  state.settings.msgTemplate=document.getElementById('set-msg-template').value||DEFAULT_TEMPLATE;
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  await saveSettings();
  renderCalcSections();
  alert('✓ Settings saved & synced!');
}

function updateMsgPreview(){
  const tmpl=document.getElementById('set-msg-template')?.value||DEFAULT_TEMPLATE;
  const name=state.tenants[0]?.name||'First Floor';
  const meter=state.settings.mainMeters[0]?.name||'EB Main Meter';
  const preview=tmpl.replace(/\{(\w+)\}/g,(_,k)=>{
    const map={name,meter,period:'JAN 2026',prev:'6594.48',curr:'6895.10',usage:'300.62',rate:'10.97',total_energy_amt:'3298.57',energy_amt:'1039.48',fixed_total:'856.00',fixed_amt:'285.33',common_amt:'100.00',tax_amt:'57.60',total:'1482.41',num_splits:'3'};
    return map[k]!==undefined?map[k]:'{'+k+'}';
  });
  const el=document.getElementById('msg-preview');if(el)el.textContent=preview;
}

// ── EXCEL EXPORT ──────────────────────────────────────────
function exportExcel(){
  if(typeof XLSX==='undefined'){alert('Excel library loading, try again.');return;}
  const wb=XLSX.utils.book_new();

  // Buildings sheet
  const bData=[['Buildings'],[], ['Name','Address','Units','Floors','Description']];
  state.buildings.forEach(b=>bData.push([b.name,b.address||'',parseInt(b.units)||0,parseInt(b.floors)||0,b.desc||'']));
  const wsBld=XLSX.utils.aoa_to_sheet(bData);
  wsBld['!cols']=[20,25,8,8,30].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,wsBld,'Buildings');

  // Tenants sheet
  const tData=[['Tenants'],[], ['Name','Building','Unit','Phone','Email','ID Type','ID Number','Move-in Date','Agreement Start','Agreement End','Status','Monthly Rent','Deposit','Notes']];
  state.tenants.forEach(t=>tData.push([t.name,getBuildingName(t.buildingId),t.unit||'',t.phone||'',t.email||'',t.idType||'',t.idNumber||'',t.occupiedDate||'',t.agreementStart||'',t.agreementEnd||'',t.status||'',t.rent||'',t.deposit||'',t.notes||'']));
  const wsTnt=XLSX.utils.aoa_to_sheet(tData);
  wsTnt['!cols']=[20,20,12,15,22,14,15,14,14,14,10,12,12,25].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,wsTnt,'Tenants');

  // Bill history
  if(state.history.length){
    const sumData=[['Bill History — Summary'],[], ['Period','Meter','Usage (kWh)','Rate','Energy','Fixed','Common','Tax','Total','Tenants']];
    state.history.forEach(rec=>{(rec.meterResults||[]).forEach(mr=>{sumData.push([rec.period,mr.meterName,parseFloat(mr.billData.mainUsage||0),parseFloat(mr.billData.rate||0),parseFloat(mr.billData.totalEnergy||0),parseFloat(mr.billData.fixedAmt||0),parseFloat(mr.billData.commonAmt||0),parseFloat(mr.billData.taxAmt||0),parseFloat(mr.billData.totalBill||0),mr.splits.length]);});});
    const wsSum=XLSX.utils.aoa_to_sheet(sumData);
    wsSum['!cols']=[14,20,14,10,12,12,12,10,12,8].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,wsSum,'Bill Summary');

    const detData=[['Detailed Splits'],[], ['Period','Meter','Tenant','Unit','Prev','Curr','kWh','Energy','Fixed','Common','Tax','Total']];
    state.history.forEach(rec=>{(rec.meterResults||[]).forEach(mr=>{mr.splits.forEach(s=>detData.push([rec.period,mr.meterName,s.name,s.unit||'',parseFloat(s.prev||0),parseFloat(s.curr||0),parseFloat(s.usage||0),parseFloat(s.energyAmt||0),parseFloat(s.fixedAmt||0),parseFloat(s.commonAmt||0),parseFloat(s.taxAmt||0),parseFloat(s.total||0)]));detData.push([]);});});
    const wsDet=XLSX.utils.aoa_to_sheet(detData);
    wsDet['!cols']=[14,20,20,12,10,10,12,12,12,12,10,12].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,wsDet,'Detailed Splits');
  }

  XLSX.writeFile(wb,'EB_Property_'+new Date().toISOString().slice(0,10)+'.xlsx');
}

function exportJSON(){
  const blob=new Blob([JSON.stringify({buildings:state.buildings,tenants:state.tenants,settings:state.settings,history:state.history},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eb-backup.json';a.click();
}

// ── MODAL SYSTEM ──────────────────────────────────────────
let currentModal=null;
// Global action registry — avoids function.toString() which breaks closures
window._ma = {};

function showModal(id, title, bodyHtml, buttons){
  closeModal();
  const btnHtml = buttons.map((b, i) => {
    const key = '_mb_' + i;
    window._ma[key] = b.action;
    return '<button class="btn ' + b.cls + '" style="flex:1;" onclick="window._ma[\"' + key + '\"]()">'+ b.label + '</button>';
  }).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = id;
  modal.innerHTML =
    '<div class="modal-header">' +
      '<div class="modal-title">' + title + '</div>' +
      '<button class="modal-close" onclick="closeModal()">✕</button>' +
    '</div>' +
    '<div class="modal-body">' + bodyHtml + '</div>' +
    '<div class="modal-footer">' + btnHtml + '</div>';
  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  currentModal = overlay;
  document.body.style.overflow = 'hidden';
}

function closeModal(){
  if(currentModal){ currentModal.remove(); currentModal = null; document.body.style.overflow = ''; }
  Object.keys(window._ma).forEach(k => delete window._ma[k]);
}

// ── SYNC UI HELPERS ───────────────────────────────────────
function promptSwitchUser(){
  const newId=prompt('Enter User ID to load data from another device:\n(Leave blank to cancel)');
  if(!newId||!newId.trim()) return;
  if(newId.trim()===state.userId){alert('That is already your current ID.');return;}
  if(confirm(`Switch to:\n${newId.trim()}\n\nThis will load that user's data. Continue?`)){
    localStorage.setItem('eb_user_id',newId.trim());
    location.reload();
  }
}

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded',async()=>{
  state.userId=getOrCreateUserId();
  const firebaseOk=initFirebase();
  await cloudLoad();

  document.getElementById('reading-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('cycle-badge').textContent=state.settings.cycle==='monthly'?'Monthly':'Bi-monthly';
  const uid=state.userId||'—';
  const el1=document.getElementById('user-id-display');if(el1)el1.textContent=uid;
  renderDashboard();

  const statusEl=document.getElementById('sync-status');
  if(statusEl){statusEl.textContent=firebaseOk?'☁️ Cloud sync on':'📱 Offline mode';statusEl.style.color=firebaseOk?'var(--green-txt)':'var(--text3)';}

  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
});
