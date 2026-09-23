// Генерирует демо-данные района в data/. Детерминированно: один и тот же seed даёт те же данные.
// Запуск: node scripts/generate-demo-data.mjs
// Реальные погода и NDVI подменяют синтетику скриптами fetch-weather.mjs и import-ndvi.mjs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rng } from './sim.mjs';
import { buildDistrict } from './district.mjs';

const SEED = 2026;
const r = rng(SEED);

// Участки на бульваре Нуржол к востоку от Хан Шатыра: парк, двор-кольцо и аллея бульвара.
// Контуры и точки саженцев размечены по спутниковому снимку (scripts/layout-from-imagery.py):
// саженцы стоят там, где на снимке кроны, а не ровными рядами. Какие деревья «наши» — условно.
const LAYOUT = JSON.parse(readFileSync(new URL('../data/nurzhol-layout.json', import.meta.url), 'utf8'));

const plotsSpec = [
  { id: 'P01', name: 'Нуржол, север, участок 1', contractor: 'C1', care: 'good', batches: ['B1', 'B2'], layout: LAYOUT.P01 },
  { id: 'P02', name: 'Нуржол, север, участок 2', contractor: 'C1', care: 'good', batches: ['B2', 'B5'], layout: LAYOUT.P02 },
  { id: 'P03', name: 'Нуржол, север, участок 3', contractor: 'C2', care: 'no_watering', batches: ['B1', 'B2'], layout: LAYOUT.P03 },
  { id: 'P04', name: 'Нуржол, север, участок 4', contractor: 'C1', care: 'drought', batches: ['B4'], layout: LAYOUT.P04 },
  { id: 'P05', name: 'Нуржол, юг, участок 5', contractor: 'C3', care: 'good', batches: ['B3'], layout: LAYOUT.P05 },
  { id: 'P06', name: 'Нуржол, юг, участок 6', contractor: 'C3', care: 'good', batches: ['B3', 'B2'], layout: LAYOUT.P06 },
  { id: 'P07', name: 'Нуржол, юг, участок 7', contractor: 'C2', care: 'good', batches: ['B1', 'B5'], layout: LAYOUT.P07 },
  { id: 'P08', name: 'Нуржол, юг, участок 8', contractor: 'C2', care: 'partial', batches: ['B4', 'B2'], layout: LAYOUT.P08 },
];

const { district, series, truth } = buildDistrict(r, {
  start: '2026-04-20',
  end: '2026-09-20',
  heatwave: { from: '2026-07-04', to: '2026-07-24', plus: 6 },
  plotsSpec,
  badBatches: ['B3'],
  districtName: 'Бульвар Нуржол (демо)',
});

mkdirSync('data', { recursive: true });
writeFileSync('data/district.json', JSON.stringify(district, null, 1));
writeFileSync('data/series.json', JSON.stringify(series));
// Истинные причины демо-данных: только для проверки, приложение их не читает.
writeFileSync('data/demo-truth.json', JSON.stringify(truth, null, 1));

const dead = Object.values(truth).filter((t) => t.died).length;
console.log(`Участков: ${district.plots.length}, саженцев: ${district.trees.length}, погибло: ${dead}`);
