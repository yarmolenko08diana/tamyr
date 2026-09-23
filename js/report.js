// Акт для акимата: погибшие саженцы, причина, ответственный и ключевое доказательство.
// Печатается в PDF средствами браузера (Печать → Сохранить как PDF), кириллица сохраняется.

import { CAUSES } from './engine.js';
import { fmtDate, fmtDateFull } from './dates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n));

let filter = { contractor: 'all', cost: 0 };

export function setReportContractor(id) {
  filter.contractor = id;
}

export function renderReport(el, state, { CAUSE_COLOR }) {
  const { district } = state;
  const contractors = district.contractors;
  const plotsById = new Map(district.plots.map((p) => [p.id, p]));
  const all = [...state.diag.values()];
  const inScope = (d) => filter.contractor === 'all' || plotsById.get(d.tree.plot).contractor === filter.contractor;
  const trees = all.filter(inScope);
  const dead = trees.filter((d) => d.dead).sort((a, b) => (a.observed < b.observed ? -1 : 1));
  const byCause = {};
  for (const d of dead) byCause[d.cause] = (byCause[d.cause] || 0) + 1;
  const guilty = dead.filter((d) => d.cause === 'no_watering').length;
  const name = filter.contractor === 'all' ? 'все подрядчики' : contractors.find((c) => c.id === filter.contractor).name;

  el.innerHTML = `<div class="page">
    <div class="row no-print" style="justify-content:space-between;margin-bottom:12px">
      <div class="row">
        <label class="field">Подрядчик
          <select id="rep-contractor">
            <option value="all">Все подрядчики</option>
            ${contractors.map((c) => `<option value="${c.id}" ${c.id === filter.contractor ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">Стоимость восстановления 1 саженца, ₸
          <input id="rep-cost" type="number" min="0" step="1000" value="${filter.cost || ''}" placeholder="уточняется у акимата">
        </label>
      </div>
      <button class="btn" onclick="window.print()">Сохранить в PDF</button>
    </div>
    <div class="panel">
      <h1>Акт о состоянии зелёных насаждений</h1>
      <p class="lead">${esc(district.meta.city)}, ${esc(district.meta.district)} · ${esc(name)} · на ${fmtDateFull(district.meta.today)}
        ${district.meta.dataSource === 'synthetic' ? '<br><span class="warn">Сформирован на демо-данных.</span>' : ''}</p>
      <div class="act-summary">
        <div class="kpi"><b>${trees.length}</b><span>саженцев в акте</span></div>
        <div class="kpi"><b>${dead.length}</b><span>погибло</span></div>
        ${Object.keys(CAUSES).filter((c) => byCause[c]).map((c) => `<div class="kpi"><b style="color:${CAUSE_COLOR[c]}">${byCause[c]}</b><span>${CAUSES[c].label.toLowerCase()}</span></div>`).join('')}
      </div>
      <p>${guilty
        ? `По ${guilty} саженцам гибель вызвана невыполненным поливом: отчёты о поливе не подтверждаются датчиком влажности. Эти саженцы подрядчик восстанавливает за свой счёт по гарантии.`
        : 'Саженцев, погибших по вине подрядчика, в акте нет.'}
        ${guilty && filter.cost ? ` Сумма к удержанию: <b>${money(guilty * filter.cost)} ₸</b> (${guilty} × ${money(filter.cost)} ₸).` : ''}</p>
      ${dead.length ? `<table class="act">
        <thead><tr><th>#</th><th>Саженец</th><th>Участок</th><th>Замечено</th><th>Причина</th><th>Ответственный</th><th>Главное доказательство</th></tr></thead>
        <tbody>${dead.map((d, i) => {
          const key = d.evidence.find((e) => e.key) || d.evidence.find((e) => e.forCause) || d.evidence[0];
          return `<tr>
            <td>${i + 1}</td>
            <td><a href="#/tree/${encodeURIComponent(d.tree.id)}">${esc(d.tree.id)}</a><br><small>${esc(d.tree.species)}</small></td>
            <td>${esc(plotsById.get(d.tree.plot).name)}</td>
            <td>${fmtDate(d.observed)}</td>
            <td style="color:${CAUSE_COLOR[d.cause]}">${d.label}<br><small>уверенность ${Math.round(d.confidence * 100)}%</small></td>
            <td>${esc(d.responsible.name)}</td>
            <td><small>${esc(key?.text)}</small></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<p class="empty">Погибших саженцев нет.</p>'}
      <p class="hint">Каждая строка раскрывается до паспорта саженца: графика влажности, отчётов о поливе, снимков и фото.
        Причина определена автоматически движком Tamyr и подлежит подтверждению комиссией.</p>
    </div></div>`;

  el.querySelector('#rep-contractor').addEventListener('change', (e) => {
    filter.contractor = e.target.value;
    renderReport(el, state, { CAUSE_COLOR });
  });
  el.querySelector('#rep-cost').addEventListener('change', (e) => {
    filter.cost = Math.max(0, +e.target.value || 0);
    renderReport(el, state, { CAUSE_COLOR });
  });
}
