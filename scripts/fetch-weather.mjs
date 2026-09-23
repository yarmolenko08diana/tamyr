// Подменяет синтетическую погоду реальной из архива Open-Meteo (бесплатно, без ключа).
// Запуск: node scripts/fetch-weather.mjs [широта] [долгота]
// По умолчанию — центр Астаны. После запуска пересчитайте ничего не нужно: движок читает data/series.json.

import { readFileSync, writeFileSync } from 'node:fs';

const lat = process.argv[2] || '51.13';
const lon = process.argv[3] || '71.43';
const district = JSON.parse(readFileSync('data/district.json', 'utf8'));
const series = JSON.parse(readFileSync('data/series.json', 'utf8'));
const start = district.meta.start;
const end = district.meta.today;

const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
  `&start_date=${start}&end_date=${end}&daily=temperature_2m_max,precipitation_sum&timezone=Asia%2FAlmaty`;

const res = await fetch(url);
if (!res.ok) throw new Error(`Open-Meteo ответил ${res.status}`);
const json = await res.json();
const { time, temperature_2m_max: tmax, precipitation_sum: precip } = json.daily;
series.weather = time.map((date, i) => ({ date, tmax: tmax[i] ?? null, precip: precip[i] ?? 0 }));
district.meta.dataSource = 'mixed';
district.meta.weatherSource = 'Open-Meteo archive';

writeFileSync('data/series.json', JSON.stringify(series));
writeFileSync('data/district.json', JSON.stringify(district, null, 1));
console.log(`Погода обновлена: ${series.weather.length} дней, ${start} — ${end}`);
