import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../js/engine.js';
import { addDays, dateRange } from '../js/dates.js';

// Маленький район вручную: один участок, два саженца, 60 дней данных.
function world({ moisture, watering = [], tmax = 25, photosA, planted = '2026-05-01', batchDeadExtra = 0 }) {
  const days = dateRange('2026-05-01', '2026-06-29');
  const trees = [
    { id: 'A', plot: 'P1', batch: 'B1', species: 'Берёза', planted, lat: 51, lon: 71 },
    { id: 'B', plot: 'P1', batch: 'B2', species: 'Вяз', planted, lat: 51, lon: 71 },
  ];
  for (let i = 0; i < batchDeadExtra; i++) trees.push({ id: `X${i}`, plot: 'P2', batch: 'B1', species: 'Берёза', planted, lat: 51, lon: 71 });
  for (let i = 0; i < 6; i++) trees.push({ id: `Y${i}`, plot: 'P2', batch: 'B2', species: 'Вяз', planted, lat: 51, lon: 71 });
  const photos = { A: photosA, B: [{ date: '2026-06-20', verdict: 'alive', trusted: true }] };
  for (let i = 0; i < batchDeadExtra; i++) photos[`X${i}`] = [{ date: '2026-06-10', verdict: 'dry', trusted: true }];
  return createEngine(
    {
      meta: {},
      contractors: [{ id: 'C1', name: 'Подрядчик' }],
      batches: [{ id: 'B1', nursery: 'Питомник 1' }, { id: 'B2', nursery: 'Питомник 2' }],
      plots: [{ id: 'P1', contractor: 'C1', sensor: 'S1' }, { id: 'P2', contractor: 'C1', sensor: 'S2' }],
      trees,
    },
    {
      weather: days.map((date) => ({ date, tmax: typeof tmax === 'function' ? tmax(date) : tmax, precip: 0 })),
      moisture: { P1: days.map((date, i) => ({ date, v: moisture(date, i) })) },
      watering: { P1: watering },
      ndvi: {},
      photos,
    },
  );
}

const dead = [{ date: '2026-06-25', verdict: 'dry', trusted: true }];

test('живой саженец не получает диагноз', () => {
  const e = world({ moisture: () => 20, photosA: [{ date: '2026-06-25', verdict: 'alive', trusted: true }] });
  assert.equal(e.diagnose('A').dead, false);
});

test('непроверенное фото горожанина не считается гибелью', () => {
  const e = world({ moisture: () => 20, photosA: [{ date: '2026-06-25', verdict: 'dry', trusted: false }] });
  assert.equal(e.diagnose('A').dead, false);
});

test('отчёт о поливе без скачка влажности → невыполненный полив', () => {
  const watering = ['2026-05-25', '2026-05-30', '2026-06-04', '2026-06-09', '2026-06-14', '2026-06-19'];
  const e = world({ moisture: (d, i) => Math.max(6, 25 - i * 0.5), watering, photosA: dead });
  const d = e.diagnose('A');
  assert.equal(d.cause, 'no_watering');
  assert.equal(d.facts.unconfirmed, 6);
  assert.equal(d.responsible.type, 'contractor');
});

test('поливы подтверждены, но жара сушит почву → засуха', () => {
  const watering = ['2026-05-24', '2026-05-31', '2026-06-07', '2026-06-14', '2026-06-21'];
  const set = new Set(watering);
  let v = 20;
  const series = {};
  for (const date of dateRange('2026-05-01', '2026-06-29')) {
    v -= 3.2;
    if (set.has(date)) v += 16;
    v = Math.max(5, Math.min(30, v));
    series[date] = v;
  }
  const e = world({ moisture: (d) => series[d], watering, tmax: 36, photosA: dead });
  const d = e.diagnose('A');
  assert.equal(d.cause, 'drought');
  assert.ok(d.facts.confirmed >= 4);
  assert.equal(d.responsible.type, 'weather');
});

test('почва влажная, саженец молодой, партия гибнет массово → плохой посадочный материал', () => {
  const e = world({
    moisture: (d, i) => 18 + (i % 4) * 2,
    watering: ['2026-05-20', '2026-05-24'],
    photosA: [{ date: '2026-06-05', verdict: 'dry', trusted: true }],
    batchDeadExtra: 5,
  });
  const d = e.diagnose('A');
  assert.equal(d.cause, 'bad_material');
  assert.equal(d.responsible.type, 'nursery');
});

test('датчик молчал почти весь период → недостаточно данных', () => {
  const e = world({ moisture: (d, i) => (i % 5 === 0 ? 8 : null), photosA: dead });
  const d = e.diagnose('A');
  assert.equal(d.cause, 'unknown');
  assert.equal(d.confidence, 0);
});

test('полив без роста влажности не подтверждается', () => {
  const e = world({ moisture: () => 15, watering: ['2026-06-10'], photosA: dead });
  const checks = e.wateringChecks('P1', '2026-06-01', '2026-06-20');
  assert.equal(checks[0].result, 'unconfirmed');
});

test('каждый вывод объяснён фактами', () => {
  const watering = ['2026-05-25', '2026-05-30', '2026-06-04'];
  const e = world({ moisture: (d, i) => Math.max(6, 25 - i * 0.5), watering, photosA: dead });
  const d = e.diagnose('A');
  assert.ok(d.evidence.length >= 4);
  assert.ok(d.evidence.some((x) => x.forCause));
});

test('даты: сложение и разница', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
});
