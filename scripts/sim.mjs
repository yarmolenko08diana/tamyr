// Симулятор района озеленения: погода, влажность почвы, NDVI, гибель саженцев, фото.
// Нужен для демо-данных и для проверки движка на сценариях с заранее известной причиной.
// Реальные данные подключаются скриптами fetch-weather.mjs и import-ndvi.mjs.

import { addDays, dateRange, daysBetween } from '../js/dates.js';

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.normal = () => {
    const u = 1 - next(), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

// Выше этой влажности вода уходит в дренаж, поэтому полив по мокрой почве датчик почти не видит.
export const FIELD_CAPACITY = 34;

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// Погода степного города: пик жары в июле, редкие дожди, одна волна жары.
export function makeWeather(r, start, end, heatwave) {
  const days = dateRange(start, end);
  const n = days.length;
  return days.map((date, i) => {
    const hot = heatwave && date >= heatwave.from && date <= heatwave.to;
    let tmax = 15 + 13 * Math.sin((Math.PI * i) / (n * 1.15)) + r.normal() * 3;
    let precip = r() < 0.2 ? round1(-Math.log(1 - r()) * 4) : 0;
    if (hot) {
      tmax += heatwave.plus ?? 7;
      precip = 0;
    }
    return { date, tmax: round1(tmax), precip };
  });
}

// Объёмная влажность почвы в корневой зоне, %. Порог завядания ~12%.
// actuallyWatered: Set дат, когда полив реально был (не путать с отчётом подрядчика).
export function simulateMoisture(r, weather, actuallyWatered, opts = {}) {
  const k = opts.evapK ?? 1;
  const gap = opts.gapRate ?? 0.04;
  let v = opts.start ?? 24;
  return weather.map((w) => {
    v -= (0.6 + 0.13 * Math.max(w.tmax - 12, 0)) * k;
    v += w.precip * 1.1;
    if (actuallyWatered.has(w.date)) v += r.range(12, 16);
    v = Math.min(FIELD_CAPACITY, Math.max(4, v));
    const reading = r() < gap ? null : round1(v + r.normal() * 0.6);
    return { date: w.date, v: reading };
  });
}

// NDVI участка по Sentinel-2: раз в 5 дней, часть снимков закрыта облаками.
// Участок 10-метровыми пикселями видит газон и кроны вместе, поэтому реагирует на засуху участка,
// но почти не видит гибель отдельного саженца.
export function simulateNdvi(r, weather, moisture, opts = {}) {
  const out = [];
  const n = weather.length;
  for (let i = 2; i < n; i += 5) {
    const season = 0.34 + 0.24 * Math.sin((Math.PI * i) / (n * 1.1));
    const recent = moisture.slice(Math.max(0, i - 12), i + 1).filter((m) => m.v !== null);
    const stress = recent.length ? recent.filter((m) => m.v < 12).length / recent.length : 0;
    const cloudy = r() < (opts.cloudRate ?? 0.25);
    const v = season - 0.22 * stress + r.normal() * 0.02;
    out.push({ date: weather[i].date, v: cloudy ? null : round2(v) });
  }
  return out;
}

// Отчёт подрядчика о поливах по графику и что было на самом деле.
export function wateringPlan(r, start, end, everyDays, realShare) {
  const reported = [];
  const actual = new Set();
  let d = addDays(start, r.int(0, 2));
  while (d <= end) {
    reported.push(d);
    if (r() < realShare) actual.add(d);
    d = addDays(d, everyDays);
  }
  return { reported, actual };
}

// Когда саженец погибает. cause задаёт механизм, который мы потом пытаемся восстановить движком.
export function deathDate(r, tree, moisture, cause) {
  if (cause === 'bad_material') {
    return addDays(tree.planted, r.int(18, 50));
  }
  // Гибель от пересыхания: накопленный стресс за скользящие 20 дней превышает порог дерева.
  const tolerance = r.int(5, 9);
  for (let i = 0; i < moisture.length; i++) {
    if (moisture[i].date < tree.planted) continue;
    const win = moisture.slice(Math.max(0, i - 19), i + 1);
    const dry = win.filter((m) => m.v !== null && m.v < 10.5).length;
    if (dry >= tolerance && r() < 0.35) return moisture[i].date;
  }
  return null;
}

// Фото: плановые обходы раз в месяц плюс случайные фото горожан.
export function makePhotos(r, tree, died, start, end, opts = {}) {
  const photos = [];
  const obs = [];
  for (let d = addDays(start, 30); d <= end; d = addDays(d, 30)) obs.push({ date: d, source: 'inspection' });
  const citizen = opts.citizenRate ?? 0.06;
  for (const d of dateRange(addDays(tree.planted, 7), end)) {
    if (r() < citizen / 7) obs.push({ date: d, source: 'citizen' });
  }
  obs.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const o of obs) {
    if (o.date < tree.planted) continue;
    const dead = died && daysBetween(died, o.date) >= 4;
    photos.push({
      date: o.date,
      source: o.source,
      verdict: dead ? 'dry' : 'alive',
      trusted: true,
      lat: round6(tree.lat + r.normal() * 0.00003),
      lon: round6(tree.lon + r.normal() * 0.00003),
    });
  }
  return photos;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Сценарии ухода за участком. Ключ совпадает с причиной, которую должен найти движок.
export const CARE = {
  good: { every: [3, 4], real: [0.9, 1.0] },
  no_watering: { every: [4, 5], real: [0.1, 0.35] },
  drought: { every: [7, 8], real: [0.9, 1.0] },
  bad_material: { every: [3, 4], real: [0.9, 1.0] },
  partial: { every: [4, 4], real: [0.45, 0.6] },
};

export function simulatePlot(r, weather, start, end, careKey) {
  const care = CARE[careKey];
  const every = r.int(care.every[0], care.every[1]);
  const plan = wateringPlan(r, start, end, every, r.range(care.real[0], care.real[1]));
  const moisture = simulateMoisture(r, weather, plan.actual, { evapK: r.range(0.92, 1.08) });
  const ndvi = simulateNdvi(r, weather, moisture);
  return { reported: plan.reported, actual: [...plan.actual], moisture, ndvi, every };
}
