import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vegetationIndex, distanceM } from '../js/photo.js';

const fill = (rgb, n = 400) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4);
  return a;
};

test('зелёная листва → живой', () => {
  assert.equal(vegetationIndex(fill([70, 140, 60])).verdict, 'alive');
});

test('бурая сухая крона → сухой', () => {
  assert.equal(vegetationIndex(fill([150, 110, 60])).verdict, 'dry');
});

test('серый асфальт без дерева → непонятно', () => {
  assert.equal(vegetationIndex(fill([120, 120, 125])).verdict, 'uncertain');
});

test('расстояние между точками', () => {
  const d = distanceM(51.1260, 71.4200, 51.1263, 71.4200);
  assert.ok(d > 30 && d < 37, `получилось ${d}`);
});
