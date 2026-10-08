const $ = (selector) => document.querySelector(selector);
const ru = new Intl.NumberFormat('ru-RU');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AREA_NAMES = ['\u0421\u0432\u0430\u0440\u043a\u0430', '\u041e\u043a\u0440\u0430\u0441\u043a\u0430', '\u0421\u0431\u043e\u0440\u043a\u0430'];
let state = {};
let currentПользователь = null;
let csrfToken = "";
let accountПользовательs = [];
let selectedArea = null;
let currentPage = ["home","production","equipment","incidents","analytics","ai","cabinet","profile","shift-entry","demo","audit","actions","forecast"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
let toastВремяr;
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
  if (response.status === 401) { location.replace('/login'); throw new Error('Сессия завершена. Войдите снова.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Проверьте введённые данные');
  }
  return response.status === 204 ? null : response.json();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearВремяout(toastВремяr);
  toastВремяr = setВремяout(() => el.classList.remove('show'), 2600);
}

function dateLabel(raw, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return raw ? new Intl.DateTimeFormat('ru-RU', options).format(new Date(`${raw}T12:00:00`)) : '—';
}

async function refresh() {
  try {
    const filtered = (path) => api(withFilters(path));
    const auditPromise = currentПользователь?.role === 'admin' ? api('/api/admin/audit?limit=100') : Promise.resolve([]);
    const [dashboard, factory, lines, quality, downtime, plans, plan, tips, events, equipment, maintenanceAlerts, audit, actions, forecast] = await Promise.all([
      filtered('/api/dashboard'), filtered('/api/factory-state'), filtered('/api/lines'), filtered('/api/quality'),
      filtered('/api/downtimes'), api('/api/plans'), api('/api/plan-recommendation'),
      filtered('/api/recommendations'), api('/api/events?limit=8'), filtered('/api/equipment'),
      api('/api/maintenance/alerts'), auditPromise, api('/api/actions'), api('/api/production-forecast'),
    ]);
    state = { dashboard, factory, lines, quality, downtime, plans, plan, tips, events, equipment, maintenanceAlerts, audit, actions, forecast };
    render();
  } catch (error) { toast(error.message); if (!state.dashboard) { $('#content').innerHTML = '<section class="panel empty"><h2>Не удалось загрузить данные</h2><p>Проверьте, что сервер запущен, и нажмите «Обновить».</p></section>'; } }
}


const headings = {home:'Карта завода',production:'Производство',equipment:'Оборудование',incidents:'Аварии',analytics:'Аналитика',ai:'ИИ Анализ','shift-entry':'Внести смену'};
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
function equipmentPanel(){const history=state.downtime;return panel('<i class="fa-solid fa-gear" aria-hidden="true"></i> Реестр оборудования',`<div class="subline">Состояние, плановое обслуживание и накопленные простои</div><div tabindex="0" class="table-wrap"><table><thead><tr><th>Оборудование</th><th>Участок</th><th>Состояние</th><th>Последнее ТО</th><th>Следующее ТО</th><th>Простой всего</th><th>Заметки</th>${currentПользователь.role==='admin'?'<th></th>':''}</tr></thead><tbody>${state.equipment.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.area)}</td><td><span class="pill ${a.status==='working'?'good':'bad'}">${a.status==='working'?'В работе':a.status==='maintenance'?'На ТО':'Остановлено'}</span></td><td>${esc(dateLabel(a.last_maintenance))}</td><td>${esc(dateLabel(a.next_maintenance))}</td><td>${ru.format(a.total_downtime_minutes)} мин</td><td>${esc(a.notes)}</td>${currentПользователь.role==='admin'?`<td><button data-edit-asset="${a.id}">Изменить</button></td>`:''}</tr>`).join('')||'<tr><td colspan="8">Реестр пуст</td></tr>'}</tbody></table></div>`,currentПользователь.role==='admin'?'<button id="new-asset-button">Добавить оборудование</button>':'')+panel('<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> История поломок',`<div tabindex="0" class="table-wrap"><table><thead><tr><th>Дата</th><th>Оборудование</th><th>Участок</th><th>Причина</th><th>Простой</th></tr></thead><tbody>${history.map(d=>`<tr><td>${esc(dateLabel(d.work_date))}</td><td>${esc(d.equipment)}</td><td>${esc(d.area)}</td><td>${esc(d.reason)}</td><td>${ru.format(d.duration_minutes)} мин</td></tr>`).join('')||'<tr><td colspan="5">Нет зарегистрированных поломок за выбранный период</td></tr>'}</tbody></table></div>`)+(currentПользователь.role==='admin'?panel('<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i> Карточка оборудования',`<form id="asset-form" class="account-form form-grid"><input type="hidden" name="id"><label>Название<input name="name" required maxlength="100"></label><label>Участок<select name="area" required>${AREA_NAMES.map(a=>`<option>${a}</option>`).join('')}</select></label><label>Состояние<select name="status"><option value="working">В работе</option><option value="maintenance">На ТО</option><option value="stopped">Остановлено</option></select></label><label>Последнее ТО<input name="last_maintenance" type="date"></label><label>Следующее ТО<input name="next_maintenance" type="date" required></label><label>Заметки<input name="notes" maxlength="500"></label><p class="form-error form-full" role="alert" hidden></p><button class="submit-button" type="submit">Сохранить оборудование</button></form>`):'');}
function maintenanceAlertsPanel(){const items=state.maintenanceAlerts?.items||[];return panel('Напоминания о ТО',items.length?`<div class="maintenance-alerts">${items.map(item=>`<article class="maintenance-alert ${item.urgency==='overdue'?'overdue':''}"><b>${esc(item.name)}</b><span>${esc(item.area)}</span><strong>${item.days_remaining<0?`Просрочено на ${Math.abs(item.days_remaining)} дн.`:item.days_remaining===0?'Срок сегодня':`ТО через ${item.days_remaining} дн.`}</strong></article>`).join('')}</div>`:'<p class="muted">No maintenance due in the next 14 дн..</p>');}
function demoPanel(){return panel('Демо для жюри',`<ol class="demo-steps"><li><b>Обзор завода.</b> Покажите выпуск, качество и загрузку на главной странице.</li><li><b>Найдите риск.</b> Откройте аналитику и рекомендации системы.</li><li><b>Проверьте сценарий.</b> Смоделируйте сбой оборудования и сравните показатели.</li><li><b>Покажите рабочие инструменты.</b> Откройте прогноз смены, объясните его исходные данные и назначьте ответственного в центре действий.</li></ol>${currentПользователь.role==='admin'?'<button id="demo-simulate" class="submit-button">Смоделировать сбой</button>':'<p class="muted">Запуск симуляции доступен администратору.</p>'}<p class="muted">Симуляция добавит демонстрационную смену и событие в базу данных.</p>`);}
function auditPanel(){const entries=state.audit||[];return panel('Журнал действий',`<div tabindex="0" class="table-wrap"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Раздел</th><th>ID</th></tr></thead><tbody>${entries.map(entry=>`<tr><td>${esc(new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.created_at*1000)))}</td><td>${esc(entry.actor_username)}</td><td>${esc(entry.action)}</td><td>${esc(entry.entity_type)}</td><td>${esc(entry.entity_id||'?')}</td></tr>`).join('')||'<tr><td colspan="5">Записей пока нет</td></tr>'}</tbody></table></div>`);}
function actionsPanel(){const items=state.actions||[];return panel('Действие center',items.length?`<div class="action-list">${items.map(item=>`<article class="action-card ${esc(item.priority)} ${item.status==='resolved'?'resolved':''}"><div class="action-head"><span class="pill ${esc(item.priority)}">${esc(item.priority)}</span><span class="muted">${item.active?'Сигнал активен':'Сигнал устранён'} ? ${esc(item.source_type)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.reason)}</p><p><b>Следующий шаг:</b> ${esc(item.recommended_action)}</p>${item.area?`<span class="muted">Участок: ${esc(item.area)}</span>`:''}<div class="action-controls"><label>Status<select data-action-status="${item.id}"><option value="new" ${item.status==='new'?'selected':''}>Новая</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>В работе</option><option value="resolved" ${item.status==='resolved'?'selected':''}>Решена</option></select></label><label>Ответственный<input data-action-owner="${item.id}" maxlength="100" value="${esc(item.assigned_to)}" placeholder="Имя сотрудника"></label><button data-save-action="${item.id}">Сохранить</button></div></article>`).join('')}`:'<p class="muted">Сейчас нет активных производственных задач.</p>');}
function forecastPanel(){const forecast=state.forecast||{},items=forecast.areas||[];const statusLabel={on_track:'По плану',at_risk:'Риск отставания',no_data:'Недостаточно данных'};return panel('Прогноз выпуска за смену',`${items.length?`<div class="forecast-grid">${items.map(item=>`<article class="forecast-card ${esc(item.status)}"><div><b>${esc(item.area)}</b><span class="pill ${item.status==='on_track'?'good':'bad'}">${statusLabel[item.status]}</span></div><p>Факт: ${ru.format(item.actual_units)} / план ${ru.format(item.planned_units)}</p><strong>${item.projected_units===null?'N/A':ru.format(item.projected_units)} шт. ожидается</strong><p>Возможное отставание от плана: ${item.projected_gap===null?'N/A':ru.format(item.projected_gap)} шт.</p><small>Прошло: ${ru.format(item.elapsed_shift_hours)} ч | Источник: ${esc(item.data_sources.join(', '))} | Качество данных: ${item.data_quality}</small></article>`).join('')}</div>`:'<p class="muted">Нет записей о сменах для расчёта прогноза.</p>'}<div class="forecast-method"><b>Метод расчёта:</b> ${esc(forecast.method_label||'Линейный прогноз на 8-часовую смену')}<p>${esc(forecast.limitation||'')}</p><ul>${(forecast.assumptions||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul><small>Дата последней смены: ${esc(forecast.work_date||'нет данных')}. Это оценочный расчёт, а не машинное обучение.</small></div>`);}
function bindДействиеControls(){document.querySelectorAll('[data-save-action]').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{const id=button.dataset.saveДействие;await api(`/api/actions/${id}`,{method:'PATCH',body:JSON.stringify({status:$(`[data-action-status="${id}"]`).value,assigned_to:$(`[data-action-owner="${id}"]`).value})});await refresh();toast('Действие updated');})));}
function shiftEntryPanel(){return panel('<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Внести данные смены',`<p class="muted">Запись добавится в выпуск, качество и при наличии — в журнал простоев.</p><form id="shift-entry-form" class="account-form form-grid"><label>Дата<input name="work_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label><label>Участок<select name="area">${AREA_NAMES.map(a=>`<option ${reportFilters.area===a?'selected':''}>${a}</option>`).join('')}</select></label><label>План, шт.<input name="planned_units" type="number" min="0" value="120" required></label><label>Факт, шт.<input name="actual_units" type="number" min="0" value="120" required></label><label>Часы работы<input name="operating_hours" type="number" min="0" max="24" step="0.1" value="8" required></label><label>Сколько часов смены прошло<input name="elapsed_shift_hours" type="number" min="0" max="8" step="0.25" value="4" required></label><label>Загрузка, %<input name="utilization_percent" type="number" min="0" max="100" step="0.1" value="95" required></label><label>Произведено для контроля<input name="produced" type="number" min="0" value="120" required></label><label>Брак, шт.<input name="defects" type="number" min="0" value="0" required></label><label>Оборудование при простое<input name="equipment" maxlength="100"></label><label>Причина простоя<input name="downtime_reason" maxlength="500"></label><label>Простой, минут<input name="downtime_minutes" type="number" min="0" value="0"></label><label class="checkbox-label"><input name="is_critical" type="checkbox" checked> Критичный простой</label><p class="form-error form-full" role="alert" hidden></p><div class="form-full"><button class="submit-button" type="submit">Сохранить смену</button></div></form><section class="csv-import"><h3>Импорт смен из CSV</h3><p class="muted">Скачайте шаблон, заполните его и загрузите CSV-файл в кодировке UTF-8.</p><a class="text-button" href="/api/import/template.csv">Скачать шаблон CSV</a><form id="csv-import-form"><label>CSV-файл<input name="csv_file" type="file" accept=".csv,text/csv" required></label><p class="form-error" role="alert" hidden></p><button class="submit-button" type="submit">Импортировать смены</button></form></section>`);}
function incidentsPanel(){return panel('<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Аварии и простои',`<div tabindex="0" aria-label="Таблица, прокрутка по горизонтали" class="table-wrap"><table><thead><tr><th>Дата</th><th>Оборудование</th><th>Причина</th><th>Простой</th><th>Уровень</th></tr></thead><tbody>${state.downtime.map(d=>`<tr><td>${esc(dateLabel(d.work_date))}</td><td>${esc(d.equipment)}<br><small>${esc(d.area)}</small></td><td>${esc(d.reason)}</td><td>${ru.format(d.duration_minutes)} мин</td><td><span class="pill ${d.is_critical?'bad':''}">${d.is_critical?'Критичный':'Обычный'}</span></td></tr>`).join('')||'<tr><td colspan="5">Простоев не зарегистрировано</td></tr>'}</tbody></table></div>`)+eventsPanel();}
function renderTips(){if(!$('#insights-list'))return;$('#insights-list').innerHTML=state.tips.map(t=>`<article class="insight ${esc(t.priority)}"><span class="insight-mark"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span><div><h3>${esc(t.title)}</h3><p>${esc(t.reason)}</p><p><b>Рекомендация:</b> ${esc(t.action)}</p></div></article>`).join(''); const alerts=state.dashboard.alerts;$('#alert-box').className='alert-box'+(alerts.length?' has-alert':'');$('#alert-box').textContent=alerts.length?alerts.map(a=>a.message).join(' · '):'Критичных предупреждений нет';}
function render(){updateIdentity();const k=state.dashboard.kpis;$('#kpi-output').textContent=ru.format(k.actual_units);$('#kpi-oee').textContent=ru.format(k.oee_percent)+'%';$('#kpi-downtime').textContent=ru.format(k.downtime_minutes)+' мин';$('#kpi-quality').textContent=ru.format(100-k.defect_rate_percent)+'%';$('.period').textContent=`Период: ${reportFilters.start_date||'начало'} — ${reportFilters.end_date||'сегодня'}${reportFilters.area?' · '+reportFilters.area:''}`;document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===currentPage);if(a.dataset.page===currentPage)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
const pages={cabinet:cabinetPanel,profile:profilePanel,home:()=>factoryPanel()+shopPanel()+(selectedArea?'<div class="cols">'+chartPanel()+tipsPanel()+'</div>':tipsPanel()),production:()=>factoryPanel()+'<div class="cols">'+chartPanel()+planFactPanel()+'</div><div class="cols production-bottom">'+eventsPanel()+bottleneckPanel()+'</div>',equipment:()=>maintenanceAlertsPanel()+equipmentPanel(),incidents:incidentsPanel,analytics:()=>chartPanel()+planPanel(),ai:()=>tipsPanel()+eventsPanel(),'actions':actionsPanel,'forecast':forecastPanel,'demo':demoPanel,'audit':currentПользователь.role==='admin'?auditPanel:()=>panel('Нет доступа','Журнал действий доступен администраторам.'),'shift-entry':currentПользователь.role==='admin'?shiftEntryPanel:()=>panel('Нет доступа','Ввод смены доступен администратору.')};$('#content').innerHTML=pages[currentPage]();document.querySelectorAll('[data-area]').forEach(b=>b.addEventListener('click',()=>{selectedArea=b.dataset.area;render();}));renderTips();bindДействиеControls();if($('#demo-simulate'))$('#demo-simulate').addEventListener('click',()=>$('#shift-button').click());if($('#output-chart')){renderChart();$('#chart-period').addEventListener('change',event=>{chartPeriod=event.target.value;renderChart();});}if($('#event-list'))renderEvents();if($('#plan-list')){renderPlan();$('#apply-plan-button').addEventListener('click',applyPlan);}bindAccountForms();if($('#asset-form'))bindAssetForm();if($('#new-asset-button'))$('#new-asset-button').addEventListener('click',()=>{$('#asset-form').reset();$('#asset-form [name=id]').value='';$('#asset-form').scrollIntoView({behavior:'smooth'});});document.querySelectorAll('[data-edit-asset]').forEach(button=>button.addEventListener('click',()=>{const asset=state.equipment.find(item=>item.id===Number(button.dataset.editAsset));const form=$('#asset-form');for(const [key,value] of Object.entries(asset))if(form.elements[key])form.elements[key].value=value??'';form.scrollIntoView({behavior:'smooth'});}));}
async function applyPlan(){await busy($('#apply-plan-button'),async()=>{for(const item of state.plan.allocations){await api(`/api/plans/${item.id}`,{method:'PUT',body:JSON.stringify({model:item.model,monthly_plan:item.suggested})});}await api('/api/event-note',{method:'POST',body:JSON.stringify({title:'Месячный план скорректирован',details:{new_total:state.plan.target}})});await refresh();toast('План обновлён');});}
function renderPlan() {
  const plan = state.plan;
  $('#plan-total').textContent = ru.format(plan.current_total);
  $('#plan-gap').textContent = plan.gap ? `\u041d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 ${ru.format(plan.gap)} \u043c\u0430\u0448\u0438\u043d` : '\u0426\u0435\u043b\u0435\u0432\u043e\u0439 \u043e\u0431\u044a\u0451\u043c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442';
  $('#plan-progress-fill').style.width = `${Math.min(100, plan.current_total / plan.target * 100)}%`;
  $('#plan-list').innerHTML = plan.allocations.map((item) => `<div class="plan-row"><span>${esc(item.model)}</span><div><div class="plan-bar"><i style="width:${plan.current_total ? item.current / plan.current_total * 100 : 0}%"></i></div>${item.additional ? `<div class="plan-add">+${ru.format(item.additional)} \u043f\u043e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044e</div>` : ''}</div><strong>${ru.format(item.current)}</strong></div>`).join('');
  const button = $('#apply-plan-button');
  button.disabled = !plan.gap || currentПользователь.role !== 'admin';
  button.hidden = currentПользователь.role !== 'admin';
  button.textContent = plan.gap ? `\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435 +${ru.format(plan.gap)}` : '\u0426\u0435\u043b\u044c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442\u0430';
}

function renderEvents() {
  $('#event-list').innerHTML = state.events.length ? state.events.map((event) => {
    const when = new Date(event.created_at);
    const time = Number.isNaN(when.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(when);
    const details = Object.entries(event.details || {}).map(([key, value]) => key==='comparison' ? Object.entries(value).map(([metric,item])=>`${esc(metric)} ${ru.format(item.before)} → ${ru.format(item.after)}`).join(' · ') : `${esc(key)}: ${esc(value)}`).join(' · ');
    const icon = event.severity === 'critical' ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : event.severity === 'warning' ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>' : '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    return `<div class="event-row"><span class="event-icon ${esc(event.severity)}">${icon}</span><div class="event-copy"><b>${esc(event.title)}</b><p>${details || esc(event.event_type)}</p></div><time class="event-time">${time}</time></div>`;
  }).join('') : '<div class="event-empty">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0438\u043c\u0443\u043b\u044f\u0446\u0438\u044e \u0441\u043c\u0435\u043d\u044b.</div>';
}

const chartColors = ['#007bc1', '#8293a8', '#001e50'];
function renderChart() {
  const host = $('#output-chart');
  if (!host) return;
  const area = reportFilters.area || (currentPage === 'home' && selectedArea ? selectedArea : 'Сборка');
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
$('#shift-button').addEventListener('click', () => {dialog.querySelector('.scenario-options').hidden=false;$('#simulation-comparison').hidden=true;dialog.querySelector('p').hidden=false;dialog.showModal();});
dialog.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', async () => {
  dialog.close();
  await busy($('#shift-button'), async () => {
    const result=await api('/api/simulation/shift', { method: 'POST', body: JSON.stringify({ scenario: button.dataset.scenario }) });
    await refresh();
    const impact=result.estimated_impact||{};const impactCard=`<article class="impact-estimate"><b>${esc(impact.label||'Оценка эффекта сценария')}</b><p>${esc(impact.basis||'Расчёт основан на параметрах сценария и указанных допущениях.')}</p>${impact.estimated_downtime_hours!==undefined?`<strong>${ru.format(impact.estimated_downtime_hours)} ч простоя | ${ru.format(impact.estimated_recovered_units_per_shift)} шт. возможного восстановления выпуска</strong>`:''}${impact.estimated_preventable_defects!==undefined?`<strong>${ru.format(impact.estimated_preventable_defects)} потенциально предотвращаемых дефектов</strong>`:''}</article>`;
    const labels={actual_units:'Выпуск, авто',oee_percent:'OEE, %',defect_rate_percent:'Брак, %',downtime_minutes:'Простой, мин'};
    $('#simulation-comparison').innerHTML=`<h3>Результат смены · ${esc(dateLabel(result.date))}</h3><p>Сравнение с предыдущей сменой</p><div class="table-wrap"><table><thead><tr><th>Показатель</th><th>До</th><th>После</th><th>Изменение</th></tr></thead><tbody>${Object.entries(result.comparison).map(([key,v])=>`<tr><td>${labels[key]}</td><td>${ru.format(v.before)}</td><td>${ru.format(v.after)}</td><td>${v.change>0?'+':''}${ru.format(v.change)}</td></tr>`).join('')}</tbody></table></div><article class="insight"><div><b>Рекомендация:</b> ${esc(result.recommendation.action)}<p><b>Ожидаемый эффект:</b> ${esc(result.recommendation.expected_effect)}</p></div></article>${impactCard}<button type="button" id="comparison-close">Закрыть</button>`;
    $('#simulation-comparison').hidden=false;dialog.querySelector('.scenario-options').hidden=true;dialog.querySelector('p').hidden=true;dialog.showModal();$('#comparison-close').addEventListener('click',()=>dialog.close());
    toast('Смена добавлена, сравнение показателей готово');
  });
}));

$('#reset-button').addEventListener('click', async () => busy($('#reset-button'), async () => {
  await api('/api/simulation/reset', { method: 'POST' }); await refresh();
  toast('\u0414\u0435\u043c\u043e \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0435\u043d\u043e \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c \u0434\u0430\u043d\u043d\u044b\u043c');
}));
$('#refresh-button').addEventListener('click', refresh);
$('#apply-filters').addEventListener('click',()=>{reportFilters={start_date:$('#filter-start').value,end_date:$('#filter-end').value,area:$('#filter-area').value};if(reportFilters.start_date&&reportFilters.end_date&&reportFilters.start_date>reportFilters.end_date){toast('Начальная дата позже конечной');return;}syncExportLink();refresh();});
$('#clear-filters').addEventListener('click',()=>{$('#filter-start').value='';$('#filter-end').value='';$('#filter-area').value='';reportFilters={start_date:'',end_date:'',area:''};syncExportLink();refresh();});
let resizeВремяr;
window.addEventListener('resize', () => { clearВремяout(resizeВремяr); resizeВремяr = setВремяout(() => {if (state.lines && $('#output-chart')) renderChart();}, 100); });
window.addEventListener('hashchange', () => { currentPage = ['home','production','equipment','incidents','analytics','ai','cabinet','profile','shift-entry','demo','audit','actions','forecast'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home'; if(state.dashboard) render(); });
boot();


function roleLabel(role) { return role === 'admin' ? 'Администратор' : 'Пользователь'; }
function updateIdentity() {
  $('#header-name').textContent = currentПользователь.name;
  $('#dropdown-name').textContent = currentПользователь.name;
  $('#dropdown-role').textContent = roleLabel(currentПользователь.role);
  $('#avatar-initials').textContent = currentПользователь.name.trim().split(/\s+/).slice(0,2).map(word => [...word][0]).join('').toUpperCase();
  $('#shift-button').hidden = currentПользователь.role !== 'admin';
  $('#reset-button').hidden = currentПользователь.role !== 'admin';
  $('#shift-entry-link').hidden = currentПользователь.role !== 'admin';
  $('#audit-link').hidden = currentПользователь.role !== 'admin';
}
function accountSummary() {
  const k=state.dashboard.kpis;
  return `<div class="account-stats"><article><span>Выпуск за период</span><strong>${ru.format(k.actual_units)} <small>авто</small></strong></article><article><span>OEE</span><strong>${ru.format(k.oee_percent)}<small>%</small></strong></article><article><span>Качество</span><strong>${ru.format(100-k.defect_rate_percent)}<small>%</small></strong></article></div>`;
}
function cabinetPanel() {
  const isAdmin=currentПользователь.role==='admin';
  const greeting=panel(`<i class="fa-solid fa-table-columns" aria-hidden="true"></i> ${isAdmin?'Кабинет администратора':'Кабинет пользователя'}`,`<div class="cabinet-welcome"><span class="role-badge">${roleLabel(currentПользователь.role)}</span><h1>Здравствуйте, ${esc(currentПользователь.name)}!</h1><p class="muted">${isAdmin?'Управляйте доступом команды и контролируйте производство.':'Следите за показателями завода и управляйте своим профилем.'}</p></div>${accountSummary()}<div class="account-links"><a href="#home"><i class="fa-solid fa-map" aria-hidden="true"></i> Карта завода</a><a href="#production"><i class="fa-solid fa-car" aria-hidden="true"></i> Производство</a><a href="#profile"><i class="fa-solid fa-user" aria-hidden="true"></i> Мой профиль</a></div>`);
  if(!isAdmin) return greeting+panel('<i class="fa-solid fa-user" aria-hidden="true"></i> Ваш аккаунт',`<dl class="account-details"><div><dt>Логин</dt><dd>${esc(currentПользователь.username)}</dd></div><div><dt>Доступ</dt><dd>Просмотр показателей и аналитики</dd></div><div><dt>Статус</dt><dd><span class="pill good">Активен</span></dd></div></dl><p class="muted">Для изменения производственных данных обратитесь к администратору.</p>`);
  return greeting+panel('<i class="fa-solid fa-users" aria-hidden="true"></i> Управление пользователями',`<div tabindex="0" aria-label="Таблица, прокрутка по горизонтали" class="table-wrap users-table"><table><thead><tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Действие</th></tr></thead><tbody>${accountПользовательs.map(user=>`<tr><td>${esc(user.name)}</td><td>${esc(user.username)}</td><td>${roleLabel(user.role)}</td><td><span class="pill ${user.is_active?'good':'bad'}">${user.is_active?'Активен':'Заблокирован'}</span></td><td>${user.id===currentПользователь.id?'<span class="muted">Ваш аккаунт</span>':`<button data-toggle-user="${user.id}" data-active="${user.is_active?'0':'1'}">${user.is_active?'Заблокировать':'Активировать'}</button> <button class="danger-button" data-delete-user="${user.id}">Удалить</button>`}</td></tr>`).join('')}</tbody></table></div>`)+panel('<i class="fa-solid fa-user-plus" aria-hidden="true"></i> Создать аккаунт',`<form id="create-user-form" class="account-form form-grid"><label>Имя<input name="name" required maxlength="100" autocomplete="off" placeholder="Имя пользователя"></label><label>Логин<input name="username" required minlength="3" maxlength="80" pattern="[A-Za-z0-9_.@-]{3,80}" autocomplete="off" placeholder="Латинские буквы и цифры"></label><label>Роль<select name="role"><option value="user">Пользователь</option><option value="admin">Администратор</option></select></label><label>Временный пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Минимум 12 символов"></label><p class="form-error form-full" role="alert" hidden></p><div class="form-full"><button class="submit-button" type="submit">Создать аккаунт</button></div></form>`);
}
function profilePanel() {
  return panel('<i class="fa-solid fa-user" aria-hidden="true"></i> Профиль',`<div class="profile-card"><span class="profile-large-avatar"><i class="fa-solid fa-user" aria-hidden="true"></i></span><div><h1>${esc(currentПользователь.name)}</h1><span class="role-badge">${roleLabel(currentПользователь.role)}</span></div></div><dl class="account-details"><div><dt>Логин</dt><dd>${esc(currentПользователь.username)}</dd></div><div><dt>Аккаунт создан</dt><dd>${new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium'}).format(new Date(currentПользователь.created_at*1000))}</dd></div></dl><form id="profile-form" class="account-form"><label>Имя<input name="name" value="${esc(currentПользователь.name)}" required maxlength="100" autocomplete="name"></label><p class="form-error" role="alert" hidden></p><button type="submit" class="submit-button">Сохранить изменения</button></form>`)+panel('<i class="fa-solid fa-lock" aria-hidden="true"></i> Сменить пароль',`<form id="password-form" class="account-form"><label>Текущий пароль<input name="current_password" type="password" required maxlength="128" autocomplete="current-password"></label><div class="form-grid"><label>Новый пароль<input name="new_password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Минимум 12 символов"></label><label>Повторите новый пароль<input name="confirm_password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label></div><p class="form-error" role="alert" hidden></p><button type="submit" class="submit-button">Обновить пароль</button><p class="muted">После смены пароля другие сессии этого аккаунта завершатся.</p></form>`);
}
function bindForm(id, action) {
  const form=$(id);if(!form)return;
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type="submit"]'),error=form.querySelector('.form-error');error.hidden=true;button.disabled=true;
    try{await action(Object.fromEntries(new FormData(form)),form);}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}
  });
}
function bindAccountForms() {
  bindForm('#profile-form',async values=>{currentПользователь=await api('/api/auth/profile',{method:'PATCH',body:JSON.stringify({name:values.name})});render();toast('Профиль обновлён');});
  bindForm('#password-form',async(values,form)=>{if(values.new_password!==values.confirm_password)throw new Error('Новые пароли не совпадают');await api('/api/auth/password',{method:'POST',body:JSON.stringify({current_password:values.current_password,new_password:values.new_password})});form.reset();toast('Пароль изменён');});
  bindForm('#create-user-form',async values=>{await api('/api/admin/users',{method:'POST',body:JSON.stringify(values)});accountПользовательs=await api('/api/admin/users');render();toast('Аккаунт создан');});
  document.querySelectorAll('[data-toggle-user]').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{await api(`/api/admin/users/${button.dataset.toggleПользователь}`,{method:'PATCH',body:JSON.stringify({is_active:button.dataset.active==='1'})});accountПользовательs=await api('/api/admin/users');render();toast('Статус аккаунта обновлён');})));
  document.querySelectorAll('[data-delete-user]').forEach(button=>button.addEventListener('click',()=>{if(!confirm('Удалить аккаунт? Его активные сессии будут завершены.'))return;busy(button,async()=>{await api(`/api/admin/users/${button.dataset.deleteПользователь}`,{method:'DELETE'});accountПользовательs=await api('/api/admin/users');render();toast('Аккаунт удалён');});}));
  const csvForm=$('#csv-import-form');if(csvForm)csvForm.addEventListener('submit',async event=>{event.preventDefault();const error=csvForm.querySelector('.form-error'),button=csvForm.querySelector('[type=submit]'),file=csvForm.elements.csv_file.files[0];error.hidden=true;button.disabled=true;try{const result=await api('/api/import/csv',{method:'POST',body:JSON.stringify({content:await file.text()})});toast(`Импортировано смен: ${result.count}`);await refresh();}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});
  const form=$('#shift-entry-form');if(form)form.addEventListener('submit',async event=>{event.preventDefault();const error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');error.hidden=true;button.disabled=true;try{const v=Object.fromEntries(new FormData(form));for(const key of ['planned_units','actual_units','operating_hours','elapsed_shift_hours','utilization_percent','produced','defects','downtime_minutes'])v[key]=Number(v[key]);v.is_critical=form.elements.is_critical.checked;await api('/api/shift-entry',{method:'POST',body:JSON.stringify(v)});toast('Данные смены сохранены');await refresh();}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});
}
function bindAssetForm(){const form=$('#asset-form');form.addEventListener('submit',async event=>{event.preventDefault();const error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');error.hidden=true;button.disabled=true;try{const v=Object.fromEntries(new FormData(form));const id=v.id;delete v.id;v.last_maintenance=v.last_maintenance||null;await api(id?`/api/equipment/${id}`:'/api/equipment',{method:id?'PUT':'POST',body:JSON.stringify(v)});await refresh();toast('Карточка оборудования сохранена');}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});}
function closeProfileMenu(){ $('#profile-dropdown').hidden=true;$('#profile-trigger').setAttribute('aria-expanded','false'); }
$('#profile-trigger').addEventListener('click',()=>{const open=$('#profile-dropdown').hidden;$('#profile-dropdown').hidden=!open;$('#profile-trigger').setAttribute('aria-expanded',String(open));});
document.addEventListener('click',event=>{if(!event.target.closest('.profile-menu'))closeProfileMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#profile-dropdown').hidden){closeProfileMenu();$('#profile-trigger').focus();}});
$('#profile-dropdown').querySelectorAll('a').forEach(link=>link.addEventListener('click',closeProfileMenu));
$('#logout-button').addEventListener('click',()=>busy($('#logout-button'),async()=>{await api('/api/auth/logout',{method:'POST'});location.replace('/login');}));
async function boot(){try{const session=await api('/api/auth/me');currentПользователь=session.user;csrfToken=session.csrf_token;updateIdentity();if(currentПользователь.role==='admin')accountПользовательs=await api('/api/admin/users');await refresh();}catch(error){toast(error.message);}}


// Mobile drawer navigation: dismiss, focus containment and scroll locking.
const mobileNavigation = window.matchMedia('(max-width: 1023px)');
let drawerOpen = false;
function setDrawer(open, focusContent = false) {
  drawerOpen = Boolean(open && mobileNavigation.matches);
  const sidebar = $('#app-navigation');
  document.body.classList.toggle('drawer-open', drawerOpen);
  $('#menu-toggle').setAttribute('aria-expanded', String(drawerOpen));
  $('#menu-toggle').setAttribute('aria-label', drawerOpen ? 'Закрыть меню' : 'Открыть меню');
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
