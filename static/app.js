const $ = (selector) => document.querySelector(selector);
const ru = new Intl.NumberFormat('ru-RU');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AREA_NAMES = ['\u0421\u0432\u0430\u0440\u043a\u0430', '\u041e\u043a\u0440\u0430\u0441\u043a\u0430', '\u0421\u0431\u043e\u0440\u043a\u0430'];
let state = {};
let currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ = null;
let csrfToken = "";
let accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs = [];
let selectedArea = null;
let currentPage = ["home","production","equipment","incidents","analytics","ai","cabinet","profile","shift-entry","demo","audit","actions","forecast"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
let toastTimer;
let chartPeriod = "all";
let reportFilters = { start_date: "", end_date: "", area: "" };

function filterQuery() {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(reportFilters)) if (value) query.set(key, value);
  return query.toString();
}
function withFilters(path) { const query=filterQuery(); return query ? `${path}?${query}` : path; }
function syncExportLink() { $('#export-report').href=withFilters('/api/reports.csv'); }

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, ...options });
  if (response.status === 401) { location.replace('/login'); throw new Error('РЎРµСЃСЃРёСЏ Р·Р°РІРµСЂС€РµРЅР°. Р’РѕР№РґРёС‚Рµ СЃРЅРѕРІР°.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'РџСЂРѕРІРµСЂСЊС‚Рµ РІРІРµРґС‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ');
  }
  return response.status === 204 ? null : response.json();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function dateLabel(raw, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return raw ? new Intl.DateTimeFormat('ru-RU', options).format(new Date(`${raw}T12:00:00`)) : 'вЂ”';
}

async function refresh() {
  try {
    const filtered = (path) => api(withFilters(path));
    const auditPromise = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ?.role === 'admin' ? api('/api/admin/audit?limit=100') : Promise.resolve([]);
    const [dashboard, factory, lines, quality, downtime, plans, plan, tips, events, equipment, maintenanceAlerts, audit, actions, forecast] = await Promise.all([
      filtered('/api/dashboard'), filtered('/api/factory-state'), filtered('/api/lines'), filtered('/api/quality'),
      filtered('/api/downtimes'), api('/api/plans'), api('/api/plan-recommendation'),
      filtered('/api/recommendations'), api('/api/events?limit=8'), filtered('/api/equipment'),
      api('/api/maintenance/alerts'), auditPromise, api('/api/actions'), api('/api/production-forecast'),
    ]);
    state = { dashboard, factory, lines, quality, downtime, plans, plan, tips, events, equipment, maintenanceAlerts, audit, actions, forecast };
    render();
  } catch (error) { toast(error.message); if (!state.dashboard) { $('#content').innerHTML = '<section class="panel empty"><h2>РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ</h2><p>РџСЂРѕРІРµСЂСЊС‚Рµ, С‡С‚Рѕ СЃРµСЂРІРµСЂ Р·Р°РїСѓС‰РµРЅ, Рё РЅР°Р¶РјРёС‚Рµ В«РћР±РЅРѕРІРёС‚СЊВ».</p></section>'; } }
}


const headings = {home:'РљР°СЂС‚Р° Р·Р°РІРѕРґР°',production:'РџСЂРѕРёР·РІРѕРґСЃС‚РІРѕ',equipment:'РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ',incidents:'РђРІР°СЂРёРё',analytics:'РђРЅР°Р»РёС‚РёРєР°',ai:'РР РђРЅР°Р»РёР·','shift-entry':'Р’РЅРµСЃС‚Рё СЃРјРµРЅСѓ'};
const panel = (title, body, extra='') => `<section class="panel"><div class="panel-title"><h2>${title}</h2>${extra}</div><div class="rule"></div>${body}</section>`;
function stages(){return `<div class="stage-grid">${state.factory.areas.map(a=>`<button class="stage ${esc(a.status)} ${selectedArea===a.area?'selected':''}" data-area="${esc(a.area)}"><b>${a.status!=='normal'?'<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ':''}${esc(a.area)}</b><strong>${a.utilization_percent===null?'вЂ”':ru.format(a.utilization_percent)+'%'}</strong><small>${ru.format(a.actual_units)} Р°РІС‚Рѕ</small></button>`).join('')}</div>`;}
function factoryPanel(){return panel('<i class="fa-solid '+(currentPage==='production'?'fa-car':'fa-map')+'" aria-hidden="true"></i> '+headings[currentPage=== 'production'?'production':'home'],`${currentPage==='production'?`<div class="subline">РџРѕСЃР»РµРґРЅСЏСЏ СЃРјРµРЅР° В· ${esc(dateLabel(state.factory.date))}</div>`:''}${stages()}<div class="flow-stats"><span><b>Р’ СЂР°Р±РѕС‚Рµ:</b> ${state.factory.areas.filter(a=>a.actual_units>0).length}/${state.factory.areas.length} СѓС‡Р°СЃС‚РєРѕРІ</span><span><b>Р’С‹РїСѓСЃРє СЃР±РѕСЂРєРё:</b> ${ru.format(state.factory.areas.find(a=>a.area==='РЎР±РѕСЂРєР°')?.actual_units||0)} Р°РІС‚Рѕ/СЃРјРµРЅСѓ</span><span><b>РћС‚РєР»РѕРЅРµРЅРёСЏ:</b> ${state.factory.areas.filter(a=>a.status!=='normal').length}</span></div>`,`<span class="active-label">РђРєС‚РёРІРЅРѕ</span>`);}
function shopPanel(){const a=state.factory.areas.find(a=>a.area===selectedArea);return panel('<i class="fa-solid fa-map" aria-hidden="true"></i> РљР°СЂС‚Р° С†РµС…Р°: '+(a?esc(a.area):'<span style="font-weight:400">Р’С‹ РЅРµ РІС‹Р±СЂР°Р»Рё С†РµС…</span>'),a?`${stages()}<div class="detail-title">${esc(a.line)}<small>${a.equipment.length?a.equipment.map(esc).join(', '):'РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ Р±РµР· Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹С… РїСЂРѕСЃС‚РѕРµРІ'}</small></div><div class="metrics"><div class="metric"><strong>${a.utilization_percent===null?'вЂ”':ru.format(a.utilization_percent)+'%'}</strong><small>Р—Р°РіСЂСѓР·РєР°</small></div><div class="metric"><strong>${ru.format(a.defect_rate_percent)}%</strong><small>Р‘СЂР°Рє</small></div><div class="metric"><strong>${ru.format(a.downtime_minutes)} РјРёРЅ</strong><small>РџСЂРѕСЃС‚РѕР№</small></div></div><div class="detail-stats"><span><b>РџР»Р°РЅ:</b> ${ru.format(a.planned_units)} Р°РІС‚Рѕ</span><span><b>Р¤Р°РєС‚:</b> ${ru.format(a.actual_units)} Р°РІС‚Рѕ</span><span><b>РўРµРјРїРµСЂР°С‚СѓСЂР° / РІРёР±СЂР°С†РёСЏ:</b> РЅРµС‚ РґР°РЅРЅС‹С…</span></div>`:'<div class="empty"><p>Р’С‹ РЅРµ РІС‹Р±СЂР°Р»Рё С†РµС…, РїРѕР¶Р°Р»СѓР№СЃС‚Р°, РІС‹Р±РµСЂРёС‚Рµ С†РµС… РЅР° РєР°СЂС‚Рµ</p><div class="sad" aria-hidden="true"><i class="fa-solid fa-face-frown" aria-hidden="true"></i></div></div>');}
function chartPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> '+(currentPage==='production'?'Р’С‹РїСѓСЃРє РїРѕ РґРЅСЏРј':'Р”РёРЅР°РјРёРєР°'),'<div class="chart-wrap"><div id="output-chart" role="img" aria-label="Р“СЂР°С„РёРє РІС‹РїСѓСЃРєР° Р°РІС‚РѕРјРѕР±РёР»РµР№"></div></div><div id="chart-legend" class="chart-legend"></div>',`<select id="chart-period" aria-label="РџРµСЂРёРѕРґ РіСЂР°С„РёРєР°"><option value="all" ${chartPeriod==='all'?'selected':''}>Р’РµСЃСЊ РїРµСЂРёРѕРґ</option><option value="7" ${chartPeriod==='7'?'selected':''}>7 РґРЅРµР№</option><option value="30" ${chartPeriod==='30'?'selected':''}>30 РґРЅРµР№</option></select>`);}
function planFactPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> РџР»Р°РЅ / С„Р°РєС‚',`<div class="subline">РџРѕСЃР»РµРґРЅСЏСЏ СЃРјРµРЅР° В· Р°РІС‚РѕРјРѕР±РёР»Рё</div><div class="plan-fact">${state.factory.areas.map(a=>`<div class="fact-row"><div><b>${esc(a.area)}</b><span>${ru.format(a.actual_units)} / ${ru.format(a.planned_units)}</span></div><div class="fact-track"><span style="width:${a.planned_units?Math.max(0,Math.min(100,a.actual_units/a.planned_units*100)):0}%"></span></div></div>`).join('')}</div><div class="fact-legend"><i></i> Р¤Р°РєС‚ <i></i> РџР»Р°РЅ</div>`);}
function bottleneckPanel(){const areas=state.factory.areas.filter(a=>a.status!=='normal');return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> РЈР·РєРёРµ РјРµСЃС‚Р°',`<div class="bottlenecks">${areas.map(a=>`<article class="bottleneck ${esc(a.status)}"><div class="bottleneck-heading"><b>${esc(a.area)}</b><a href="#ai">РђРЅР°Р»РёР· в†’</a></div><div class="bottleneck-metrics"><span><small>Р—Р°РіСЂСѓР·РєР°</small>${a.utilization_percent===null?'вЂ”':ru.format(a.utilization_percent)+'%'}</span><span><small>РџСЂРѕСЃС‚РѕР№</small>${ru.format(a.downtime_minutes)} РјРёРЅ</span><span><small>Р‘СЂР°Рє</small>${ru.format(a.defect_rate_percent)}%</span></div></article>`).join('')||'<p class="muted">РћС‚РєР»РѕРЅРµРЅРёР№ РЅР° СѓС‡Р°СЃС‚РєР°С… РЅРµС‚</p>'}</div>`);}
function tipsPanel(){return panel('<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> РР РђРЅР°Р»РёР·',`<div id="insights-list"></div><div id="alert-box"></div><p class="muted">Р РµРєРѕРјРµРЅРґР°С†РёРё РїРѕ РїРѕСЂРѕРіР°Рј РєР°С‡РµСЃС‚РІР° Рё РїСЂРѕСЃС‚РѕРµРІ. РџСЂРѕРіРЅРѕР· СЂРёСЃРєР° РІ API РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚.</p>`,`<a class="text-button" href="#ai">РџРѕРґСЂРѕР±РЅРµРµ</a>`);}
function eventsPanel(){return panel('<i class="fa-solid fa-list-ul" aria-hidden="true"></i> РџРѕСЃР»РµРґРЅРёРµ СЃРѕР±С‹С‚РёСЏ','<div id="event-list"></div>');}
function planPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> РџР»Р°РЅ / С„Р°РєС‚',`<div class="plan-summary"><div><strong id="plan-total"></strong><span>Р°РІС‚РѕРјРѕР±РёР»РµР№ РІ РјРµСЃСЏС†</span></div><div class="plan-gap" id="plan-gap"></div></div><div class="plan-progress"><div id="plan-progress-fill"></div></div><div id="plan-list"></div><button id="apply-plan-button">РџСЂРёРјРµРЅРёС‚СЊ РїСЂРµРґР»РѕР¶РµРЅРёРµ</button>`);}
function equipmentPanel(){const history=state.downtime;return panel('<i class="fa-solid fa-gear" aria-hidden="true"></i> Р РµРµСЃС‚СЂ РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ',`<div class="subline">РЎРѕСЃС‚РѕСЏРЅРёРµ, РїР»Р°РЅРѕРІРѕРµ РѕР±СЃР»СѓР¶РёРІР°РЅРёРµ Рё РЅР°РєРѕРїР»РµРЅРЅС‹Рµ РїСЂРѕСЃС‚РѕРё</div><div tabindex="0" class="table-wrap"><table><thead><tr><th>РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ</th><th>РЈС‡Р°СЃС‚РѕРє</th><th>РЎРѕСЃС‚РѕСЏРЅРёРµ</th><th>РџРѕСЃР»РµРґРЅРµРµ РўРћ</th><th>РЎР»РµРґСѓСЋС‰РµРµ РўРћ</th><th>РџСЂРѕСЃС‚РѕР№ РІСЃРµРіРѕ</th><th>Р—Р°РјРµС‚РєРё</th>${currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?'<th></th>':''}</tr></thead><tbody>${state.equipment.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.area)}</td><td><span class="pill ${a.status==='working'?'good':'bad'}">${a.status==='working'?'Р’ СЂР°Р±РѕС‚Рµ':a.status==='maintenance'?'РќР° РўРћ':'РћСЃС‚Р°РЅРѕРІР»РµРЅРѕ'}</span></td><td>${esc(dateLabel(a.last_maintenance))}</td><td>${esc(dateLabel(a.next_maintenance))}</td><td>${ru.format(a.total_downtime_minutes)} РјРёРЅ</td><td>${esc(a.notes)}</td>${currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?`<td><button data-edit-asset="${a.id}">РР·РјРµРЅРёС‚СЊ</button></td>`:''}</tr>`).join('')||'<tr><td colspan="8">Р РµРµСЃС‚СЂ РїСѓСЃС‚</td></tr>'}</tbody></table></div>`,currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?'<button id="new-asset-button">Р”РѕР±Р°РІРёС‚СЊ РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ</button>':'')+panel('<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> РСЃС‚РѕСЂРёСЏ РїРѕР»РѕРјРѕРє',`<div tabindex="0" class="table-wrap"><table><thead><tr><th>Р”Р°С‚Р°</th><th>РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ</th><th>РЈС‡Р°СЃС‚РѕРє</th><th>РџСЂРёС‡РёРЅР°</th><th>РџСЂРѕСЃС‚РѕР№</th></tr></thead><tbody>${history.map(d=>`<tr><td>${esc(dateLabel(d.work_date))}</td><td>${esc(d.equipment)}</td><td>${esc(d.area)}</td><td>${esc(d.reason)}</td><td>${ru.format(d.duration_minutes)} РјРёРЅ</td></tr>`).join('')||'<tr><td colspan="5">РќРµС‚ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹С… РїРѕР»РѕРјРѕРє Р·Р° РІС‹Р±СЂР°РЅРЅС‹Р№ РїРµСЂРёРѕРґ</td></tr>'}</tbody></table></div>`)+(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?panel('<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i> РљР°СЂС‚РѕС‡РєР° РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ',`<form id="asset-form" class="account-form form-grid"><input type="hidden" name="id"><label>РќР°Р·РІР°РЅРёРµ<input name="name" required maxlength="100"></label><label>РЈС‡Р°СЃС‚РѕРє<select name="area" required>${AREA_NAMES.map(a=>`<option>${a}</option>`).join('')}</select></label><label>РЎРѕСЃС‚РѕСЏРЅРёРµ<select name="status"><option value="working">Р’ СЂР°Р±РѕС‚Рµ</option><option value="maintenance">РќР° РўРћ</option><option value="stopped">РћСЃС‚Р°РЅРѕРІР»РµРЅРѕ</option></select></label><label>РџРѕСЃР»РµРґРЅРµРµ РўРћ<input name="last_maintenance" type="date"></label><label>РЎР»РµРґСѓСЋС‰РµРµ РўРћ<input name="next_maintenance" type="date" required></label><label>Р—Р°РјРµС‚РєРё<input name="notes" maxlength="500"></label><p class="form-error form-full" role="alert" hidden></p><button class="submit-button" type="submit">РЎРѕС…СЂР°РЅРёС‚СЊ РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ</button></form>`):'');}
function maintenanceAlertsPanel(){const items=state.maintenanceAlerts?.items||[];return panel('РќР°РїРѕРјРёРЅР°РЅРёСЏ Рѕ РўРћ',items.length?`<div class="maintenance-alerts">${items.map(item=>`<article class="maintenance-alert ${item.urgency==='overdue'?'overdue':''}"><b>${esc(item.name)}</b><span>${esc(item.area)}</span><strong>${item.days_remaining<0?`РџСЂРѕСЃСЂРѕС‡РµРЅРѕ РЅР° ${Math.abs(item.days_remaining)} РґРЅ.`:item.days_remaining===0?'РЎСЂРѕРє СЃРµРіРѕРґРЅСЏ':`РўРћ С‡РµСЂРµР· ${item.days_remaining} РґРЅ.`}</strong></article>`).join('')}</div>`:'<p class="muted">No maintenance due in the next 14 РґРЅ..</p>');}
function demoPanel(){return panel('Р”РµРјРѕ РґР»СЏ Р¶СЋСЂРё',`<ol class="demo-steps"><li><b>РћР±Р·РѕСЂ Р·Р°РІРѕРґР°.</b> РџРѕРєР°Р¶РёС‚Рµ РІС‹РїСѓСЃРє, РєР°С‡РµСЃС‚РІРѕ Рё Р·Р°РіСЂСѓР·РєСѓ РЅР° РіР»Р°РІРЅРѕР№ СЃС‚СЂР°РЅРёС†Рµ.</li><li><b>РќР°Р№РґРёС‚Рµ СЂРёСЃРє.</b> РћС‚РєСЂРѕР№С‚Рµ Р°РЅР°Р»РёС‚РёРєСѓ Рё СЂРµРєРѕРјРµРЅРґР°С†РёРё СЃРёСЃС‚РµРјС‹.</li><li><b>РџСЂРѕРІРµСЂСЊС‚Рµ СЃС†РµРЅР°СЂРёР№.</b> РЎРјРѕРґРµР»РёСЂСѓР№С‚Рµ СЃР±РѕР№ РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ Рё СЃСЂР°РІРЅРёС‚Рµ РїРѕРєР°Р·Р°С‚РµР»Рё.</li><li><b>РџРѕРєР°Р¶РёС‚Рµ СЂР°Р±РѕС‡РёРµ РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹.</b> РћС‚РєСЂРѕР№С‚Рµ РїСЂРѕРіРЅРѕР· СЃРјРµРЅС‹, РѕР±СЉСЏСЃРЅРёС‚Рµ РµРіРѕ РёСЃС…РѕРґРЅС‹Рµ РґР°РЅРЅС‹Рµ Рё РЅР°Р·РЅР°С‡СЊС‚Рµ РѕС‚РІРµС‚СЃС‚РІРµРЅРЅРѕРіРѕ РІ С†РµРЅС‚СЂРµ РґРµР№СЃС‚РІРёР№.</li></ol>${currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?'<button id="demo-simulate" class="submit-button">РЎРјРѕРґРµР»РёСЂРѕРІР°С‚СЊ СЃР±РѕР№</button>':'<p class="muted">Р—Р°РїСѓСЃРє СЃРёРјСѓР»СЏС†РёРё РґРѕСЃС‚СѓРїРµРЅ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.</p>'}<p class="muted">РЎРёРјСѓР»СЏС†РёСЏ РґРѕР±Р°РІРёС‚ РґРµРјРѕРЅСЃС‚СЂР°С†РёРѕРЅРЅСѓСЋ СЃРјРµРЅСѓ Рё СЃРѕР±С‹С‚РёРµ РІ Р±Р°Р·Сѓ РґР°РЅРЅС‹С….</p>`);}
function auditPanel(){const entries=state.audit||[];return panel('Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№',`<div tabindex="0" class="table-wrap"><table><thead><tr><th>Р’СЂРµРјСЏ</th><th>РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ</th><th>Р”РµР№СЃС‚РІРёРµ</th><th>Р Р°Р·РґРµР»</th><th>ID</th></tr></thead><tbody>${entries.map(entry=>`<tr><td>${esc(new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.created_at*1000)))}</td><td>${esc(entry.actor_username)}</td><td>${esc(entry.action)}</td><td>${esc(entry.entity_type)}</td><td>${esc(entry.entity_id||'?')}</td></tr>`).join('')||'<tr><td colspan="5">Р—Р°РїРёСЃРµР№ РїРѕРєР° РЅРµС‚</td></tr>'}</tbody></table></div>`);}
function actionsPanel(){const items=state.actions||[];return panel('Р”РµР№СЃС‚РІРёРµ center',items.length?`<div class="action-list">${items.map(item=>`<article class="action-card ${esc(item.priority)} ${item.status==='resolved'?'resolved':''}"><div class="action-head"><span class="pill ${esc(item.priority)}">${esc(item.priority)}</span><span class="muted">${item.active?'РЎРёРіРЅР°Р» Р°РєС‚РёРІРµРЅ':'РЎРёРіРЅР°Р» СѓСЃС‚СЂР°РЅС‘РЅ'} ? ${esc(item.source_type)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.reason)}</p><p><b>РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі:</b> ${esc(item.recommended_action)}</p>${item.area?`<span class="muted">РЈС‡Р°СЃС‚РѕРє: ${esc(item.area)}</span>`:''}<div class="action-controls"><label>Status<select data-action-status="${item.id}"><option value="new" ${item.status==='new'?'selected':''}>РќРѕРІР°СЏ</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>Р’ СЂР°Р±РѕС‚Рµ</option><option value="resolved" ${item.status==='resolved'?'selected':''}>Р РµС€РµРЅР°</option></select></label><label>РћС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Р№<input data-action-owner="${item.id}" maxlength="100" value="${esc(item.assigned_to)}" placeholder="РРјСЏ СЃРѕС‚СЂСѓРґРЅРёРєР°"></label><button data-save-action="${item.id}">РЎРѕС…СЂР°РЅРёС‚СЊ</button></div></article>`).join('')}`:'<p class="muted">РЎРµР№С‡Р°СЃ РЅРµС‚ Р°РєС‚РёРІРЅС‹С… РїСЂРѕРёР·РІРѕРґСЃС‚РІРµРЅРЅС‹С… Р·Р°РґР°С‡.</p>');}
function forecastPanel(){const forecast=state.forecast||{},items=forecast.areas||[];const statusLabel={on_track:'РџРѕ РїР»Р°РЅСѓ',at_risk:'Р РёСЃРє РѕС‚СЃС‚Р°РІР°РЅРёСЏ',no_data:'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР°РЅРЅС‹С…'};return panel('РџСЂРѕРіРЅРѕР· РІС‹РїСѓСЃРєР° Р·Р° СЃРјРµРЅСѓ',`${items.length?`<div class="forecast-grid">${items.map(item=>`<article class="forecast-card ${esc(item.status)}"><div><b>${esc(item.area)}</b><span class="pill ${item.status==='on_track'?'good':'bad'}">${statusLabel[item.status]}</span></div><p>Р¤Р°РєС‚: ${ru.format(item.actual_units)} / РїР»Р°РЅ ${ru.format(item.planned_units)}</p><strong>${item.projected_units===null?'N/A':ru.format(item.projected_units)} С€С‚. РѕР¶РёРґР°РµС‚СЃСЏ</strong><p>Р’РѕР·РјРѕР¶РЅРѕРµ РѕС‚СЃС‚Р°РІР°РЅРёРµ РѕС‚ РїР»Р°РЅР°: ${item.projected_gap===null?'N/A':ru.format(item.projected_gap)} С€С‚.</p><small>РџСЂРѕС€Р»Рѕ: ${ru.format(item.elapsed_shift_hours)} С‡ | РСЃС‚РѕС‡РЅРёРє: ${esc(item.data_sources.join(', '))} | РљР°С‡РµСЃС‚РІРѕ РґР°РЅРЅС‹С…: ${item.data_quality}</small></article>`).join('')}</div>`:'<p class="muted">РќРµС‚ Р·Р°РїРёСЃРµР№ Рѕ СЃРјРµРЅР°С… РґР»СЏ СЂР°СЃС‡С‘С‚Р° РїСЂРѕРіРЅРѕР·Р°.</p>'}<div class="forecast-method"><b>РњРµС‚РѕРґ СЂР°СЃС‡С‘С‚Р°:</b> ${esc(forecast.method_label||'Р›РёРЅРµР№РЅС‹Р№ РїСЂРѕРіРЅРѕР· РЅР° 8-С‡Р°СЃРѕРІСѓСЋ СЃРјРµРЅСѓ')}<p>${esc(forecast.limitation||'')}</p><ul>${(forecast.assumptions||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul><small>Р”Р°С‚Р° РїРѕСЃР»РµРґРЅРµР№ СЃРјРµРЅС‹: ${esc(forecast.work_date||'РЅРµС‚ РґР°РЅРЅС‹С…')}. Р­С‚Рѕ РѕС†РµРЅРѕС‡РЅС‹Р№ СЂР°СЃС‡С‘С‚, Р° РЅРµ РјР°С€РёРЅРЅРѕРµ РѕР±СѓС‡РµРЅРёРµ.</small></div>`);}
function bindР”РµР№СЃС‚РІРёРµControls(){document.querySelectorAll('[data-save-action]').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{const id=button.dataset.saveР”РµР№СЃС‚РІРёРµ;await api(`/api/actions/${id}`,{method:'PATCH',body:JSON.stringify({status:$(`[data-action-status="${id}"]`).value,assigned_to:$(`[data-action-owner="${id}"]`).value})});await refresh();toast('Р”РµР№СЃС‚РІРёРµ updated');})));}
function shiftEntryPanel(){return panel('<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Р’РЅРµСЃС‚Рё РґР°РЅРЅС‹Рµ СЃРјРµРЅС‹',`<p class="muted">Р—Р°РїРёСЃСЊ РґРѕР±Р°РІРёС‚СЃСЏ РІ РІС‹РїСѓСЃРє, РєР°С‡РµСЃС‚РІРѕ Рё РїСЂРё РЅР°Р»РёС‡РёРё вЂ” РІ Р¶СѓСЂРЅР°Р» РїСЂРѕСЃС‚РѕРµРІ.</p><form id="shift-entry-form" class="account-form form-grid"><label>Р”Р°С‚Р°<input name="work_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label><label>РЈС‡Р°СЃС‚РѕРє<select name="area">${AREA_NAMES.map(a=>`<option ${reportFilters.area===a?'selected':''}>${a}</option>`).join('')}</select></label><label>РџР»Р°РЅ, С€С‚.<input name="planned_units" type="number" min="0" value="120" required></label><label>Р¤Р°РєС‚, С€С‚.<input name="actual_units" type="number" min="0" value="120" required></label><label>Р§Р°СЃС‹ СЂР°Р±РѕС‚С‹<input name="operating_hours" type="number" min="0" max="24" step="0.1" value="8" required></label><label>РЎРєРѕР»СЊРєРѕ С‡Р°СЃРѕРІ СЃРјРµРЅС‹ РїСЂРѕС€Р»Рѕ<input name="elapsed_shift_hours" type="number" min="0" max="8" step="0.25" value="4" required></label><label>Р—Р°РіСЂСѓР·РєР°, %<input name="utilization_percent" type="number" min="0" max="100" step="0.1" value="95" required></label><label>РџСЂРѕРёР·РІРµРґРµРЅРѕ РґР»СЏ РєРѕРЅС‚СЂРѕР»СЏ<input name="produced" type="number" min="0" value="120" required></label><label>Р‘СЂР°Рє, С€С‚.<input name="defects" type="number" min="0" value="0" required></label><label>РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ РїСЂРё РїСЂРѕСЃС‚РѕРµ<input name="equipment" maxlength="100"></label><label>РџСЂРёС‡РёРЅР° РїСЂРѕСЃС‚РѕСЏ<input name="downtime_reason" maxlength="500"></label><label>РџСЂРѕСЃС‚РѕР№, РјРёРЅСѓС‚<input name="downtime_minutes" type="number" min="0" value="0"></label><label class="checkbox-label"><input name="is_critical" type="checkbox" checked> РљСЂРёС‚РёС‡РЅС‹Р№ РїСЂРѕСЃС‚РѕР№</label><p class="form-error form-full" role="alert" hidden></p><div class="form-full"><button class="submit-button" type="submit">РЎРѕС…СЂР°РЅРёС‚СЊ СЃРјРµРЅСѓ</button></div></form><section class="csv-import"><h3>РРјРїРѕСЂС‚ СЃРјРµРЅ РёР· CSV</h3><p class="muted">РЎРєР°С‡Р°Р№С‚Рµ С€Р°Р±Р»РѕРЅ, Р·Р°РїРѕР»РЅРёС‚Рµ РµРіРѕ Рё Р·Р°РіСЂСѓР·РёС‚Рµ CSV-С„Р°Р№Р» РІ РєРѕРґРёСЂРѕРІРєРµ UTF-8.</p><a class="text-button" href="/api/import/template.csv">РЎРєР°С‡Р°С‚СЊ С€Р°Р±Р»РѕРЅ CSV</a><form id="csv-import-form"><label>CSV-С„Р°Р№Р»<input name="csv_file" type="file" accept=".csv,text/csv" required></label><p class="form-error" role="alert" hidden></p><button class="submit-button" type="submit">РРјРїРѕСЂС‚РёСЂРѕРІР°С‚СЊ СЃРјРµРЅС‹</button></form></section>`);}
function incidentsPanel(){return panel('<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> РђРІР°СЂРёРё Рё РїСЂРѕСЃС‚РѕРё',`<div tabindex="0" aria-label="РўР°Р±Р»РёС†Р°, РїСЂРѕРєСЂСѓС‚РєР° РїРѕ РіРѕСЂРёР·РѕРЅС‚Р°Р»Рё" class="table-wrap"><table><thead><tr><th>Р”Р°С‚Р°</th><th>РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ</th><th>РџСЂРёС‡РёРЅР°</th><th>РџСЂРѕСЃС‚РѕР№</th><th>РЈСЂРѕРІРµРЅСЊ</th></tr></thead><tbody>${state.downtime.map(d=>`<tr><td>${esc(dateLabel(d.work_date))}</td><td>${esc(d.equipment)}<br><small>${esc(d.area)}</small></td><td>${esc(d.reason)}</td><td>${ru.format(d.duration_minutes)} РјРёРЅ</td><td><span class="pill ${d.is_critical?'bad':''}">${d.is_critical?'РљСЂРёС‚РёС‡РЅС‹Р№':'РћР±С‹С‡РЅС‹Р№'}</span></td></tr>`).join('')||'<tr><td colspan="5">РџСЂРѕСЃС‚РѕРµРІ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРѕ</td></tr>'}</tbody></table></div>`)+eventsPanel();}
function renderTips(){if(!$('#insights-list'))return;$('#insights-list').innerHTML=state.tips.map(t=>`<article class="insight ${esc(t.priority)}"><span class="insight-mark"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span><div><h3>${esc(t.title)}</h3><p>${esc(t.reason)}</p><p><b>Р РµРєРѕРјРµРЅРґР°С†РёСЏ:</b> ${esc(t.action)}</p></div></article>`).join(''); const alerts=state.dashboard.alerts;$('#alert-box').className='alert-box'+(alerts.length?' has-alert':'');$('#alert-box').textContent=alerts.length?alerts.map(a=>a.message).join(' В· '):'РљСЂРёС‚РёС‡РЅС‹С… РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёР№ РЅРµС‚';}
function render(){updateIdentity();const k=state.dashboard.kpis;$('#kpi-output').textContent=ru.format(k.actual_units);$('#kpi-oee').textContent=ru.format(k.oee_percent)+'%';$('#kpi-downtime').textContent=ru.format(k.downtime_minutes)+' РјРёРЅ';$('#kpi-quality').textContent=ru.format(100-k.defect_rate_percent)+'%';$('.period').textContent=`РџРµСЂРёРѕРґ: ${reportFilters.start_date||'РЅР°С‡Р°Р»Рѕ'} вЂ” ${reportFilters.end_date||'СЃРµРіРѕРґРЅСЏ'}${reportFilters.area?' В· '+reportFilters.area:''}`;document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===currentPage);if(a.dataset.page===currentPage)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
const pages={cabinet:cabinetPanel,profile:profilePanel,home:()=>factoryPanel()+shopPanel()+(selectedArea?'<div class="cols">'+chartPanel()+tipsPanel()+'</div>':tipsPanel()),production:()=>factoryPanel()+'<div class="cols">'+chartPanel()+planFactPanel()+'</div><div class="cols production-bottom">'+eventsPanel()+bottleneckPanel()+'</div>',equipment:()=>maintenanceAlertsPanel()+equipmentPanel(),incidents:incidentsPanel,analytics:()=>chartPanel()+planPanel(),ai:()=>tipsPanel()+eventsPanel(),'actions':actionsPanel,'forecast':forecastPanel,'demo':demoPanel,'audit':currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?auditPanel:()=>panel('РќРµС‚ РґРѕСЃС‚СѓРїР°','Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№ РґРѕСЃС‚СѓРїРµРЅ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°Рј.'),'shift-entry':currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin'?shiftEntryPanel:()=>panel('РќРµС‚ РґРѕСЃС‚СѓРїР°','Р’РІРѕРґ СЃРјРµРЅС‹ РґРѕСЃС‚СѓРїРµРЅ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.')};$('#content').innerHTML=pages[currentPage]();document.querySelectorAll('[data-area]').forEach(b=>b.addEventListener('click',()=>{selectedArea=b.dataset.area;render();}));renderTips();bindР”РµР№СЃС‚РІРёРµControls();if($('#demo-simulate'))$('#demo-simulate').addEventListener('click',()=>$('#shift-button').click());if($('#output-chart')){renderChart();$('#chart-period').addEventListener('change',event=>{chartPeriod=event.target.value;renderChart();});}if($('#event-list'))renderEvents();if($('#plan-list')){renderPlan();$('#apply-plan-button').addEventListener('click',applyPlan);}bindAccountForms();if($('#asset-form'))bindAssetForm();if($('#new-asset-button'))$('#new-asset-button').addEventListener('click',()=>{$('#asset-form').reset();$('#asset-form [name=id]').value='';$('#asset-form').scrollIntoView({behavior:'smooth'});});document.querySelectorAll('[data-edit-asset]').forEach(button=>button.addEventListener('click',()=>{const asset=state.equipment.find(item=>item.id===Number(button.dataset.editAsset));const form=$('#asset-form');for(const [key,value] of Object.entries(asset))if(form.elements[key])form.elements[key].value=value??'';form.scrollIntoView({behavior:'smooth'});}));}
async function applyPlan(){await busy($('#apply-plan-button'),async()=>{for(const item of state.plan.allocations){await api(`/api/plans/${item.id}`,{method:'PUT',body:JSON.stringify({model:item.model,monthly_plan:item.suggested})});}await api('/api/event-note',{method:'POST',body:JSON.stringify({title:'РњРµСЃСЏС‡РЅС‹Р№ РїР»Р°РЅ СЃРєРѕСЂСЂРµРєС‚РёСЂРѕРІР°РЅ',details:{new_total:state.plan.target}})});await refresh();toast('РџР»Р°РЅ РѕР±РЅРѕРІР»С‘РЅ');});}
function renderPlan() {
  const plan = state.plan;
  $('#plan-total').textContent = ru.format(plan.current_total);
  $('#plan-gap').textContent = plan.gap ? `\u041d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 ${ru.format(plan.gap)} \u043c\u0430\u0448\u0438\u043d` : '\u0426\u0435\u043b\u0435\u0432\u043e\u0439 \u043e\u0431\u044a\u0451\u043c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442';
  $('#plan-progress-fill').style.width = `${Math.min(100, plan.current_total / plan.target * 100)}%`;
  $('#plan-list').innerHTML = plan.allocations.map((item) => `<div class="plan-row"><span>${esc(item.model)}</span><div><div class="plan-bar"><i style="width:${plan.current_total ? item.current / plan.current_total * 100 : 0}%"></i></div>${item.additional ? `<div class="plan-add">+${ru.format(item.additional)} \u043f\u043e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044e</div>` : ''}</div><strong>${ru.format(item.current)}</strong></div>`).join('');
  const button = $('#apply-plan-button');
  button.disabled = !plan.gap || currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
  button.hidden = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
  button.textContent = plan.gap ? `\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435 +${ru.format(plan.gap)}` : '\u0426\u0435\u043b\u044c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442\u0430';
}

function renderEvents() {
  $('#event-list').innerHTML = state.events.length ? state.events.map((event) => {
    const when = new Date(event.created_at);
    const time = Number.isNaN(when.getР’СЂРµРјСЏ()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(when);
    const details = Object.entries(event.details || {}).map(([key, value]) => key==='comparison' ? Object.entries(value).map(([metric,item])=>`${esc(metric)} ${ru.format(item.before)} в†’ ${ru.format(item.after)}`).join(' В· ') : `${esc(key)}: ${esc(value)}`).join(' В· ');
    const icon = event.severity === 'critical' ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : event.severity === 'warning' ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>' : '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    return `<div class="event-row"><span class="event-icon ${esc(event.severity)}">${icon}</span><div class="event-copy"><b>${esc(event.title)}</b><p>${details || esc(event.event_type)}</p></div><time class="event-time">${time}</time></div>`;
  }).join('') : '<div class="event-empty">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0438\u043c\u0443\u043b\u044f\u0446\u0438\u044e \u0441\u043c\u0435\u043d\u044b.</div>';
}

const chartColors = ['#007bc1', '#8293a8', '#001e50'];
function renderChart() {
  const host = $('#output-chart');
  if (!host) return;
  const area = reportFilters.area || (currentPage === 'home' && selectedArea ? selectedArea : 'РЎР±РѕСЂРєР°');
  let rows = state.lines.filter(row => row.line.startsWith(area)).sort((a,b) => a.work_date.localeCompare(b.work_date));
  const totals = new Map();
  for (const row of rows) totals.set(row.work_date,(totals.get(row.work_date)||0)+row.actual_units);
  let values = [...totals].map(([date,units])=>({date,units}));
  if (chartPeriod !== 'all' && values.length) {
    const last = new Date(values[values.length-1].date+'T12:00:00Z');
    const cutoff = new Date(last); cutoff.setUTCDate(cutoff.getUTCDate()-Number(chartPeriod)+1);
    values = values.filter(v=>new Date(v.date+'T12:00:00Z')>=cutoff);
  }
  if (!values.length) {host.innerHTML='<div class="chart-empty">РќРµС‚ РґР°РЅРЅС‹С… Р·Р° РІС‹Р±СЂР°РЅРЅС‹Р№ РїРµСЂРёРѕРґ</div>';$('#chart-legend').textContent='';return;}
  const width=440,height=220,left=40,right=16,top=15,bottom=36;
  const w=width-left-right,h=height-top-bottom;
  const max=Math.max(30,Math.ceil(Math.max(...values.map(v=>v.units))/30)*30);
  const x=i=>left+(values.length===1?w/2:i*w/(values.length-1));
  const y=v=>top+h-v/max*h;
  let grid='';
  for(let i=0;i<=4;i++){const yy=top+h-i*h/4;grid+=`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" class="chart-grid"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${ru.format(max*i/4)}</text>`;}
  const labelEvery=Math.max(1,Math.ceil(values.length/6));
  values.forEach((v,i)=>{if(i%labelEvery===0 || i===values.length-1){const xx=x(i);grid+=`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${top+h}" class="chart-grid"/><text x="${xx}" y="${height-12}" text-anchor="middle">${esc(dateLabel(v.date,{day:'2-digit',month:'2-digit'}))}</text>`;}});
  const path=values.map((v,i)=>`${i?'L':'M'}${x(i)},${y(v.units)}`).join(' ');
  const points=values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v.units)}" r="3" class="chart-point"><title>${esc(dateLabel(v.date))}: ${ru.format(v.units)} Р°РІС‚Рѕ</title></circle>`).join('');
  host.setAttribute('aria-label',`Р’С‹РїСѓСЃРє: ${area}. ${values.map(v=>`${v.date}: ${v.units} Р°РІС‚Рѕ`).join('; ')}`);
  host.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="presentation" aria-hidden="true">${grid}<path d="${path}" class="chart-line"/>${points}</svg>`;
  $('#chart-legend').innerHTML=`<span><i style="background:var(--blue)"></i>${esc(area)} В· Р°РІС‚РѕРјРѕР±РёР»РµР№ РІ РґРµРЅСЊ</span>`;
}

async function busy(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

const dialog = $('#scenario-dialog');
$('#shift-button').addEventListener('click', () => {dialog.querySelector('.scenario-options').hidden=false;$('#simulation-comparison').hidden=true;dialog.querySelector('p').hidden=false;dialog.showModal();});
dialog.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', async () => {
  dialog.close();
  await busy($('#shift-button'), async () => {
    const result=await api('/api/simulation/shift', { method: 'POST', body: JSON.stringify({ scenario: button.dataset.scenario }) });
    await refresh();
    const impact=result.estimated_impact||{};const impactCard=`<article class="impact-estimate"><b>${esc(impact.label||'РћС†РµРЅРєР° СЌС„С„РµРєС‚Р° СЃС†РµРЅР°СЂРёСЏ')}</b><p>${esc(impact.basis||'Р Р°СЃС‡С‘С‚ РѕСЃРЅРѕРІР°РЅ РЅР° РїР°СЂР°РјРµС‚СЂР°С… СЃС†РµРЅР°СЂРёСЏ Рё СѓРєР°Р·Р°РЅРЅС‹С… РґРѕРїСѓС‰РµРЅРёСЏС….')}</p>${impact.estimated_downtime_hours!==undefined?`<strong>${ru.format(impact.estimated_downtime_hours)} С‡ РїСЂРѕСЃС‚РѕСЏ | ${ru.format(impact.estimated_recovered_units_per_shift)} С€С‚. РІРѕР·РјРѕР¶РЅРѕРіРѕ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ РІС‹РїСѓСЃРєР°</strong>`:''}${impact.estimated_preventable_defects!==undefined?`<strong>${ru.format(impact.estimated_preventable_defects)} РїРѕС‚РµРЅС†РёР°Р»СЊРЅРѕ РїСЂРµРґРѕС‚РІСЂР°С‰Р°РµРјС‹С… РґРµС„РµРєС‚РѕРІ</strong>`:''}</article>`;
    const labels={actual_units:'Р’С‹РїСѓСЃРє, Р°РІС‚Рѕ',oee_percent:'OEE, %',defect_rate_percent:'Р‘СЂР°Рє, %',downtime_minutes:'РџСЂРѕСЃС‚РѕР№, РјРёРЅ'};
    $('#simulation-comparison').innerHTML=`<h3>Р РµР·СѓР»СЊС‚Р°С‚ СЃРјРµРЅС‹ В· ${esc(dateLabel(result.date))}</h3><p>РЎСЂР°РІРЅРµРЅРёРµ СЃ РїСЂРµРґС‹РґСѓС‰РµР№ СЃРјРµРЅРѕР№</p><div class="table-wrap"><table><thead><tr><th>РџРѕРєР°Р·Р°С‚РµР»СЊ</th><th>Р”Рѕ</th><th>РџРѕСЃР»Рµ</th><th>РР·РјРµРЅРµРЅРёРµ</th></tr></thead><tbody>${Object.entries(result.comparison).map(([key,v])=>`<tr><td>${labels[key]}</td><td>${ru.format(v.before)}</td><td>${ru.format(v.after)}</td><td>${v.change>0?'+':''}${ru.format(v.change)}</td></tr>`).join('')}</tbody></table></div><article class="insight"><div><b>Р РµРєРѕРјРµРЅРґР°С†РёСЏ:</b> ${esc(result.recommendation.action)}<p><b>РћР¶РёРґР°РµРјС‹Р№ СЌС„С„РµРєС‚:</b> ${esc(result.recommendation.expected_effect)}</p></div></article>${impactCard}<button type="button" id="comparison-close">Р—Р°РєСЂС‹С‚СЊ</button>`;
    $('#simulation-comparison').hidden=false;dialog.querySelector('.scenario-options').hidden=true;dialog.querySelector('p').hidden=true;dialog.showModal();$('#comparison-close').addEventListener('click',()=>dialog.close());
    toast('РЎРјРµРЅР° РґРѕР±Р°РІР»РµРЅР°, СЃСЂР°РІРЅРµРЅРёРµ РїРѕРєР°Р·Р°С‚РµР»РµР№ РіРѕС‚РѕРІРѕ');
  });
}));

$('#reset-button').addEventListener('click', async () => busy($('#reset-button'), async () => {
  await api('/api/simulation/reset', { method: 'POST' }); await refresh();
  toast('\u0414\u0435\u043c\u043e \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0435\u043d\u043e \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u0434\u0430\u043d\u043d\u044b\u043c');
}));
$('#refresh-button').addEventListener('click', refresh);
$('#apply-filters').addEventListener('click',()=>{reportFilters={start_date:$('#filter-start').value,end_date:$('#filter-end').value,area:$('#filter-area').value};if(reportFilters.start_date&&reportFilters.end_date&&reportFilters.start_date>reportFilters.end_date){toast('РќР°С‡Р°Р»СЊРЅР°СЏ РґР°С‚Р° РїРѕР·Р¶Рµ РєРѕРЅРµС‡РЅРѕР№');return;}syncExportLink();refresh();});
$('#clear-filters').addEventListener('click',()=>{$('#filter-start').value='';$('#filter-end').value='';$('#filter-area').value='';reportFilters={start_date:'',end_date:'',area:''};syncExportLink();refresh();});
let resizeР’СЂРµРјСЏr;
window.addEventListener('resize', () => { clearTimeout(resizeР’СЂРµРјСЏr); resizeР’СЂРµРјСЏr = setTimeout(() => {if (state.lines && $('#output-chart')) renderChart();}, 100); });
window.addEventListener('hashchange', () => { currentPage = ['home','production','equipment','incidents','analytics','ai','cabinet','profile','shift-entry','demo','audit','actions','forecast'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home'; if(state.dashboard) render(); });
boot();


function roleLabel(role) { return role === 'admin' ? 'РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ' : 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ'; }
function updateIdentity() {
  $('#header-name').textContent = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name;
  $('#dropdown-name').textContent = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name;
  $('#dropdown-role').textContent = roleLabel(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role);
  $('#avatar-initials').textContent = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name.trim().split(/\s+/).slice(0,2).map(word => [...word][0]).join('').toUpperCase();
  $('#shift-button').hidden = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
  $('#reset-button').hidden = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
  $('#shift-entry-link').hidden = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
  $('#audit-link').hidden = currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role !== 'admin';
}
function accountSummary() {
  const k=state.dashboard.kpis;
  return `<div class="account-stats"><article><span>Р’С‹РїСѓСЃРє Р·Р° РїРµСЂРёРѕРґ</span><strong>${ru.format(k.actual_units)} <small>Р°РІС‚Рѕ</small></strong></article><article><span>OEE</span><strong>${ru.format(k.oee_percent)}<small>%</small></strong></article><article><span>РљР°С‡РµСЃС‚РІРѕ</span><strong>${ru.format(100-k.defect_rate_percent)}<small>%</small></strong></article></div>`;
}
function cabinetPanel() {
  const isAdmin=currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin';
  const greeting=panel(`<i class="fa-solid fa-table-columns" aria-hidden="true"></i> ${isAdmin?'РљР°Р±РёРЅРµС‚ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°':'РљР°Р±РёРЅРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ'}`,`<div class="cabinet-welcome"><span class="role-badge">${roleLabel(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role)}</span><h1>Р—РґСЂР°РІСЃС‚РІСѓР№С‚Рµ, ${esc(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name)}!</h1><p class="muted">${isAdmin?'РЈРїСЂР°РІР»СЏР№С‚Рµ РґРѕСЃС‚СѓРїРѕРј РєРѕРјР°РЅРґС‹ Рё РєРѕРЅС‚СЂРѕР»РёСЂСѓР№С‚Рµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ.':'РЎР»РµРґРёС‚Рµ Р·Р° РїРѕРєР°Р·Р°С‚РµР»СЏРјРё Р·Р°РІРѕРґР° Рё СѓРїСЂР°РІР»СЏР№С‚Рµ СЃРІРѕРёРј РїСЂРѕС„РёР»РµРј.'}</p></div>${accountSummary()}<div class="account-links"><a href="#home"><i class="fa-solid fa-map" aria-hidden="true"></i> РљР°СЂС‚Р° Р·Р°РІРѕРґР°</a><a href="#production"><i class="fa-solid fa-car" aria-hidden="true"></i> РџСЂРѕРёР·РІРѕРґСЃС‚РІРѕ</a><a href="#profile"><i class="fa-solid fa-user" aria-hidden="true"></i> РњРѕР№ РїСЂРѕС„РёР»СЊ</a></div>`);
  if(!isAdmin) return greeting+panel('<i class="fa-solid fa-user" aria-hidden="true"></i> Р’Р°С€ Р°РєРєР°СѓРЅС‚',`<dl class="account-details"><div><dt>Р›РѕРіРёРЅ</dt><dd>${esc(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.username)}</dd></div><div><dt>Р”РѕСЃС‚СѓРї</dt><dd>РџСЂРѕСЃРјРѕС‚СЂ РїРѕРєР°Р·Р°С‚РµР»РµР№ Рё Р°РЅР°Р»РёС‚РёРєРё</dd></div><div><dt>РЎС‚Р°С‚СѓСЃ</dt><dd><span class="pill good">РђРєС‚РёРІРµРЅ</span></dd></div></dl><p class="muted">Р”Р»СЏ РёР·РјРµРЅРµРЅРёСЏ РїСЂРѕРёР·РІРѕРґСЃС‚РІРµРЅРЅС‹С… РґР°РЅРЅС‹С… РѕР±СЂР°С‚РёС‚РµСЃСЊ Рє Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.</p>`);
  return greeting+panel('<i class="fa-solid fa-users" aria-hidden="true"></i> РЈРїСЂР°РІР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё',`<div tabindex="0" aria-label="РўР°Р±Р»РёС†Р°, РїСЂРѕРєСЂСѓС‚РєР° РїРѕ РіРѕСЂРёР·РѕРЅС‚Р°Р»Рё" class="table-wrap users-table"><table><thead><tr><th>РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ</th><th>Р›РѕРіРёРЅ</th><th>Р РѕР»СЊ</th><th>РЎС‚Р°С‚СѓСЃ</th><th>Р”РµР№СЃС‚РІРёРµ</th></tr></thead><tbody>${accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs.map(user=>`<tr><td>${esc(user.name)}</td><td>${esc(user.username)}</td><td>${roleLabel(user.role)}</td><td><span class="pill ${user.is_active?'good':'bad'}">${user.is_active?'РђРєС‚РёРІРµРЅ':'Р—Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ'}</span></td><td>${user.id===currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.id?'<span class="muted">Р’Р°С€ Р°РєРєР°СѓРЅС‚</span>':`<button data-toggle-user="${user.id}" data-active="${user.is_active?'0':'1'}">${user.is_active?'Р—Р°Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ':'РђРєС‚РёРІРёСЂРѕРІР°С‚СЊ'}</button> <button class="danger-button" data-delete-user="${user.id}">РЈРґР°Р»РёС‚СЊ</button>`}</td></tr>`).join('')}</tbody></table></div>`)+panel('<i class="fa-solid fa-user-plus" aria-hidden="true"></i> РЎРѕР·РґР°С‚СЊ Р°РєРєР°СѓРЅС‚',`<form id="create-user-form" class="account-form form-grid"><label>РРјСЏ<input name="name" required maxlength="100" autocomplete="off" placeholder="РРјСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"></label><label>Р›РѕРіРёРЅ<input name="username" required minlength="3" maxlength="80" pattern="[A-Za-z0-9_.@-]{3,80}" autocomplete="off" placeholder="Р›Р°С‚РёРЅСЃРєРёРµ Р±СѓРєРІС‹ Рё С†РёС„СЂС‹"></label><label>Р РѕР»СЊ<select name="role"><option value="user">РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ</option><option value="admin">РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ</option></select></label><label>Р’СЂРµРјРµРЅРЅС‹Р№ РїР°СЂРѕР»СЊ<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="РњРёРЅРёРјСѓРј 12 СЃРёРјРІРѕР»РѕРІ"></label><p class="form-error form-full" role="alert" hidden></p><div class="form-full"><button class="submit-button" type="submit">РЎРѕР·РґР°С‚СЊ Р°РєРєР°СѓРЅС‚</button></div></form>`);
}
function profilePanel() {
  return panel('<i class="fa-solid fa-user" aria-hidden="true"></i> РџСЂРѕС„РёР»СЊ',`<div class="profile-card"><span class="profile-large-avatar"><i class="fa-solid fa-user" aria-hidden="true"></i></span><div><h1>${esc(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name)}</h1><span class="role-badge">${roleLabel(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role)}</span></div></div><dl class="account-details"><div><dt>Р›РѕРіРёРЅ</dt><dd>${esc(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.username)}</dd></div><div><dt>РђРєРєР°СѓРЅС‚ СЃРѕР·РґР°РЅ</dt><dd>${new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium'}).format(new Date(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.created_at*1000))}</dd></div></dl><form id="profile-form" class="account-form"><label>РРјСЏ<input name="name" value="${esc(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.name)}" required maxlength="100" autocomplete="name"></label><p class="form-error" role="alert" hidden></p><button type="submit" class="submit-button">РЎРѕС…СЂР°РЅРёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ</button></form>`)+panel('<i class="fa-solid fa-lock" aria-hidden="true"></i> РЎРјРµРЅРёС‚СЊ РїР°СЂРѕР»СЊ',`<form id="password-form" class="account-form"><label>РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ<input name="current_password" type="password" required maxlength="128" autocomplete="current-password"></label><div class="form-grid"><label>РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ<input name="new_password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="РњРёРЅРёРјСѓРј 12 СЃРёРјРІРѕР»РѕРІ"></label><label>РџРѕРІС‚РѕСЂРёС‚Рµ РЅРѕРІС‹Р№ РїР°СЂРѕР»СЊ<input name="confirm_password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label></div><p class="form-error" role="alert" hidden></p><button type="submit" class="submit-button">РћР±РЅРѕРІРёС‚СЊ РїР°СЂРѕР»СЊ</button><p class="muted">РџРѕСЃР»Рµ СЃРјРµРЅС‹ РїР°СЂРѕР»СЏ РґСЂСѓРіРёРµ СЃРµСЃСЃРёРё СЌС‚РѕРіРѕ Р°РєРєР°СѓРЅС‚Р° Р·Р°РІРµСЂС€Р°С‚СЃСЏ.</p></form>`);
}
function bindForm(id, action) {
  const form=$(id);if(!form)return;
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type="submit"]'),error=form.querySelector('.form-error');error.hidden=true;button.disabled=true;
    try{await action(Object.fromEntries(new FormData(form)),form);}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}
  });
}
function bindAccountForms() {
  bindForm('#profile-form',async values=>{currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ=await api('/api/auth/profile',{method:'PATCH',body:JSON.stringify({name:values.name})});render();toast('РџСЂРѕС„РёР»СЊ РѕР±РЅРѕРІР»С‘РЅ');});
  bindForm('#password-form',async(values,form)=>{if(values.new_password!==values.confirm_password)throw new Error('РќРѕРІС‹Рµ РїР°СЂРѕР»Рё РЅРµ СЃРѕРІРїР°РґР°СЋС‚');await api('/api/auth/password',{method:'POST',body:JSON.stringify({current_password:values.current_password,new_password:values.new_password})});form.reset();toast('РџР°СЂРѕР»СЊ РёР·РјРµРЅС‘РЅ');});
  bindForm('#create-user-form',async values=>{await api('/api/admin/users',{method:'POST',body:JSON.stringify(values)});accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs=await api('/api/admin/users');render();toast('РђРєРєР°СѓРЅС‚ СЃРѕР·РґР°РЅ');});
  document.querySelectorAll('[data-toggle-user]').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{await api(`/api/admin/users/${button.dataset.toggleРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ}`,{method:'PATCH',body:JSON.stringify({is_active:button.dataset.active==='1'})});accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs=await api('/api/admin/users');render();toast('РЎС‚Р°С‚СѓСЃ Р°РєРєР°СѓРЅС‚Р° РѕР±РЅРѕРІР»С‘РЅ');})));
  document.querySelectorAll('[data-delete-user]').forEach(button=>button.addEventListener('click',()=>{if(!confirm('РЈРґР°Р»РёС‚СЊ Р°РєРєР°СѓРЅС‚? Р•РіРѕ Р°РєС‚РёРІРЅС‹Рµ СЃРµСЃСЃРёРё Р±СѓРґСѓС‚ Р·Р°РІРµСЂС€РµРЅС‹.'))return;busy(button,async()=>{await api(`/api/admin/users/${button.dataset.deleteРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ}`,{method:'DELETE'});accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs=await api('/api/admin/users');render();toast('РђРєРєР°СѓРЅС‚ СѓРґР°Р»С‘РЅ');});}));
  const csvForm=$('#csv-import-form');if(csvForm)csvForm.addEventListener('submit',async event=>{event.preventDefault();const error=csvForm.querySelector('.form-error'),button=csvForm.querySelector('[type=submit]'),file=csvForm.elements.csv_file.files[0];error.hidden=true;button.disabled=true;try{const result=await api('/api/import/csv',{method:'POST',body:JSON.stringify({content:await file.text()})});toast(`РРјРїРѕСЂС‚РёСЂРѕРІР°РЅРѕ СЃРјРµРЅ: ${result.count}`);await refresh();}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});
  const form=$('#shift-entry-form');if(form)form.addEventListener('submit',async event=>{event.preventDefault();const error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');error.hidden=true;button.disabled=true;try{const v=Object.fromEntries(new FormData(form));for(const key of ['planned_units','actual_units','operating_hours','elapsed_shift_hours','utilization_percent','produced','defects','downtime_minutes'])v[key]=Number(v[key]);v.is_critical=form.elements.is_critical.checked;await api('/api/shift-entry',{method:'POST',body:JSON.stringify(v)});toast('Р”Р°РЅРЅС‹Рµ СЃРјРµРЅС‹ СЃРѕС…СЂР°РЅРµРЅС‹');await refresh();}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});
}
function bindAssetForm(){const form=$('#asset-form');form.addEventListener('submit',async event=>{event.preventDefault();const error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');error.hidden=true;button.disabled=true;try{const v=Object.fromEntries(new FormData(form));const id=v.id;delete v.id;v.last_maintenance=v.last_maintenance||null;await api(id?`/api/equipment/${id}`:'/api/equipment',{method:id?'PUT':'POST',body:JSON.stringify(v)});await refresh();toast('РљР°СЂС‚РѕС‡РєР° РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ СЃРѕС…СЂР°РЅРµРЅР°');}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});}
function closeProfileMenu(){ $('#profile-dropdown').hidden=true;$('#profile-trigger').setAttribute('aria-expanded','false'); }
$('#profile-trigger').addEventListener('click',()=>{const open=$('#profile-dropdown').hidden;$('#profile-dropdown').hidden=!open;$('#profile-trigger').setAttribute('aria-expanded',String(open));});
document.addEventListener('click',event=>{if(!event.target.closest('.profile-menu'))closeProfileMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#profile-dropdown').hidden){closeProfileMenu();$('#profile-trigger').focus();}});
$('#profile-dropdown').querySelectorAll('a').forEach(link=>link.addEventListener('click',closeProfileMenu));
$('#logout-button').addEventListener('click',()=>busy($('#logout-button'),async()=>{await api('/api/auth/logout',{method:'POST'});location.replace('/login');}));
async function boot(){try{const session=await api('/api/auth/me');currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ=session.user;csrfToken=session.csrf_token;updateIdentity();if(currentРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ.role==='admin')accountРџРѕР»СЊР·РѕРІР°С‚РµР»СЊs=await api('/api/admin/users');await refresh();}catch(error){toast(error.message);}}


// Mobile drawer navigation: dismiss, focus containment and scroll locking.
const mobileNavigation = window.matchMedia('(max-width: 1023px)');
let drawerOpen = false;
function setDrawer(open, focusContent = false) {
  drawerOpen = Boolean(open && mobileNavigation.matches);
  const sidebar = $('#app-navigation');
  document.body.classList.toggle('drawer-open', drawerOpen);
  $('#menu-toggle').setAttribute('aria-expanded', String(drawerOpen));
  $('#menu-toggle').setAttribute('aria-label', drawerOpen ? 'Р—Р°РєСЂС‹С‚СЊ РјРµРЅСЋ' : 'РћС‚РєСЂС‹С‚СЊ РјРµРЅСЋ');
  $('#menu-backdrop').hidden = !drawerOpen;
  sidebar.inert = mobileNavigation.matches && !drawerOpen;
  if (mobileNavigation.matches) {
    sidebar.setAttribute('aria-hidden', String(!drawerOpen));
    sidebar.setAttribute('role', 'dialog');
    if (drawerOpen) sidebar.setAttribute('aria-modal', 'true');
    else sidebar.removeAttribute('aria-modal');
  } else {
    sidebar.removeAttribute('aria-hidden');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
  }
  [$('#content'), $('.kpi-sidebar'), $('.header .brand'), $('.profile-menu'), $('#menu-toggle')].forEach(el => { el.inert = drawerOpen; });
  if (drawerOpen) {closeProfileMenu();$('#menu-close').focus();}
  else if (focusContent) $('#content').focus({preventScroll:true});
  else if (mobileNavigation.matches) $('#menu-toggle').focus({preventScroll:true});
}
$('#menu-toggle').addEventListener('click', () => setDrawer(!drawerOpen));
$('#menu-close').addEventListener('click', () => setDrawer(false));
$('#menu-backdrop').addEventListener('click', () => setDrawer(false));
$('#app-navigation').querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => {
  if (drawerOpen) setDrawer(false, true);
}));
$('#shift-button').addEventListener('click', () => {if (drawerOpen) setDrawer(false);});
document.addEventListener('keydown', event => {
  if (!drawerOpen) return;
  if (event.key === 'Escape') {event.preventDefault();setDrawer(false);return;}
  if (event.key !== 'Tab') return;
  const items = [...$('#app-navigation').querySelectorAll('a[href],button:not([disabled])')].filter(el => !el.hidden && el.getClientRects().length);
  const first = items[0], last = items[items.length-1];
  if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
});
mobileNavigation.addEventListener('change', () => setDrawer(false));
// Set the initial visibility without moving focus when the page loads.
$('#app-navigation').inert = mobileNavigation.matches;
if (mobileNavigation.matches) {$('#app-navigation').setAttribute('aria-hidden','true');$('#app-navigation').setAttribute('role','dialog');}

