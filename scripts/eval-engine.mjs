// Оценка точности движка причины на 30 сценариях с заранее известной причиной (по 10 на причину).
// Каждый сценарий — отдельный район со своей погодой: целевой участок + 3 соседних с нормальным уходом.
// Запуск: node scripts/eval-engine.mjs  → печатает таблицу и пишет docs/engine-accuracy.md

import { writeFileSync } from 'node:fs';
import { rng } from './sim.mjs';
import { buildDistrict } from './district.mjs';
import { createEngine, CAUSES } from '../js/engine.js';
import { addDays } from '../js/dates.js';

const KINDS = ['no_watering', 'drought', 'bad_material'];
const PER_KIND = 10;

function scenario(kind, seed) {
  const r = rng(seed);
  const start = '2026-04-20';
  const end = '2026-09-20';
  // Для засухи волна жары обязательна, в остальных сценариях — как повезёт.
  const hasHeat = kind === 'drought' || r() < 0.5;
  const hwStart = addDays('2026-06-15', r.int(0, 45));
  const heatwave = hasHeat ? { from: hwStart, to: addDays(hwStart, r.int(12, 24)), plus: r.range(4, 8) } : null;
  const target = {
    id: 'P01', name: 'Целевой участок', contractor: 'C2',
    care: kind === 'bad_material' ? 'good' : kind,
    batches: kind === 'bad_material' ? ['B3'] : [r.pick(['B1', 'B2', 'B4'])],
    lat: 51.126, lon: 71.418,
  };
  const others = [2, 3, 4].map((i) => ({
    id: `P0${i}`, name: `Участок ${i}`, contractor: 'C1', care: 'good',
    batches: kind === 'bad_material' && i === 2 ? ['B3', 'B5'] : [r.pick(['B1', 'B2', 'B5'])],
    lat: 51.126 - 0.002 * i, lon: 71.418,
  }));
  return buildDistrict(r, {
    start, end, heatwave,
    plotsSpec: [target, ...others],
    badBatches: kind === 'bad_material' ? ['B3'] : [],
  });
}

const rows = [];
const confusion = {};
for (const k of KINDS) confusion[k] = Object.fromEntries([...KINDS, 'unknown'].map((c) => [c, 0]));

let seed = 100;
for (const kind of KINDS) {
  let made = 0;
  while (made < PER_KIND) {
    seed++;
    const { district, series, truth } = scenario(kind, seed);
    const engine = createEngine(district, series);
    const dead = district.trees
      .filter((t) => t.plot === 'P01' && truth[t.id].cause === kind)
      .map((t) => engine.diagnose(t.id))
      .filter((d) => d.dead);
    if (!dead.length) continue; // в этом сценарии гибель не успели заметить, берём следующий
    made++;
    const votes = {};
    for (const d of dead) votes[d.cause] = (votes[d.cause] || 0) + 1;
    const verdict = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    const treeHits = votes[kind] || 0;
    confusion[kind][verdict]++;
    const conf = dead.reduce((a, d) => a + d.confidence, 0) / dead.length;
    rows.push({ n: rows.length + 1, seed, kind, verdict, trees: dead.length, treeHits, conf });
  }
}

const ok = rows.filter((r) => r.kind === r.verdict).length;
const treeTotal = rows.reduce((a, r) => a + r.trees, 0);
const treeOk = rows.reduce((a, r) => a + r.treeHits, 0);
const label = (c) => CAUSES[c].label;

let md = `# Точность движка причины гибели\n\n`;
md += `Сгенерировано командой \`node scripts/eval-engine.mjs\`. Данные сценариев синтетические: `;
md += `причина гибели в каждом задана заранее, движок её не знает и восстанавливает по данным.\n\n`;
md += `- **Сценарии:** ${ok} из ${rows.length} верно (${Math.round((100 * ok) / rows.length)}%)\n`;
md += `- **Отдельные саженцы:** ${treeOk} из ${treeTotal} верно (${Math.round((100 * treeOk) / treeTotal)}%)\n\n`;
md += `## Матрица ошибок (строки — истинная причина, столбцы — ответ движка)\n\n`;
md += `| Истинная причина | ${[...KINDS, 'unknown'].map(label).join(' | ')} |\n|---|${'---|'.repeat(KINDS.length + 1)}\n`;
for (const k of KINDS) md += `| ${label(k)} | ${[...KINDS, 'unknown'].map((c) => confusion[k][c]).join(' | ')} |\n`;
md += `\n## Все сценарии\n\n| # | Seed | Истинная причина | Ответ движка | Погибших саженцев | Верно по саженцам | Ср. уверенность |\n|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.n} | ${r.seed} | ${label(r.kind)} | ${label(r.verdict)}${r.kind === r.verdict ? '' : ' ✗'} | ${r.trees} | ${r.treeHits} | ${Math.round(r.conf * 100)}% |\n`;
}
md += `\n## Ограничения\n\nЭто проверка логики на модели, а не на реальных деревьях. Реальную точность покажет пилот, `;
md += `где причину гибели подтверждает дендролог.\n`;

writeFileSync('docs/engine-accuracy.md', md);
console.log(`Сценарии: ${ok}/${rows.length}, саженцы: ${treeOk}/${treeTotal}`);
for (const k of KINDS) console.log(k.padEnd(13), JSON.stringify(confusion[k]));
