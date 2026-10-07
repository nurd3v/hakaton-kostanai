const $ = (selector) => document.querySelector(selector);
const ru = new Intl.NumberFormat('ru-RU');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AREA_NAMES = ['\u0421\u0432\u0430\u0440\u043a\u0430', '\u041e\u043a\u0440\u0430\u0441\u043a\u0430', '\u0421\u0431\u043e\u0440\u043a\u0430'];
let state = {};
let selectedArea = null;
let currentPage = ["home","production","equipment","incidents","analytics","ai"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
let toastTimer;
let chartPeriod = "all";

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `API request failed (${response.status})`);
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
  return raw ? new Intl.DateTimeFormat('ru-RU', options).format(new Date(`${raw}T12:00:00`)) : '—';
}

async function refresh() {
  try {
    const [dashboard, factory, lines, quality, downtime, plans, plan, tips, events] = await Promise.all([
      api('/api/dashboard'), api('/api/factory-state'), api('/api/lines'), api('/api/quality'),
      api('/api/downtimes'), api('/api/plans'), api('/api/plan-recommendation'),
      api('/api/recommendations'), api('/api/events?limit=8'),
    ]);
    state = { dashboard, factory, lines, quality, downtime, plans, plan, tips, events };
    render();
  } catch (error) { toast(error.message); if (!state.dashboard) { $('#content').innerHTML = '<section class="panel empty"><h2>Не удалось загрузить данные</h2><p>Проверьте, что сервер запущен, и нажмите «Обновить».</p></section>'; } }
}


const headings = {home:'Карта завода',production:'Производство',equipment:'Оборудование',incidents:'Аварии',analytics:'Аналитика',ai:'ИИ Анализ'};
const panel = (title, body, extra='') => `<section class="panel"><div class="panel-title"><h2>${title}</h2>${extra}</div><div class="rule"></div>${body}</section>`;
function stages(){return `<div class="stage-grid">${state.factory.areas.map(a=>`<button class="stage ${esc(a.status)} ${selectedArea===a.area?'selected':''}" data-area="${esc(a.area)}"><b>${a.status!=='normal'?'<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ':''}${esc(a.area)}</b><strong>${a.utilization_percent===null?'—':ru.format(a.utilization_percent)+'%'}</strong><small>${ru.format(a.actual_units)} авто</small></button>`).join('')}</div>`;}
function factoryPanel(){return panel('<i class="fa-solid '+(currentPage==='production'?'fa-car':'fa-map')+'" aria-hidden="true"></i> '+headings[currentPage=== 'production'?'production':'home'],`${currentPage==='production'?`<div class="subline">Последняя смена · ${esc(dateLabel(state.factory.date))}</div>`:''}${stages()}<div class="flow-stats"><span><b>В работе:</b> ${state.factory.areas.filter(a=>a.actual_units>0).length}/${state.factory.areas.length} участков</span><span><b>Выпуск сборки:</b> ${ru.format(state.factory.areas.find(a=>a.area==='Сборка')?.actual_units||0)} авто/смену</span><span><b>Отклонения:</b> ${state.factory.areas.filter(a=>a.status!=='normal').length}</span></div>`,`<span class="active-label">Активно</span>`);}
function shopPanel(){const a=state.factory.areas.find(a=>a.area===selectedArea);return panel('<i class="fa-solid fa-map" aria-hidden="true"></i> Карта цеха: '+(a?esc(a.area):'<span style="font-weight:400">Вы не выбрали цех</span>'),a?`${stages()}<div class="detail-title">${esc(a.line)}<small>${a.equipment.length?a.equipment.map(esc).join(', '):'Оборудование без зарегистрированных простоев'}</small></div><div class="metrics"><div class="metric"><strong>${a.utilization_percent===null?'—':ru.format(a.utilization_percent)+'%'}</strong><small>Загрузка</small></div><div class="metric"><strong>${ru.format(a.defect_rate_percent)}%</strong><small>Брак</small></div><div class="metric"><strong>${ru.format(a.downtime_minutes)} мин</strong><small>Простой</small></div></div><div class="detail-stats"><span><b>План:</b> ${ru.format(a.planned_units)} авто</span><span><b>Факт:</b> ${ru.format(a.actual_units)} авто</span><span><b>Температура / вибрация:</b> нет данных</span></div>`:'<div class="empty"><p>Вы не выбрали цех, пожалуйста, выберите цех на карте</p><div class="sad" aria-hidden="true"><i class="fa-solid fa-face-frown" aria-hidden="true"></i></div></div>');}
function chartPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> '+(currentPage==='production'?'Выпуск по дням':'Динамика'),'<div class="chart-wrap"><div id="output-chart" role="img" aria-label="График выпуска автомобилей"></div></div><div id="chart-legend" class="chart-legend"></div>',`<select id="chart-period" aria-label="Период графика"><option value="all" ${chartPeriod==='all'?'selected':''}>Весь период</option><option value="7" ${chartPeriod==='7'?'selected':''}>7 дней</option><option value="30" ${chartPeriod==='30'?'selected':''}>30 дней</option></select>`);}
function planFactPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> План / факт',`<div class="subline">Последняя смена · автомобили</div><div class="plan-fact">${state.factory.areas.map(a=>`<div class="fact-row"><div><b>${esc(a.area)}</b><span>${ru.format(a.actual_units)} / ${ru.format(a.planned_units)}</span></div><div class="fact-track"><span style="width:${a.planned_units?Math.max(0,Math.min(100,a.actual_units/a.planned_units*100)):0}%"></span></div></div>`).join('')}</div><div class="fact-legend"><i></i> Факт <i></i> План</div>`);}
function bottleneckPanel(){const areas=state.factory.areas.filter(a=>a.status!=='normal');return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> Узкие места',`<div class="bottlenecks">${areas.map(a=>`<article class="bottleneck ${esc(a.status)}"><div class="bottleneck-heading"><b>${esc(a.area)}</b><a href="#ai">Анализ →</a></div><div class="bottleneck-metrics"><span><small>Загрузка</small>${a.utilization_percent===null?'—':ru.format(a.utilization_percent)+'%'}</span><span><small>Простой</small>${ru.format(a.downtime_minutes)} мин</span><span><small>Брак</small>${ru.format(a.defect_rate_percent)}%</span></div></article>`).join('')||'<p class="muted">Отклонений на участках нет</p>'}</div>`);}
function tipsPanel(){return panel('<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ИИ Анализ',`<div id="insights-list"></div><div id="alert-box"></div><p class="muted">Рекомендации по порогам качества и простоев. Прогноз риска в API отсутствует.</p>`,`<a class="text-button" href="#ai">Подробнее</a>`);}
function eventsPanel(){return panel('<i class="fa-solid fa-list-ul" aria-hidden="true"></i> Последние события','<div id="event-list"></div>');}
function planPanel(){return panel('<i class="fa-solid fa-chart-line" aria-hidden="true"></i> План / факт',`<div class="plan-summary"><div><strong id="plan-total"></strong><span>автомобилей в месяц</span></div><div class="plan-gap" id="plan-gap"></div></div><div class="plan-progress"><div id="plan-progress-fill"></div></div><div id="plan-list"></div><button id="apply-plan-button">Применить предложение</button>`);}
function equipmentPanel(){const unique=[...new Map(state.downtime.map(d=>[d.area+'|'+d.equipment,d])).values()];return panel('<i class="fa-solid fa-gear" aria-hidden="true"></i> Оборудование',`<div class="subline">Оборудование из журнала простоев · ${unique.length} единиц</div><div class="metrics"><div class="metric"><strong>${ru.format(state.dashboard.kpis.average_utilization_percent)}%</strong><small>Средняя загрузка линий</small></div><div class="metric"><strong>${unique.length}</strong><small>В журнале</small></div><div class="metric"><strong>—</strong><small>Температура: нет данных</small></div></div>`,'<span class="active-label">Активно</span>')+panel('<i class="fa-solid fa-gears" aria-hidden="true"></i> Список оборудования',`<p class="muted">Полного реестра, здоровья оборудования и телеметрии в API нет. Ниже — записи о простоях.</p><div class="table-wrap"><table><thead><tr><th>Название</th><th>Участок</th><th>Последняя запись</th><th>Простой</th><th>Причина</th></tr></thead><tbody>${unique.map(d=>`<tr><td>${esc(d.equipment)}</td><td>${esc(d.area)}</td><td>${esc(dateLabel(d.work_date))}</td><td>${ru.format(d.duration_minutes)} мин</td><td>${esc(d.reason)}</td></tr>`).join('')||'<tr><td colspan="5">Нет записей о простоях оборудования</td></tr>'}</tbody></table></div>`);}
function incidentsPanel(){return panel('<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Аварии и простои',`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Оборудование</th><th>Причина</th><th>Простой</th><th>Уровень</th></tr></thead><tbody>${state.downtime.map(d=>`<tr><td>${esc(dateLabel(d.work_date))}</td><td>${esc(d.equipment)}<br><small>${esc(d.area)}</small></td><td>${esc(d.reason)}</td><td>${ru.format(d.duration_minutes)} мин</td><td><span class="pill ${d.is_critical?'bad':''}">${d.is_critical?'Критичный':'Обычный'}</span></td></tr>`).join('')||'<tr><td colspan="5">Простоев не зарегистрировано</td></tr>'}</tbody></table></div>`)+eventsPanel();}
function renderTips(){if(!$('#insights-list'))return;$('#insights-list').innerHTML=state.tips.map(t=>`<article class="insight ${esc(t.priority)}"><span class="insight-mark"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span><div><h3>${esc(t.title)}</h3><p>${esc(t.reason)}</p><p><b>Рекомендация:</b> ${esc(t.action)}</p></div></article>`).join(''); const alerts=state.dashboard.alerts;$('#alert-box').className='alert-box'+(alerts.length?' has-alert':'');$('#alert-box').textContent=alerts.length?alerts.map(a=>a.message).join(' · '):'Критичных предупреждений нет';}
function render(){const k=state.dashboard.kpis;$('#kpi-output').textContent=ru.format(k.actual_units);$('#kpi-oee').textContent=ru.format(k.oee_percent)+'%';$('#kpi-downtime').textContent=ru.format(k.downtime_minutes)+' мин';$('#kpi-quality').textContent=ru.format(100-k.defect_rate_percent)+'%';document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===currentPage);if(a.dataset.page===currentPage)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
const pages={home:()=>factoryPanel()+shopPanel()+(selectedArea?'<div class="cols">'+chartPanel()+tipsPanel()+'</div>':tipsPanel()),production:()=>factoryPanel()+'<div class="cols">'+chartPanel()+planFactPanel()+'</div><div class="cols production-bottom">'+eventsPanel()+bottleneckPanel()+'</div>',equipment:equipmentPanel,incidents:incidentsPanel,analytics:()=>chartPanel()+planPanel(),ai:()=>tipsPanel()+eventsPanel()};$('#content').innerHTML=pages[currentPage]();document.querySelectorAll('[data-area]').forEach(b=>b.addEventListener('click',()=>{selectedArea=b.dataset.area;render();}));renderTips();if($('#output-chart')){renderChart();$('#chart-period').addEventListener('change',event=>{chartPeriod=event.target.value;renderChart();});}if($('#event-list'))renderEvents();if($('#plan-list')){renderPlan();$('#apply-plan-button').addEventListener('click',applyPlan);}}
async function applyPlan(){await busy($('#apply-plan-button'),async()=>{for(const item of state.plan.allocations){await api(`/api/plans/${item.id}`,{method:'PUT',body:JSON.stringify({model:item.model,monthly_plan:item.suggested})});}await api('/api/event-note',{method:'POST',body:JSON.stringify({title:'Месячный план скорректирован',details:{new_total:state.plan.target}})});await refresh();toast('План обновлён');});}
function renderPlan() {
  const plan = state.plan;
  $('#plan-total').textContent = ru.format(plan.current_total);
  $('#plan-gap').textContent = plan.gap ? `\u041d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 ${ru.format(plan.gap)} \u043c\u0430\u0448\u0438\u043d` : '\u0426\u0435\u043b\u0435\u0432\u043e\u0439 \u043e\u0431\u044a\u0451\u043c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442';
  $('#plan-progress-fill').style.width = `${Math.min(100, plan.current_total / plan.target * 100)}%`;
  $('#plan-list').innerHTML = plan.allocations.map((item) => `<div class="plan-row"><span>${esc(item.model)}</span><div><div class="plan-bar"><i style="width:${plan.current_total ? item.current / plan.current_total * 100 : 0}%"></i></div>${item.additional ? `<div class="plan-add">+${ru.format(item.additional)} \u043f\u043e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044e</div>` : ''}</div><strong>${ru.format(item.current)}</strong></div>`).join('');
  const button = $('#apply-plan-button');
  button.disabled = !plan.gap;
  button.textContent = plan.gap ? `\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435 +${ru.format(plan.gap)}` : '\u0426\u0435\u043b\u044c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442\u0430';
}

function renderEvents() {
  $('#event-list').innerHTML = state.events.length ? state.events.map((event) => {
    const when = new Date(event.created_at);
    const time = Number.isNaN(when.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(when);
    const details = Object.entries(event.details || {}).map(([key, value]) => `${esc(key)}: ${esc(value)}`).join(' · ');
    const icon = event.severity === 'critical' ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : event.severity === 'warning' ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>' : '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    return `<div class="event-row"><span class="event-icon ${esc(event.severity)}">${icon}</span><div class="event-copy"><b>${esc(event.title)}</b><p>${details || esc(event.event_type)}</p></div><time class="event-time">${time}</time></div>`;
  }).join('') : '<div class="event-empty">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0438\u043c\u0443\u043b\u044f\u0446\u0438\u044e \u0441\u043c\u0435\u043d\u044b.</div>';
}

const chartColors = ['#007bc1', '#8293a8', '#001e50'];
function renderChart() {
  const host = $('#output-chart');
  if (!host) return;
  const area = currentPage === 'home' && selectedArea ? selectedArea : 'Сборка';
  let rows = state.lines.filter(row => row.line.startsWith(area)).sort((a,b) => a.work_date.localeCompare(b.work_date));
  const totals = new Map();
  for (const row of rows) totals.set(row.work_date,(totals.get(row.work_date)||0)+row.actual_units);
  let values = [...totals].map(([date,units])=>({date,units}));
  if (chartPeriod !== 'all' && values.length) {
    const last = new Date(values[values.length-1].date+'T12:00:00Z');
    const cutoff = new Date(last); cutoff.setUTCDate(cutoff.getUTCDate()-Number(chartPeriod)+1);
    values = values.filter(v=>new Date(v.date+'T12:00:00Z')>=cutoff);
  }
  if (!values.length) {host.innerHTML='<div class="chart-empty">Нет данных за выбранный период</div>';$('#chart-legend').textContent='';return;}
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
  const points=values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v.units)}" r="3" class="chart-point"><title>${esc(dateLabel(v.date))}: ${ru.format(v.units)} авто</title></circle>`).join('');
  host.setAttribute('aria-label',`Выпуск: ${area}. ${values.map(v=>`${v.date}: ${v.units} авто`).join('; ')}`);
  host.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="presentation" aria-hidden="true">${grid}<path d="${path}" class="chart-line"/>${points}</svg>`;
  $('#chart-legend').innerHTML=`<span><i style="background:var(--blue)"></i>${esc(area)} · автомобилей в день</span>`;
}

async function busy(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

const dialog = $('#scenario-dialog');
$('#shift-button').addEventListener('click', () => dialog.showModal());
dialog.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', async () => {
  dialog.close();
  await busy($('#shift-button'), async () => {
    await api('/api/simulation/shift', { method: 'POST', body: JSON.stringify({ scenario: button.dataset.scenario }) });
    await refresh();
    toast('\u0421\u043c\u0435\u043d\u0430 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430 \u0432 \u0446\u0438\u0444\u0440\u043e\u0432\u043e\u0439 \u0434\u0432\u043e\u0439\u043d\u0438\u043a');
  });
}));

$('#reset-button').addEventListener('click', async () => busy($('#reset-button'), async () => {
  await api('/api/simulation/reset', { method: 'POST' }); await refresh();
  toast('\u0414\u0435\u043c\u043e \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0435\u043d\u043e \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u0434\u0430\u043d\u043d\u044b\u043c');
}));
$('#refresh-button').addEventListener('click', refresh);
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {if (state.lines && $('#output-chart')) renderChart();}, 100); });
window.addEventListener('hashchange', () => { currentPage = ['home','production','equipment','incidents','analytics','ai'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home'; if(state.dashboard) render(); });
refresh();
