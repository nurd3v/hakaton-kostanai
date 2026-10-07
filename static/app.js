const $ = (selector) => document.querySelector(selector);
const ru = new Intl.NumberFormat('ru-RU');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AREA_NAMES = ['\u0421\u0432\u0430\u0440\u043a\u0430', '\u041e\u043a\u0440\u0430\u0441\u043a\u0430', '\u0421\u0431\u043e\u0440\u043a\u0430'];
let state = {};
let toastTimer;

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
  } catch (error) { toast(error.message); }
}

function render() {
  const k = state.dashboard.kpis;
  $('#kpi-oee').textContent = ru.format(k.oee_percent);
  $('#kpi-output').textContent = ru.format(k.actual_units);
  $('#kpi-planned').textContent = ru.format(k.planned_units);
  $('#kpi-defects').textContent = ru.format(k.defect_rate_percent);
  $('#kpi-downtime').textContent = ru.format(k.downtime_minutes);
  $('#oee-note').textContent = `\u0426\u0435\u043b\u044c \u2265 ${k.oee_target_percent}% \u00b7 \u043e\u0446\u0435\u043d\u043a\u0430`;
  $('#attainment').textContent = `${ru.format(k.plan_attainment_percent)}% \u043f\u043b\u0430\u043d\u0430`;
  setPill('oee-state', k.oee_percent >= k.oee_target_percent ? '\u0426\u0435\u043b\u044c \u0434\u043e\u0441\u0442\u0438\u0433\u043d\u0443\u0442\u0430' : '\u041d\u0438\u0436\u0435 \u0446\u0435\u043b\u0438', k.oee_percent >= k.oee_target_percent ? 'good' : 'warn');
  setPill('quality-state', k.defect_rate_percent <= 2 ? '\u0412 \u043d\u043e\u0440\u043c\u0435' : '\u0412\u044b\u0448\u0435 \u043d\u043e\u0440\u043c\u044b', k.defect_rate_percent <= 2 ? 'good' : 'bad');
  setPill('downtime-state', k.downtime_minutes > 60 ? '\u0415\u0441\u0442\u044c \u043f\u0440\u0435\u0432\u044b\u0448\u0435\u043d\u0438\u0435' : '\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c', k.downtime_minutes > 60 ? 'bad' : 'warn');
  meter('oee-meter', k.oee_percent);
  meter('output-meter', k.plan_attainment_percent);
  meter('quality-meter', k.defect_rate_percent / 5 * 100);
  meter('downtime-meter', k.downtime_minutes / 180 * 100);
  renderFactory();
  renderTips();
  renderPlan();
  renderEvents();
  renderChart();
}

function meter(id, value) { $(`#${id}`).style.width = `${Math.max(0, Math.min(100, value))}%`; }
function setPill(id, text, cls) { const el = $(`#${id}`); el.textContent = text; el.className = `pill ${cls}`; }

function renderFactory() {
  const stages = [
    { name: '\u0421\u043a\u043b\u0430\u0434 \u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u043e\u0432', icon: '\u25a7' },
    { name: AREA_NAMES[0], icon: '\u2733', area: AREA_NAMES[0] },
    { name: AREA_NAMES[1], icon: '\u25c9', area: AREA_NAMES[1] },
    { name: AREA_NAMES[2], icon: '\u2699', area: AREA_NAMES[2] },
    { name: '\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u0430', icon: '\u2713' },
    { name: '\u0421\u043a\u043b\u0430\u0434 \u0433\u043e\u0442\u043e\u0432\u043e\u0439 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438', icon: '\u25a4' },
  ];
  const byArea = Object.fromEntries(state.factory.areas.map((item) => [item.area, item]));
  $('#flow-date').textContent = dateLabel(state.factory.date);
  $('#flow-map').innerHTML = stages.map((stage) => {
    const data = stage.area ? byArea[stage.area] : null;
    const status = data?.status || 'normal';
    const label = ({ normal: '\u0412 \u043d\u043e\u0440\u043c\u0435', warning: '\u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435', critical: '\u041a\u0440\u0438\u0442\u0438\u0447\u043d\u043e' })[status];
    return `<div class="flow-node ${status}" data-area="${esc(stage.area || '')}" role="button" tabindex="0"><div class="node-icon">${stage.icon}</div><div class="node-name">${esc(stage.name)}</div><div class="node-status">${data ? label : '\u042d\u0442\u0430\u043f \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u0430'}</div></div>`;
  }).join('');
  $('#flow-map').querySelectorAll('.flow-node[data-area]').forEach((node) => {
    if (!node.dataset.area) return;
    node.addEventListener('click', () => selectArea(node.dataset.area));
    node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') selectArea(node.dataset.area); });
  });
  selectArea(AREA_NAMES[0]);
}

function selectArea(name) {
  const area = state.factory.areas.find((item) => item.area === name);
  if (!area) return;
  document.querySelectorAll('.flow-node').forEach((node) => node.classList.toggle('selected', node.dataset.area === name));
  const equip = area.equipment.length ? area.equipment.map(esc).join(', ') : '\u041d\u0435\u0442 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0445 \u043f\u0440\u043e\u0441\u0442\u043e\u0435\u0432';
  $('#area-detail').innerHTML = `<div class="detail-card"><div class="detail-title">${esc(area.area)}<small>${esc(area.line)} \u00b7 ${equip}</small></div><div class="detail-metric">${ru.format(area.utilization_percent ?? 0)}%<small>\u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430</small></div><div class="detail-metric">${ru.format(area.defect_rate_percent)}%<small>\u0431\u0440\u0430\u043a</small></div><div class="detail-metric">${ru.format(area.downtime_minutes)} \u043c\u0438\u043d.<small>\u043f\u0440\u043e\u0441\u0442\u043e\u0439</small></div></div>`;
}

function renderTips() {
  $('#insight-count').textContent = state.tips.length;
  $('#insights-list').innerHTML = state.tips.map((tip) => `<article class="insight ${esc(tip.priority)}"><div class="insight-mark">${tip.type === 'quality' ? '\u25c9' : tip.type === 'maintenance' ? '\u2699' : '\u2713'}</div><div><h3>${esc(tip.title)}</h3><p>${esc(tip.reason)}</p><p class="action"><b>\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u043c:</b> ${esc(tip.action)}</p></div></article>`).join('');
  const alerts = state.dashboard.alerts;
  const box = $('#alert-box');
  box.className = `alert-box${alerts.length ? ' has-alert' : ''}`;
  box.textContent = alerts.length ? alerts.map((item) => item.message).join(' · ') : '\u041a\u043e\u043d\u0442\u0440\u043e\u043b\u044c \u043f\u043e\u0440\u043e\u0433\u043e\u0432: \u043a\u0440\u0438\u0442\u0438\u0447\u043d\u044b\u0445 \u043f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u0439 \u043d\u0435\u0442.';
}

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
    const icon = event.severity === 'critical' ? '!' : event.severity === 'warning' ? '\u25c9' : '\u2713';
    return `<div class="event-row"><span class="event-icon ${esc(event.severity)}">${icon}</span><div class="event-copy"><b>${esc(event.title)}</b><p>${details || esc(event.event_type)}</p></div><time class="event-time">${time}</time></div>`;
  }).join('') : '<div class="event-empty">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0438\u043c\u0443\u043b\u044f\u0446\u0438\u044e \u0441\u043c\u0435\u043d\u044b.</div>';
}

const chartColors = ['#2e9a67', '#5b8fd5', '#d8a039'];
function renderChart() {
  const canvas = $('#output-chart');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height, pad = { top: 10, right: 12, bottom: 27, left: 35 };
  const chartW = width - pad.left - pad.right, chartH = height - pad.top - pad.bottom;
  const days = [...new Set(state.lines.map((item) => item.work_date))].sort();
  const max = Math.max(140, ...state.lines.map((item) => item.actual_units));
  ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + chartH - chartH * i / 3;
    ctx.strokeStyle = '#edf1ee'; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#9aa69f'; ctx.fillText(Math.round(max * i / 3), pad.left - 7, y + 3);
  }
  const groupW = chartW / Math.max(days.length, 1), barW = Math.min(17, groupW / 5);
  days.forEach((day, di) => {
    AREA_NAMES.forEach((area, ai) => {
      const row = state.lines.find((item) => item.work_date === day && item.line.startsWith(area));
      if (!row) return;
      const barH = chartH * row.actual_units / max;
      const x = pad.left + groupW * (di + .5) + (ai - 1) * (barW + 5) - barW / 2;
      ctx.fillStyle = chartColors[ai]; ctx.fillRect(x, pad.top + chartH - barH, barW, barH);
    });
    ctx.fillStyle = '#86938b'; ctx.textAlign = 'center'; ctx.fillText(dateLabel(day, { day: 'numeric', month: 'short' }), pad.left + groupW * (di + .5), height - 6);
  });
  $('#chart-legend').innerHTML = AREA_NAMES.map((area, i) => `<span><i style="background:${chartColors[i]}"></i>${esc(area)}</span>`).join('');
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
$('#apply-plan-button').addEventListener('click', async () => busy($('#apply-plan-button'), async () => {
  await Promise.all(state.plan.allocations.map((item) => api(`/api/plans/${item.id}`, { method: 'PUT', body: JSON.stringify({ model: item.model, monthly_plan: item.suggested }) })));
  await api('/api/event-note', { method: 'POST', body: JSON.stringify({ title: '\u041c\u0435\u0441\u044f\u0447\u043d\u044b\u0439 \u043f\u043b\u0430\u043d \u0441\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d', details: { new_total: 5500 } }) });
  await refresh(); toast('\u041f\u043b\u0430\u043d \u0434\u043e\u0432\u0435\u0434\u0451\u043d \u0434\u043e 5 500 \u043c\u0430\u0448\u0438\u043d');
}));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 100); });
refresh();
