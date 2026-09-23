// Интерфейс Tamyr: карта района, карточка и паспорт саженца, проверка фото, акт для акимата.

import { createEngine, CAUSES, WILT, WINDOW } from './engine.js';
import { moistureChart, ndviChart } from './charts.js';
import { checkPhoto } from './photo.js';
import { renderReport } from './report.js';
import { fmtDate, fmtDateFull } from './dates.js';

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

const state = {
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
const colorOf = (d) => (d.dead ? CAUSE_COLOR[d.cause] : CAUSE_COLOR.alive);
const today = () => state.district.meta.today;

// ---------- карта ----------

let map, treeLayer, ndviLayer, districtBounds;
let fitted = false;
const markers = new Map();

function ndviColor(v) {
  if (v == null) return '#2a3c36';
  if (v < 0.25) return '#8a5a2b';
  if (v < 0.35) return '#b39b3a';
  if (v < 0.45) return '#5fae5a';
  return '#2f9e5b';
}

function latestNdvi(pid) {
  const rows = (state.series.ndvi[pid] || []).filter((n) => n.v != null);
  return rows[rows.length - 1] || null;
}

function initMap() {
  const plots = state.district.plots;
  map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemap.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap, © CARTO',
  }).addTo(map);
  ndviLayer = L.layerGroup().addTo(map);
  treeLayer = L.layerGroup().addTo(map);
  districtBounds = L.latLngBounds(plots.flatMap((p) => p.polygon)).pad(0.08);
  map.fitBounds(districtBounds);
  drawMap();
  $('#layer-trees').addEventListener('change', (e) => (e.target.checked ? treeLayer.addTo(map) : treeLayer.remove()));
  $('#layer-ndvi').addEventListener('change', (e) => (e.target.checked ? ndviLayer.addTo(map) : ndviLayer.remove()));
}

function drawMap() {
  ndviLayer.clearLayers();
  treeLayer.clearLayers();
  markers.clear();
  for (const p of state.district.plots) {
    const n = latestNdvi(p.id);
    const dead = state.district.trees.filter((t) => t.plot === p.id && state.diag.get(t.id).dead).length;
    const total = state.district.trees.filter((t) => t.plot === p.id).length;
    L.polygon(p.polygon, { color: '#3a4c45', weight: 1, fillColor: ndviColor(n?.v), fillOpacity: 0.45 })
      .bindPopup(
        `<b>${esc(p.name)}</b><br>${esc(contractorOf(p.contractor).name)}<br>` +
          `Датчик ${p.sensor} · NDVI ${n ? n.v.toFixed(2) : '—'} (${n ? fmtDate(n.date) : 'нет снимка'})<br>` +
          `Погибло ${dead} из ${total}`,
      )
      .addTo(ndviLayer);
  }
  for (const t of state.district.trees) {
    const d = state.diag.get(t.id);
    const m = L.circleMarker([t.lat, t.lon], {
      radius: 6,
      color: '#0b1110',
      weight: 1.5,
      fillColor: colorOf(d),
      fillOpacity: 1,
    })
      .bindTooltip(`${t.id} · ${t.species}${d.dead ? ` · ${d.label}` : ''}`)
      .on('click', () => selectTree(t.id))
      .addTo(treeLayer);
    markers.set(t.id, m);
  }
  highlightSelected();
}

function highlightSelected() {
  for (const [id, m] of markers) m.setStyle({ radius: id === state.selected ? 9 : 6, color: id === state.selected ? '#ffffff' : '#0b1110' });
}

// ---------- боковая панель ----------

function renderSidebar() {
  const all = [...state.diag.values()];
  const dead = all.filter((d) => d.dead);
  const survival = 1 - dead.length / all.length;
  $('#city-pill').textContent = `${state.district.meta.city} · ${state.district.meta.district}`;
  $('#data-pill').hidden = state.district.meta.dataSource !== 'synthetic';
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
      <div class="bar-row" title="${esc(CAUSES[c].advice)}">
        <div class="bar-label"><span><i class="dot" style="background:${CAUSE_COLOR[c]}"></i>${CAUSES[c].label}</span><b>${counts[c]}</b></div>
        <div class="bar"><i style="width:${(100 * counts[c]) / dead.length}%;background:${CAUSE_COLOR[c]}"></i></div>
      </div>`)
        .join('')
    : '<p class="empty">Погибших саженцев нет.</p>';

  const alerts = state.engine.plotAlerts(today());
  $('#alerts-count').textContent = alerts.length || '';
  $('#alerts').innerHTML = alerts.length
    ? alerts
        .map((a) => `<button class="alert" data-plot="${a.plot.id}">Наряд на полив: ${esc(a.plot.name)}
          <small>Влажность ${a.moisture ?? '—'}% ниже порога ${WILT}% уже ${a.dryDays} дня · ${esc(contractorOf(a.plot.contractor).name)}</small></button>`)
        .join('')
    : '<p class="empty">Все участки в норме на ' + fmtDate(today()) + '.</p>';
  for (const b of document.querySelectorAll('#alerts .alert')) {
    b.addEventListener('click', () => {
      const p = plotOf(b.dataset.plot);
      map.fitBounds(L.latLngBounds(p.polygon).pad(0.6));
    });
  }

  $('#legend').innerHTML = [
    ['alive', 'Жив'],
    ['no_watering', CAUSES.no_watering.label],
    ['drought', CAUSES.drought.label],
    ['bad_material', CAUSES.bad_material.label],
    ['unknown', CAUSES.unknown.label],
  ]
    .map(([k, l]) => `<span><i class="dot" style="background:${CAUSE_COLOR[k]}"></i>${l}</span>`)
    .join('');
  $('#map-caption').textContent = `Данные на ${fmtDateFull(today())} · участки окрашены по последнему NDVI`;
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

function renderDetail() {
  const el = $('#detail');
  if (!state.selected) {
    const deadList = [...state.diag.values()].filter((d) => d.dead).slice(0, 6);
    el.innerHTML = `<div class="panel"><h2 class="panel-title">Карточка саженца</h2>
      <p class="empty">Нажмите на точку на карте, чтобы увидеть паспорт саженца, историю событий и причину гибели.</p>
      <div class="section-title">Например, погибшие</div>
      ${deadList.map((d) => `<button class="alert" style="background:var(--card-2);border-color:var(--border)" data-tree="${d.tree.id}">${esc(d.tree.id)} · ${esc(d.tree.species)}<small style="color:${CAUSE_COLOR[d.cause]}">${d.label}</small></button>`).join('')}
    </div>`;
    for (const b of el.querySelectorAll('[data-tree]')) b.addEventListener('click', () => selectTree(b.dataset.tree, true));
    return;
  }
  el.innerHTML = `<div class="panel">${treeCardHtml(state.selected)}</div>`;
  bindCardActions(el);
}

function bindCardActions(root) {
  for (const b of root.querySelectorAll('[data-action="photo"]')) b.addEventListener('click', () => openPhotoDialog(b.dataset.id));
}

function selectTree(id, pan = false) {
  state.selected = id;
  highlightSelected();
  renderDetail();
  const t = state.diag.get(id).tree;
  if (pan && !map.getBounds().contains([t.lat, t.lon])) map.panTo([t.lat, t.lon]);
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
      if (!fitted) map.fitBounds(districtBounds);
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
