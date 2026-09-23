// Импорт NDVI участков из CSV (plot_id,date,ndvi), например выгрузки скрипта docs/gee-ndvi.js
// из Google Earth Engine. Запуск: node scripts/import-ndvi.mjs ndvi.csv

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Укажите CSV: node scripts/import-ndvi.mjs ndvi.csv');
  process.exit(1);
}
const district = JSON.parse(readFileSync('data/district.json', 'utf8'));
const series = JSON.parse(readFileSync('data/series.json', 'utf8'));
const plots = new Set(district.plots.map((p) => p.id));
const byPlot = {};
let n = 0;
for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
  const [plot, date, ndvi] = line.split(',').map((s) => s?.trim());
  if (!plots.has(plot) || !/^\d{4}-\d{2}-\d{2}/.test(date || '')) continue;
  const v = ndvi === '' || ndvi == null ? null : Math.round(+ndvi * 100) / 100;
  (byPlot[plot] = byPlot[plot] || []).push({ date: date.slice(0, 10), v: Number.isFinite(v) ? v : null });
  n++;
}
for (const [plot, rows] of Object.entries(byPlot)) series.ndvi[plot] = rows.sort((a, b) => (a.date < b.date ? -1 : 1));
district.meta.dataSource = 'mixed';
district.meta.ndviSource = 'Sentinel-2 L2A';
writeFileSync('data/series.json', JSON.stringify(series));
writeFileSync('data/district.json', JSON.stringify(district, null, 1));
console.log(`NDVI импортирован: ${n} значений по ${Object.keys(byPlot).length} участкам`);
