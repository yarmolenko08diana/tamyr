// Генерирует демо-данные района в data/. Детерминированно: один и тот же seed даёт те же данные.
// Запуск: node scripts/generate-demo-data.mjs
// Реальные погода и NDVI подменяют синтетику скриптами fetch-weather.mjs и import-ndvi.mjs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { rng } from './sim.mjs';
import { buildDistrict } from './district.mjs';

const SEED = 2026;
const r = rng(SEED);

// Два ряда участков на левом берегу Астаны. Координаты условные.
const row = (i) => ({ lat: 51.1262 - (i < 4 ? 0 : 0.0021), lon: 71.4185 + (i % 4) * 0.0036 });
const plotsSpec = [
  { id: 'P01', name: 'Бульвар, участок 1', contractor: 'C1', care: 'good', batches: ['B1', 'B2'] },
  { id: 'P02', name: 'Бульвар, участок 2', contractor: 'C1', care: 'good', batches: ['B2', 'B5'] },
  { id: 'P03', name: 'Бульвар, участок 3', contractor: 'C2', care: 'no_watering', batches: ['B1', 'B2'] },
  { id: 'P04', name: 'Бульвар, участок 4', contractor: 'C1', care: 'drought', batches: ['B4'] },
  { id: 'P05', name: 'Сквер, участок 5', contractor: 'C3', care: 'good', batches: ['B3'] },
  { id: 'P06', name: 'Сквер, участок 6', contractor: 'C3', care: 'good', batches: ['B3', 'B2'] },
  { id: 'P07', name: 'Сквер, участок 7', contractor: 'C2', care: 'good', batches: ['B1', 'B5'] },
  { id: 'P08', name: 'Сквер, участок 8', contractor: 'C2', care: 'partial', batches: ['B4', 'B2'] },
].map((p, i) => ({ ...p, ...row(i) }));

const { district, series, truth } = buildDistrict(r, {
  start: '2026-04-20',
  end: '2026-09-20',
  heatwave: { from: '2026-07-04', to: '2026-07-24', plus: 6 },
  plotsSpec,
  badBatches: ['B3'],
});

mkdirSync('data', { recursive: true });
writeFileSync('data/district.json', JSON.stringify(district, null, 1));
writeFileSync('data/series.json', JSON.stringify(series));
// Истинные причины демо-данных: только для проверки, приложение их не читает.
writeFileSync('data/demo-truth.json', JSON.stringify(truth, null, 1));

const dead = Object.values(truth).filter((t) => t.died).length;
console.log(`Участков: ${district.plots.length}, саженцев: ${district.trees.length}, погибло: ${dead}`);
