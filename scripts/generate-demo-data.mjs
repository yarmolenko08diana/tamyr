// Генерирует демо-данные района в data/. Детерминированно: один и тот же seed даёт те же данные.
// Запуск: node scripts/generate-demo-data.mjs
// Реальные погода и NDVI подменяют синтетику скриптами fetch-weather.mjs и import-ndvi.mjs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { rng } from './sim.mjs';
import { buildDistrict } from './district.mjs';

const SEED = 2026;
const r = rng(SEED);

// Участки вдоль Водно-зелёного бульвара (Нуржол) между Хан Шатыром и Байтереком:
// четыре по северной стороне и четыре по южной. Координаты концов оси бульвара — по этим двум
// ориентирам; положение участков внутри бульвара условное.
const KHAN_SHATYR = [51.13253, 71.40375];
const BAITEREK = [51.12832, 71.43059];
const mLon = 111320 * Math.cos((KHAN_SHATYR[0] * Math.PI) / 180);
const dE = (BAITEREK[1] - KHAN_SHATYR[1]) * mLon;
const dN = (BAITEREK[0] - KHAN_SHATYR[0]) * 111320;
const len = Math.hypot(dE, dN);
const u = [dE / len, dN / len]; // вдоль бульвара на восток
const vNorth = [-u[1], u[0]]; // поперёк, на север
const PLOT_LEN = 180;
const STEP = 330; // начало следующего участка

const frame = (i, side) => ({
  origin: KHAN_SHATYR,
  u,
  v: vNorth,
  along: [320 + i * STEP, 320 + i * STEP + PLOT_LEN],
  across: side === 'north' ? [22, 38] : [-38, -22],
});

const plotsSpec = [
  { id: 'P01', name: 'Нуржол, север, участок 1', contractor: 'C1', care: 'good', batches: ['B1', 'B2'], frame: frame(0, 'north') },
  { id: 'P02', name: 'Нуржол, север, участок 2', contractor: 'C1', care: 'good', batches: ['B2', 'B5'], frame: frame(1, 'north') },
  { id: 'P03', name: 'Нуржол, север, участок 3', contractor: 'C2', care: 'no_watering', batches: ['B1', 'B2'], frame: frame(2, 'north') },
  { id: 'P04', name: 'Нуржол, север, участок 4', contractor: 'C1', care: 'drought', batches: ['B4'], frame: frame(3, 'north') },
  { id: 'P05', name: 'Нуржол, юг, участок 5', contractor: 'C3', care: 'good', batches: ['B3'], frame: frame(0, 'south') },
  { id: 'P06', name: 'Нуржол, юг, участок 6', contractor: 'C3', care: 'good', batches: ['B3', 'B2'], frame: frame(1, 'south') },
  { id: 'P07', name: 'Нуржол, юг, участок 7', contractor: 'C2', care: 'good', batches: ['B1', 'B5'], frame: frame(2, 'south') },
  { id: 'P08', name: 'Нуржол, юг, участок 8', contractor: 'C2', care: 'partial', batches: ['B4', 'B2'], frame: frame(3, 'south') },
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
