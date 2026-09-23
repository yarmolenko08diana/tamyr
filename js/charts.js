// Простые SVG-графики без библиотек: влажность почвы с поливами и NDVI участка.

import { daysBetween, fmtDate, addDays } from './dates.js';

const W = 360;
const PAD = { l: 26, r: 8, t: 14, b: 18 };

function frame(from, to, h, yMax, yTicks) {
  const span = Math.max(1, daysBetween(from, to));
  const x = (d) => PAD.l + ((W - PAD.l - PAD.r) * daysBetween(from, d)) / span;
  const y = (v) => h - PAD.b - ((h - PAD.t - PAD.b) * v) / yMax;
  let axes = '';
  for (const t of yTicks) {
    axes += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}" stroke="#1f2d28"/>`;
    axes += `<text x="${PAD.l - 4}" y="${y(t) + 3}" text-anchor="end">${t}</text>`;
  }
  // Подписи месяцев по первым числам
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d.endsWith('-01')) axes += `<text x="${x(d)}" y="${h - 4}" text-anchor="middle">${fmtDate(d).split(' ')[1]}</text>`;
  }
  return { x, y, axes };
}

function path(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

const CHECK_COLOR = { confirmed: '#3ddc84', unconfirmed: '#f4573b', rain: '#56a8f0', wet: '#7c8f89', nodata: '#5f736d' };

export function moistureChart({ moisture, weather, checks, from, to, window, death, wilt }) {
  const h = 160;
  const { x, y, axes } = frame(from, to, h, 40, [0, 12, 20, 30, 40]);
  let heat = '';
  for (const w of weather) {
    if (w.date < from || w.date > to || w.tmax < 32) continue;
    heat += `<rect x="${x(w.date)}" y="${PAD.t}" width="${Math.max(1.5, x(addDays(w.date, 1)) - x(w.date))}" height="${h - PAD.t - PAD.b}" fill="#f2b036" opacity="0.12"/>`;
  }
  const win = window
    ? `<rect x="${x(window.from)}" y="${PAD.t}" width="${x(window.to) - x(window.from)}" height="${h - PAD.t - PAD.b}" fill="#ffffff" opacity="0.04"/>`
    : '';
  const pts = moisture.filter((m) => m.date >= from && m.date <= to).map((m) => (m.v == null ? null : [x(m.date), y(m.v)]));
  const marks = checks
    .filter((c) => c.date >= from && c.date <= to)
    .map((c) => {
      const cx = x(c.date);
      return `<path d="M${cx - 3.5},${PAD.t - 9} L${cx + 3.5},${PAD.t - 9} L${cx},${PAD.t - 3} Z" fill="${CHECK_COLOR[c.result]}"><title>${fmtDate(c.date)}: ${c.result}</title></path>`;
    })
    .join('');
  const deathLine = death
    ? `<line x1="${x(death)}" x2="${x(death)}" y1="${PAD.t}" y2="${h - PAD.b}" stroke="#f4573b" stroke-dasharray="3 3"/>`
    : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Влажность почвы и поливы">
    ${axes}${heat}${win}
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(wilt)}" y2="${y(wilt)}" stroke="#f4573b" stroke-width="1" opacity="0.6"/>
    <path d="${path(pts)}" fill="none" stroke="#3ddc84" stroke-width="1.6"/>
    ${marks}${deathLine}
  </svg>
  <div class="chart-legend">
    <span><i class="dot" style="background:#3ddc84"></i>полив подтверждён</span>
    <span><i class="dot" style="background:#f4573b"></i>полив не подтверждён</span>
    <span><i class="dot" style="background:#56a8f0"></i>дождь</span>
    <span><i class="dot" style="background:#f2b036;opacity:.5"></i>жара ≥ 32°C</span>
    <span>красная линия — порог ${wilt}%</span>
  </div>`;
}

export function ndviChart({ ndvi, from, to, death }) {
  const h = 110;
  const { x, y, axes } = frame(from, to, h, 0.7, [0, 0.2, 0.4, 0.6]);
  const rows = ndvi.filter((n) => n.date >= from && n.date <= to && n.v != null);
  const pts = rows.map((n) => [x(n.date), y(n.v)]);
  const dots = rows.map((n) => `<circle cx="${x(n.date)}" cy="${y(n.v)}" r="2.2" fill="#8bf0b5"><title>${fmtDate(n.date)}: ${n.v}</title></circle>`).join('');
  const deathLine = death
    ? `<line x1="${x(death)}" x2="${x(death)}" y1="${PAD.t}" y2="${h - PAD.b}" stroke="#f4573b" stroke-dasharray="3 3"/>`
    : '';
  const cloudy = ndvi.filter((n) => n.date >= from && n.date <= to && n.v == null).length;
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="NDVI участка">
    ${axes}<path d="${path(pts)}" fill="none" stroke="#8bf0b5" stroke-width="1.4" opacity="0.8"/>${dots}${deathLine}
  </svg>
  <div class="chart-legend"><span>Снимок раз в 5 дней, ${cloudy} закрыты облаками</span></div>`;
}
