// Интерфейс Tamyr: карта района, карточка и паспорт саженца, проверка фото, акт для акимата.

import { createEngine, CAUSES, WILT, WINDOW } from './engine.js';
import { moistureChart, ndviChart } from './charts.js';
import { checkPhoto } from './photo.js';
import { renderReport, setReportContractor } from './report.js';
import { addDays, daysBetween, fmtDate, fmtDateFull } from './dates.js';

export const CAUSE_COLOR = {
  alive: '#3ddc84',
  no_watering: '#f4573b',
  drought: '#f2b036',
  bad_material: '#56a8f0',
  unknown: '#7c8f89',
};

const STORE = 'tamyr.v1';
const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
  },
  save(data) {
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* приватный режим */ }
  },
};

const PREFS = 'tamyr.prefs';
const prefs = {
  load() {
    try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; }
  },
  save(data) {
    try { localStorage.setItem(PREFS, JSON.stringify({ ...prefs.load(), ...data })); } catch { /* приватный режим */ }
  },
};

const state = {
  asOf: null, // дата на шкале времени
  filter: { status: 'all', contractor: 'all' },
  layers: { trees: true, ndvi: true },
  basemap: prefs.load().basemap === 'satellite' ? 'satellite' : 'scheme',
  selectedPlot: null,
  district: null,
  series: null,
  engine: null,
  diag: new Map(),
  selected: null,
  local: store.load(), // { photos: {treeId: [...]}, moisture: {plotId: [...]}, hashes: [] }
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- данные ----------

async function loadData() {
  const [district, series] = await Promise.all([
    fetch('data/district.json').then((r) => r.json()),
    fetch('data/series.json').then((r) => r.json()),
  ]);
  state.district = district;
  state.baseSeries = series;
  rebuild();
}

function rebuild() {
  const base = state.baseSeries;
  const photos = { ...base.photos };
  for (const [id, list] of Object.entries(state.local.photos || {})) photos[id] = [...(photos[id] || []), ...list];
  const moisture = { ...base.moisture };
  for (const [pid, rows] of Object.entries(state.local.moisture || {})) {
    const byDate = new Map((moisture[pid] || []).map((m) => [m.date, m]));
    for (const r of rows) byDate.set(r.date, r);
    moisture[pid] = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  state.series = { ...base, photos, moisture };
  state.engine = createEngine(state.district, state.series);
  state.diag = new Map(state.engine.diagnoseAll().map((d) => [d.tree.id, d]));
}

const plotOf = (id) => state.district.plots.find((p) => p.id === id);
const contractorOf = (id) => state.district.contractors.find((c) => c.id === id);
const batchOf = (id) => state.district.batches.find((b) => b.id === id);
const today = () => state.district.meta.today;

// ---------- карта ----------

let map, treeLayer, ndviLayer, labelLayer, highlightLayer, districtBounds;
let fitted = false;
const markers = new Map();
const baseLayers = {};

const BASEMAPS = {
  scheme: {
    label: 'Схема',
    url: 'https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap, © CARTO' },
  },
  satellite: {
    label: 'Спутник',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics' },
  },
};

// Цвет участка по NDVI: от бурого (зелени нет) до насыщенно-зелёного.
const NDVI_STOPS = [
  [0.15, [138, 90, 43]],
  [0.3, [179, 155, 58]],
  [0.45, [95, 174, 90]],
  [0.6, [47, 158, 91]],
];
function ndviColor(v) {
  if (v == null) return '#3a4c45';
  if (v <= NDVI_STOPS[0][0]) return `rgb(${NDVI_STOPS[0][1]})`;
  for (let i = 1; i < NDVI_STOPS.length; i++) {
    const [x1, c1] = NDVI_STOPS[i];
    const [x0, c0] = NDVI_STOPS[i - 1];
    if (v <= x1) {
      const k = (v - x0) / (x1 - x0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
    }
  }
  return `rgb(${NDVI_STOPS[NDVI_STOPS.length - 1][1]})`;
}

function ndviAt(pid, date) {
  const rows = (state.series.ndvi[pid] || []).filter((n) => n.v != null && n.date <= date);
  return rows[rows.length - 1] || null;
}

function moistureAt(pid, date) {
  const rows = (state.series.moisture[pid] || []).filter((m) => m.v != null && m.date <= date);
  return rows[rows.length - 1] || null;
}

// Статус саженца на выбранную дату шкалы времени.
function statusAt(d, date) {
  if (d.tree.planted > date) return null;
  return d.dead && d.observed <= date ? d.cause : 'alive';
}

const inFilter = (d, st) => {
  if (!st) return false;
  const f = state.filter;
  if (f.contractor !== 'all' && plotOf(d.tree.plot).contractor !== f.contractor) return false;
  if (f.status === 'all') return true;
  if (f.status === 'dead') return st !== 'alive';
  return st === f.status;
};

function markerRadius() {
  const z = map.getZoom();
  return z >= 18 ? 8 : z >= 17 ? 6.5 : z >= 16 ? 5.5 : z >= 15 ? 4.5 : 3.5;
}

function initMap() {
  const plots = state.district.plots;
  map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  for (const [key, b] of Object.entries(BASEMAPS)) baseLayers[key] = L.tileLayer(b.url, b.options);
  baseLayers[state.basemap].addTo(map);
  ndviLayer = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);
  labelLayer = L.layerGroup().addTo(map);
  treeLayer = L.layerGroup().addTo(map);
  districtBounds = L.latLngBounds(plots.flatMap((p) => p.polygon)).pad(0.04);
  fitDistrict(false);
  map.on('zoomend', () => {
    for (const m of markers.values()) m.setRadius(markerRadius() + (m.options.dead ? 1.5 : 0));
    toggleLabels();
  });
  bindMapControls();
  drawMap();
}

// Район целиком, с учётом панелей поверх карты.
function fitDistrict(animate = true) {
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const opts = { paddingTopLeft: [mobile ? 12 : 250, 100], paddingBottomRight: [12, 90], animate };
  if (animate) map.flyToBounds(districtBounds, { ...opts, duration: 0.6 });
  else map.fitBounds(districtBounds, opts);
}

function toggleLabels() {
  const show = map.getZoom() >= 16.5;
  if (show && !map.hasLayer(labelLayer)) labelLayer.addTo(map);
  if (!show && map.hasLayer(labelLayer)) labelLayer.remove();
}

function drawMap() {
  const date = state.asOf;
  ndviLayer.clearLayers();
  labelLayer.clearLayers();
  treeLayer.clearLayers();
  markers.clear();
  for (const p of state.district.plots) {
    const n = ndviAt(p.id, date);
    const trees = state.district.trees.filter((t) => t.plot === p.id);
    const alive = trees.filter((t) => statusAt(state.diag.get(t.id), date) === 'alive').length;
    const dim = state.filter.contractor !== 'all' && p.contractor !== state.filter.contractor;
    L.polygon(p.polygon, {
      color: '#e9f1ec',
      opacity: dim ? 0.15 : 0.45,
      weight: 1,
      fillColor: ndviColor(n?.v),
      fillOpacity: dim ? 0.12 : state.layers.ndvi ? 0.55 : 0,
    })
      .bindTooltip(`${esc(p.name)} · NDVI ${n ? n.v.toFixed(2) : '—'}`, { sticky: true })
      .on('click', () => selectPlot(p.id))
      .addTo(ndviLayer);
    L.marker(p.label || p.center, {
      interactive: false,
      icon: L.divIcon({
        className: 'plot-label',
        html: `<span>${esc(p.name.replace('Нуржол, ', ''))}</span><b>${alive}/${trees.length} живы</b>`,
        iconSize: null,
      }),
    }).addTo(labelLayer);
  }
  let shown = 0;
  for (const t of state.district.trees) {
    const d = state.diag.get(t.id);
    const st = statusAt(d, date);
    if (!state.layers.trees || !inFilter(d, st)) continue;
    shown++;
    const dead = st !== 'alive';
    const m = L.circleMarker([t.lat, t.lon], {
      radius: markerRadius() + (dead ? 1.5 : 0),
      color: dead ? '#ffffff' : '#0b1110',
      weight: dead ? 1.2 : 1,
      fillColor: CAUSE_COLOR[st],
      fillOpacity: 1,
      dead,
    })
      .bindTooltip(`<b>${t.id}</b> · ${esc(t.species)}<br>${dead ? CAUSES[st].label : 'Жив'}`)
      .on('click', () => selectTree(t.id))
      .addTo(treeLayer);
    markers.set(t.id, m);
  }
  toggleLabels();
  highlightSelected();
  renderMapChrome(shown);
}

function highlightSelected() {
  highlightLayer.clearLayers();
  const plotId = state.selectedPlot || (state.selected && state.diag.get(state.selected).tree.plot);
  if (plotId) {
    L.polygon(plotOf(plotId).polygon, { color: '#8bf0b5', weight: 2, fill: false, dashArray: '4 3', interactive: false })
      .addTo(highlightLayer);
  }
  const m = state.selected && markers.get(state.selected);
  if (m) {
    L.circleMarker(m.getLatLng(), { radius: markerRadius() + 7, color: '#ffffff', weight: 2, fill: false, interactive: false })
      .addTo(highlightLayer);
    m.bringToFront();
  }
}

// Легенда, счётчики фильтров и шкала времени.
function renderMapChrome(shown) {
  const date = state.asOf;
  const all = [...state.diag.values()].filter((d) => {
    const st = statusAt(d, date);
    return st && (state.filter.contractor === 'all' || plotOf(d.tree.plot).contractor === state.filter.contractor);
  });
  const count = (k) => all.filter((d) => {
    const st = statusAt(d, date);
    return k === 'all' ? true : k === 'dead' ? st !== 'alive' : st === k;
  }).length;
  for (const b of document.querySelectorAll('#status-chips [data-status]')) {
    const k = b.dataset.status;
    b.classList.toggle('active', state.filter.status === k);
    b.querySelector('em').textContent = count(k);
  }
  $('#map-count').textContent = `На карте ${shown} из ${state.district.trees.length}`;

  const w = state.series.weather.find((x) => x.date === date);
  const heat = w && w.tmax >= 32;
  $('#time-date').textContent = fmtDateFull(date);
  $('#time-weather').innerHTML = w
    ? `<span class="${heat ? 'warn' : ''}">${heat ? 'Жара ' : ''}${Math.round(w.tmax)}°C</span> · осадки ${w.precip} мм`
    : '';
  const slider = $('#time-slider');
  slider.value = daysBetween(state.district.meta.start, date);
  $('#time-today').hidden = date === today();
  for (const b of document.querySelectorAll('#basemap-switch button')) b.classList.toggle('active', b.dataset.base === state.basemap);
}

function setAsOf(date, { quiet = false } = {}) {
  state.asOf = date;
  drawMap();
  renderSidebar();
  if (!quiet) renderDetail();
}

let playTimer = null;
function togglePlay(force) {
  const btn = $('#time-play');
  const playing = force ?? !playTimer;
  if (!playing) {
    clearInterval(playTimer);
    playTimer = null;
    btn.textContent = '▶';
    btn.setAttribute('aria-label', 'Проиграть сезон');
    renderDetail();
    return;
  }
  if (state.asOf >= today()) state.asOf = state.district.meta.start;
  btn.textContent = '❚❚';
  btn.setAttribute('aria-label', 'Пауза');
  playTimer = setInterval(() => {
    const next = addDays(state.asOf, 2);
    if (next >= today()) {
      setAsOf(today(), { quiet: true });
      togglePlay(false);
    } else {
      setAsOf(next, { quiet: true });
    }
  }, 120);
}

function bindMapControls() {
  const start = state.district.meta.start;
  const slider = $('#time-slider');
  slider.max = daysBetween(start, today());
  slider.addEventListener('input', () => {
    if (playTimer) togglePlay(false);
    setAsOf(addDays(start, +slider.value), { quiet: true });
  });
  slider.addEventListener('change', () => renderDetail());
  $('#time-play').addEventListener('click', () => togglePlay());
  $('#time-today').addEventListener('click', () => {
    if (playTimer) togglePlay(false);
    setAsOf(today());
  });

  $('#status-chips').innerHTML = [
    ['all', 'Все'],
    ['alive', 'Живые'],
    ['dead', 'Погибшие'],
    ['no_watering', 'Нет полива'],
    ['drought', CAUSES.drought.label],
    ['bad_material', 'Плохой материал'],
  ]
    .map(([k, l]) => `<button class="chip" data-status="${k}">${k !== 'all' && k !== 'dead' ? `<i class="dot" style="background:${CAUSE_COLOR[k]}"></i>` : ''}${l} <em></em></button>`)
    .join('');
  for (const b of document.querySelectorAll('#status-chips [data-status]')) {
    b.addEventListener('click', () => {
      state.filter.status = b.dataset.status;
      drawMap();
    });
  }
  const sel = $('#contractor-filter');
  sel.innerHTML = '<option value="all">Все подрядчики</option>' +
    state.district.contractors.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.addEventListener('change', () => {
    state.filter.contractor = sel.value;
    drawMap();
    renderSidebar();
  });

  const search = $('#tree-search');
  $('#tree-ids').innerHTML = state.district.trees.map((t) => `<option value="${t.id}">${esc(t.species)}</option>`).join('');
  search.addEventListener('change', () => {
    const id = search.value.trim().toUpperCase();
    if (state.diag.has(id)) {
      state.filter.status = 'all';
      drawMap();
      selectTree(id, true);
      search.value = '';
    }
  });

  for (const b of document.querySelectorAll('#basemap-switch button')) {
    b.addEventListener('click', () => {
      baseLayers[state.basemap].remove();
      state.basemap = b.dataset.base;
      baseLayers[state.basemap].addTo(map).bringToBack();
      prefs.save({ basemap: state.basemap });
      renderMapChrome(markers.size);
    });
  }
  $('#home-view').addEventListener('click', () => fitDistrict());
  $('#layer-trees').addEventListener('change', (e) => {
    state.layers.trees = e.target.checked;
    drawMap();
  });
  $('#layer-ndvi').addEventListener('change', (e) => {
    state.layers.ndvi = e.target.checked;
    drawMap();
  });
  $('#legend-causes').innerHTML = [
    ['alive', 'Жив'],
    ['no_watering', CAUSES.no_watering.label],
    ['drought', CAUSES.drought.label],
    ['bad_material', CAUSES.bad_material.label],
    ['unknown', CAUSES.unknown.label],
  ]
    .map(([k, l]) => `<span><i class="dot" style="background:${CAUSE_COLOR[k]}"></i>${l}</span>`)
    .join('');
  $('#ndvi-scale').style.background = `linear-gradient(90deg, ${[0.15, 0.3, 0.45, 0.6].map(ndviColor).join(', ')})`;
}

// ---------- боковая панель ----------

function renderSidebar() {
  const date = state.asOf;
  const all = [...state.diag.values()].filter((d) => {
    if (!statusAt(d, date)) return false;
    return state.filter.contractor === 'all' || plotOf(d.tree.plot).contractor === state.filter.contractor;
  });
  const dead = all.filter((d) => statusAt(d, date) !== 'alive');
  const survival = all.length ? 1 - dead.length / all.length : 1;
  $('#city-pill').textContent = `${state.district.meta.city} · ${state.district.meta.district}`;
  $('#data-pill').hidden = state.district.meta.dataSource !== 'synthetic';
  $('#summary-title').textContent = date === today() ? 'Сводка по району' : `Сводка на ${fmtDate(date)}`;
  $('#kpis').innerHTML = `
    <div class="kpi"><b>${all.length}</b><span>саженцев</span></div>
    <div class="kpi"><b class="${survival < 0.6 ? 'bad' : 'ok'}">${pct(survival)}</b><span>приживаемость, норматив 60%</span></div>
    <div class="kpi"><b>${dead.length}</b><span>погибло</span></div>
    <div class="kpi"><b>${pct(dead.filter((d) => d.cause !== 'unknown').length / Math.max(1, dead.length))}</b><span>с установленной причиной</span></div>`;

  const counts = {};
  for (const d of dead) counts[d.cause] = (counts[d.cause] || 0) + 1;
  $('#causes').innerHTML = dead.length
    ? Object.keys(CAUSES)
        .filter((c) => counts[c])
        .map((c) => `
      <button class="bar-row" data-cause="${c}" title="Показать на карте">
        <div class="bar-label"><span><i class="dot" style="background:${CAUSE_COLOR[c]}"></i>${CAUSES[c].label}</span><b>${counts[c]}</b></div>
        <div class="bar"><i style="width:${(100 * counts[c]) / dead.length}%;background:${CAUSE_COLOR[c]}"></i></div>
      </button>`)
        .join('')
    : '<p class="empty">Погибших саженцев нет.</p>';
  for (const b of document.querySelectorAll('#causes [data-cause]')) {
    b.addEventListener('click', () => {
      state.filter.status = b.dataset.cause;
      drawMap();
    });
  }

  const alerts = state.engine.plotAlerts(date);
  $('#alerts-count').textContent = alerts.length || '';
  $('#alerts').innerHTML = alerts.length
    ? alerts
        .map((a) => `<button class="alert" data-plot="${a.plot.id}">Наряд на полив: ${esc(a.plot.name)}
          <small>Влажность ${a.moisture ?? '—'}% ниже порога ${WILT}% уже ${a.dryDays} дня · ${esc(contractorOf(a.plot.contractor).name)}</small></button>`)
        .join('')
    : '<p class="empty">Все участки в норме на ' + fmtDate(date) + '.</p>';
  for (const b of document.querySelectorAll('#alerts .alert')) b.addEventListener('click', () => selectPlot(b.dataset.plot, true));
}

// ---------- карточка саженца ----------

function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
}

function passportUrl(id) {
  return `${location.origin}${location.pathname}#/tree/${encodeURIComponent(id)}`;
}

function eventsOf(tree, d) {
  const ev = [];
  ev.push({ date: tree.planted, color: CAUSE_COLOR.alive, text: `Посадка. Партия ${tree.batch}, ${esc(batchOf(tree.batch).nursery)}` });
  const checks = state.engine.wateringChecks(tree.plot, tree.planted, d.dead ? d.observed : today());
  const RES = {
    confirmed: ['#3ddc84', 'подтверждён датчиком'],
    unconfirmed: ['#f4573b', 'датчик не видит полива'],
    rain: ['#56a8f0', 'шёл дождь, проверить нельзя'],
    wet: ['#7c8f89', 'почва была влажной, проверить нельзя'],
    nodata: ['#5f736d', 'нет данных датчика'],
  };
  for (const c of checks) ev.push({ date: c.date, color: RES[c.result][0], text: `Отчёт о поливе: ${RES[c.result][1]}` });
  for (const p of state.series.photos[tree.id] || []) {
    const who = p.source === 'citizen' ? 'Фото горожанина' : 'Фото обхода';
    const v = p.verdict === 'dry' ? 'сухой' : 'живой';
    ev.push({
      date: p.date,
      color: p.trusted ? (p.verdict === 'dry' ? CAUSE_COLOR.no_watering : CAUSE_COLOR.alive) : '#5f736d',
      text: `${who}: ${v}${p.trusted ? '' : ' (не подтверждено, не учитывается)'}${p.demo ? ' · демо' : ''}`,
    });
  }
  if (d.dead) ev.push({ date: d.observed, color: CAUSE_COLOR[d.cause], text: `<b>Гибель зафиксирована.</b> Причина: ${d.label}` });
  return ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const KIND_ICON = { sensor: 'Д', contract: 'О', weather: 'П', satellite: 'С', passport: 'Р' };

function diagnosisHtml(d) {
  if (!d.dead) {
    const last = d.lastPhoto;
    return `<div class="diag"><h3 class="ok">Саженец жив</h3>
      <div class="who">${last ? `Последнее подтверждённое фото: ${fmtDate(last.date)}` : 'Фото ещё нет'}</div></div>`;
  }
  const color = CAUSE_COLOR[d.cause];
  const who = d.responsible.type === 'contractor' ? 'Ответственный: ' : d.responsible.type === 'nursery' ? 'Ответственный: ' : '';
  return `<div class="diag" style="border-color:${color}">
    <h3 style="color:${color}">${d.label}</h3>
    <div class="who">${who}${esc(d.responsible.name)} · гибель замечена ${fmtDate(d.observed)}</div>
    <div class="conf">Уверенность <div class="bar"><i style="width:${pct(d.confidence)};background:${color}"></i></div> ${pct(d.confidence)}</div>
    <p class="advice">${esc(d.advice)}</p>
    <ul class="evidence">
      ${d.evidence.map((e) => `<li class="${e.forCause ? 'for' : ''}" data-kind="${KIND_ICON[e.kind] || '•'}">${esc(e.text)}</li>`).join('')}
    </ul>
    <p class="hint">Проанализированы ${d.facts.days} дней до гибели (не больше ${WINDOW}). Подсвечены факты в пользу вывода.</p>
  </div>`;
}

function treeCardHtml(id, { full = false } = {}) {
  const d = state.diag.get(id);
  const t = d.tree;
  const plot = plotOf(t.plot);
  const b = batchOf(t.batch);
  const from = t.planted;
  const to = today();
  const checks = state.engine.wateringChecks(t.plot, from, to);
  const photos = (state.series.photos[t.id] || []).slice().sort((a, b2) => (a.date < b2.date ? 1 : -1));
  return `
    <div class="card-head">
      <div><h2>${esc(t.species)}</h2><div class="sub">${esc(t.id)} · ${esc(plot.name)}</div></div>
      <span class="status ${d.dead ? 'status-dead' : 'status-alive'}">${d.dead ? 'Погиб' : 'Жив'}</span>
    </div>
    <div class="passport">
      <dl class="facts">
        <dt>Подрядчик</dt><dd>${esc(contractorOf(plot.contractor).name)}</dd>
        <dt>Партия</dt><dd>${esc(b.id)}, ${esc(b.nursery)}</dd>
        <dt>Посажен</dt><dd>${fmtDateFull(t.planted)}</dd>
        <dt>Гарантия до</dt><dd>${fmtDateFull(t.warranty)}</dd>
        <dt>Датчик</dt><dd>${esc(plot.sensor)} (на участке)</dd>
        <dt>Координаты</dt><dd>${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}</dd>
      </dl>
      <a class="qr" href="#/tree/${encodeURIComponent(t.id)}" title="QR-паспорт: откройте, чтобы увидеть страницу, которую увидит горожанин">${qrSvg(passportUrl(t.id))}</a>
    </div>
    ${diagnosisHtml(d)}
    <div class="row no-print">
      <button class="btn" data-action="photo" data-id="${esc(t.id)}">Добавить фото</button>
      ${full ? '<button class="btn btn-ghost" onclick="window.print()">Печать паспорта</button>' : `<a class="btn btn-ghost" href="#/tree/${encodeURIComponent(t.id)}">Открыть паспорт</a>`}
    </div>
    <div class="section-title">Влажность почвы и поливы</div>
    ${moistureChart({
      moisture: state.series.moisture[t.plot] || [],
      weather: state.series.weather,
      checks,
      from,
      to,
      window: d.dead ? { from: d.facts.from, to: d.facts.to } : null,
      death: d.dead ? d.observed : null,
      wilt: WILT,
    })}
    <div class="section-title">NDVI участка (Sentinel-2)</div>
    ${ndviChart({ ndvi: state.series.ndvi[t.plot] || [], from, to, death: d.dead ? d.observed : null })}
    <div class="section-title">Фото (${photos.length})</div>
    <div class="photos">${
      photos.length
        ? photos
            .slice(0, full ? 50 : 5)
            .map((p) => `<div class="photo-row"><span>${fmtDate(p.date)} · ${p.source === 'citizen' ? 'горожанин' : 'обход'}${p.demo ? ' · демо' : ''}</span>
              <span class="${p.trusted ? (p.verdict === 'dry' ? 'bad' : 'ok') : 'warn'}">${p.trusted ? (p.verdict === 'dry' ? 'сухой' : 'живой') : 'на проверке'}</span></div>`)
            .join('')
        : '<p class="empty">Фото ещё нет.</p>'
    }</div>
    <div class="section-title">История событий</div>
    <ul class="timeline">${eventsOf(t, d)
      .reverse()
      .slice(0, full ? 200 : 14)
      .map((e) => `<li style="--tl:${e.color}"><time>${fmtDate(e.date)}</time>${e.text}</li>`)
      .join('')}</ul>`;
}

function plotCardHtml(pid) {
  const p = plotOf(pid);
  const date = state.asOf;
  const trees = state.district.trees.filter((t) => t.plot === pid);
  const statuses = trees.map((t) => ({ t, st: statusAt(state.diag.get(t.id), date) }));
  const alive = statuses.filter((x) => x.st === 'alive').length;
  const survival = alive / trees.length;
  const m = moistureAt(pid, date);
  const n = ndviAt(pid, date);
  const checks = state.engine.wateringChecks(pid, state.district.meta.start, date);
  const conf = checks.filter((c) => c.result === 'confirmed').length;
  const unconf = checks.filter((c) => c.result === 'unconfirmed').length;
  const causes = {};
  for (const x of statuses) if (x.st && x.st !== 'alive') causes[x.st] = (causes[x.st] || 0) + 1;
  return `
    <div class="card-head">
      <div><h2>${esc(p.name)}</h2><div class="sub">${esc(contractorOf(p.contractor).name)} · датчик ${esc(p.sensor)}</div></div>
      <span class="status ${survival < 0.6 ? 'status-dead' : 'status-alive'}">${pct(survival)} живы</span>
    </div>
    <div class="plot-stats">
      <div class="kpi"><b class="${m && m.v < WILT ? 'bad' : ''}">${m ? m.v + '%' : '—'}</b><span>влажность почвы${m && m.v < WILT ? ', ниже порога' : ''}</span></div>
      <div class="kpi"><b>${n ? n.v.toFixed(2) : '—'}</b><span>NDVI, снимок ${n ? fmtDate(n.date) : '—'}</span></div>
      <div class="kpi"><b>${checks.length}</b><span>поливов заявлено</span></div>
      <div class="kpi"><b class="${unconf > conf ? 'bad' : 'ok'}">${conf} / ${unconf}</b><span>подтверждено / нет</span></div>
    </div>
    ${Object.keys(causes).length ? `<p class="plot-causes">${Object.entries(causes)
      .map(([c, k]) => `<span><i class="dot" style="background:${CAUSE_COLOR[c]}"></i>${CAUSES[c].label}: ${k}</span>`)
      .join('')}</p>` : ''}
    <div class="section-title">Саженцы участка</div>
    <div class="tree-grid">${statuses
      .map(({ t, st }) => `<button class="tree-chip" data-tree="${t.id}" title="${esc(t.species)} · ${st === 'alive' ? 'жив' : CAUSES[st].label}">
        <i class="dot" style="background:${CAUSE_COLOR[st]}"></i>${esc(t.id.slice(-4))}</button>`)
      .join('')}</div>
    <div class="section-title">Влажность почвы и поливы за сезон</div>
    ${moistureChart({
      moisture: state.series.moisture[pid] || [],
      weather: state.series.weather,
      checks,
      from: state.district.meta.start,
      to: today(),
      window: null,
      death: date !== today() ? date : null,
      wilt: WILT,
    })}
    <div class="section-title">NDVI участка (Sentinel-2)</div>
    ${ndviChart({ ndvi: state.series.ndvi[pid] || [], from: state.district.meta.start, to: today(), death: date !== today() ? date : null })}
    <div class="row no-print" style="margin-top:12px">
      <a class="btn" href="#/report" data-report="${esc(p.contractor)}">Акт по подрядчику</a>
      <button class="btn btn-ghost" data-action="clear">Весь район</button>
    </div>`;
}

function renderDetail() {
  const el = $('#detail');
  if (state.selectedPlot) {
    el.innerHTML = `<div class="panel">${plotCardHtml(state.selectedPlot)}</div>`;
  } else if (state.selected) {
    const t = state.diag.get(state.selected).tree;
    el.innerHTML = `<div class="panel"><button class="link-btn no-print" data-plot="${t.plot}">← ${esc(plotOf(t.plot).name)}</button>${treeCardHtml(state.selected)}</div>`;
  } else {
    const deadList = [...state.diag.values()].filter((d) => d.dead).slice(0, 6);
    el.innerHTML = `<div class="panel"><h2 class="panel-title">Карточка саженца</h2>
      <p class="empty">Нажмите на точку на карте, чтобы открыть паспорт саженца, или на участок, чтобы увидеть его датчик и поливы.
      Шкала времени под картой проигрывает сезон.</p>
      <div class="section-title">Например, погибшие</div>
      ${deadList.map((d) => `<button class="alert" style="background:var(--card-2);border-color:var(--border)" data-tree="${d.tree.id}">${esc(d.tree.id)} · ${esc(d.tree.species)}<small style="color:${CAUSE_COLOR[d.cause]}">${d.label}</small></button>`).join('')}
    </div>`;
  }
  for (const b of el.querySelectorAll('[data-tree]')) b.addEventListener('click', () => selectTree(b.dataset.tree, true));
  for (const b of el.querySelectorAll('[data-plot]')) b.addEventListener('click', () => selectPlot(b.dataset.plot));
  for (const b of el.querySelectorAll('[data-report]')) b.addEventListener('click', () => setReportContractor(b.dataset.report));
  for (const b of el.querySelectorAll('[data-action="clear"]')) {
    b.addEventListener('click', () => {
      state.selected = null;
      state.selectedPlot = null;
      highlightSelected();
      renderDetail();
      fitDistrict();
    });
  }
  bindCardActions(el);
}

function bindCardActions(root) {
  for (const b of root.querySelectorAll('[data-action="photo"]')) b.addEventListener('click', () => openPhotoDialog(b.dataset.id));
}

function selectTree(id, pan = false) {
  state.selected = id;
  state.selectedPlot = null;
  highlightSelected();
  renderDetail();
  const t = state.diag.get(id).tree;
  if (pan) map.flyTo([t.lat, t.lon], Math.max(map.getZoom(), 17), { duration: 0.6 });
  scrollDetailIntoView();
}

function selectPlot(id, fly = false) {
  state.selectedPlot = id;
  state.selected = null;
  highlightSelected();
  renderDetail();
  if (fly) map.flyToBounds(L.latLngBounds(plotOf(id).polygon).pad(0.4), { duration: 0.6 });
  scrollDetailIntoView();
}

// На телефоне карточка под картой: прокручиваем к ней.
function scrollDetailIntoView() {
  if (window.matchMedia('(max-width: 720px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- фото горожанина ----------

function openPhotoDialog(id) {
  const t = state.diag.get(id).tree;
  const dlg = $('#photo-dialog');
  dlg.innerHTML = `
    <h3>Фото саженца ${esc(t.id)}</h3>
    <p class="hint" style="margin-top:0">Снимите саженец целиком. Фото проверяется по GPS, дате съёмки, повторам и цвету листвы.</p>
    <label class="btn btn-ghost file-btn">Выбрать фото<input type="file" accept="image/*" capture="environment" hidden id="photo-input"></label>
    <label class="toggle" style="margin-top:8px"><input type="checkbox" id="photo-demo"> Режим демонстрации: фото сделано не у этого саженца</label>
    <div id="photo-result"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost" id="photo-cancel">Закрыть</button>
      <button class="btn" id="photo-save" hidden>Сохранить</button>
    </div>`;
  dlg.showModal();
  let result = null;
  const run = async () => {
    const file = $('#photo-input').files[0];
    if (!file) return;
    $('#photo-result').innerHTML = '<p class="hint">Проверяю фото…</p>';
    try {
      result = await checkPhoto(file, t, {
        knownHashes: new Set(state.local.hashes || []),
        demoAtTree: $('#photo-demo').checked,
      });
    } catch (err) {
      $('#photo-result').innerHTML = `<p class="bad">Не удалось прочитать фото: ${esc(err.message)}</p>`;
      return;
    }
    const url = URL.createObjectURL(file);
    $('#photo-result').innerHTML = `
      <img class="preview" src="${url}" alt="Загруженное фото">
      <ul class="checks">${result.checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join('')}</ul>
      <p class="${result.trusted ? 'ok' : 'warn'}"><b>${result.trusted
        ? `Фото принято: саженец ${result.verdict === 'dry' ? 'сухой' : 'живой'}.`
        : 'Фото сохранится, но не изменит статус, пока его не подтвердит инспектор.'}</b></p>`;
    $('#photo-save').hidden = false;
  };
  $('#photo-input').addEventListener('change', run);
  $('#photo-demo').addEventListener('change', run);
  $('#photo-cancel').addEventListener('click', () => dlg.close());
  $('#photo-save').addEventListener('click', () => {
    if (!result) return;
    const photo = {
      date: result.date,
      source: 'citizen',
      verdict: result.verdict,
      trusted: result.trusted,
      lat: result.lat,
      lon: result.lon,
      demo: result.demo,
    };
    state.local.photos = state.local.photos || {};
    (state.local.photos[id] = state.local.photos[id] || []).push(photo);
    state.local.hashes = [...(state.local.hashes || []), result.hash];
    store.save(state.local);
    dlg.close();
    refresh();
  });
}

// ---------- импорт CSV датчика ----------

function bindSensorImport() {
  $('#sensor-csv').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const added = {};
    let n = 0;
    for (const line of rows) {
      const [plot, date, value] = line.split(/[,;]/).map((s) => s.trim());
      if (!/^\d{4}-\d{2}-\d{2}/.test(date || '') || isNaN(+value) || !plotOf(plot)) continue;
      (added[plot] = added[plot] || []).push({ date: date.slice(0, 10), v: Math.round(+value * 10) / 10 });
      n++;
    }
    state.local.moisture = state.local.moisture || {};
    for (const [p, list] of Object.entries(added)) state.local.moisture[p] = [...(state.local.moisture[p] || []), ...list];
    store.save(state.local);
    $('#sensor-import-status').textContent = n ? `Загружено ${n} замеров по ${Object.keys(added).length} участкам.` : 'Не нашла строк формата plot_id,date,moisture.';
    refresh();
  });
}

// ---------- страницы ----------

function renderTreePage(id) {
  const el = $('#view-tree');
  if (!state.diag.has(id)) {
    el.innerHTML = `<div class="page"><h1>Саженец не найден</h1><p class="lead">Проверьте QR-код. <a href="#/">На карту</a></p></div>`;
    return;
  }
  el.innerHTML = `<div class="page"><p class="no-print"><a href="#/">← Карта района</a></p>
    <div class="panel">${treeCardHtml(id, { full: true })}</div></div>`;
  bindCardActions(el);
}

function renderAbout() {
  $('#view-about').innerHTML = `<div class="page about">
    <h1>Tamyr</h1>
    <p class="lead">Доказательство, что дерево выжило. VENTUREHACK 2026 · Трек 3 · Open Innovation.</p>
    <div class="panel">
      <h2>Проблема</h2>
      <p>В городах Казахстана гибнет 50–70% саженцев, а причину гибели установить нечем. Поэтому модель «платить подрядчику за выжившие деревья» отклонили, и одни и те же территории озеленяют повторно.</p>
      <h2>Решение</h2>
      <p>Каждый саженец получает паспорт с QR. Вокруг него копятся события из трёх независимых источников: датчик влажности почвы, спутниковый NDVI и фото горожан и обходов. Движок причины смотрит на последовательность событий и отличает засуху, невыполненный полив и плохой посадочный материал.</p>
      <h2>Что в этом MVP</h2>
      <ul>
        <li>Карта района со слоями саженцев и NDVI участков.</li>
        <li>Паспорт саженца с QR, графиками, фото и историей событий.</li>
        <li>Движок причины гибели с уверенностью и списком доказательств.</li>
        <li>Проверка фото горожанина: GPS, дата, повторы, анализ зелени.</li>
        <li>Автонаряды на полив и акт для акимата с печатью в PDF.</li>
      </ul>
      <h2>Честно о данных</h2>
      <p>${state.district.meta.dataSource === 'synthetic'
        ? 'Сейчас приложение работает на демо-данных, которые генерирует симулятор района (scripts/sim.mjs). Скрипты в папке scripts подключают реальную погоду Open-Meteo, NDVI из Sentinel-2 и CSV с датчика ESP32.'
        : 'Приложение работает на данных из подключённых источников.'}</p>
    </div></div>`;
}

// ---------- маршрутизация ----------

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  const views = { map: '#view-map', tree: '#view-tree', report: '#view-report', about: '#view-about' };
  const current = views[page] ? page : 'map';
  for (const [k, sel] of Object.entries(views)) $(sel).hidden = k !== current;
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.route === current);
  if (current === 'tree') renderTreePage(decodeURIComponent(arg || ''));
  if (current === 'report') renderReport($('#view-report'), state, { CAUSE_COLOR });
  if (current === 'about') renderAbout();
  if (current === 'map') {
    setTimeout(() => {
      map.invalidateSize();
      // Первый показ: подогнать карту под район, когда контейнер уже получил размер.
      if (!fitted) fitDistrict(false);
      fitted = true;
    }, 0);
  }
  window.scrollTo(0, 0);
}

function refresh() {
  rebuild();
  renderSidebar();
  drawMap();
  renderDetail();
  if (!$('#view-tree').hidden || !$('#view-report').hidden) route();
}

async function main() {
  await loadData();
  state.asOf = today();
  initMap();
  renderSidebar();
  renderDetail();
  bindSensorImport();
  window.addEventListener('hashchange', route);
  route();
  window.tamyr = state; // для отладки в консоли
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<p style="padding:16px" class="bad">Не удалось загрузить данные: ${esc(err.message)}. Запустите через npm start, а не открытием файла.</p>`);
});
