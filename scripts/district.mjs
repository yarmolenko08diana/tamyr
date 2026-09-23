// Сборка района целиком: участки, саженцы, ряды данных, фото.
// Используется и для демо-данных, и для тестовых сценариев оценки точности.

import { addDays } from '../js/dates.js';
import { makeWeather, simulatePlot, deathDate, makePhotos } from './sim.mjs';

export const SPECIES = {
  B1: 'Берёза повислая',
  B2: 'Вяз приземистый',
  B3: 'Липа мелколистная',
  B4: 'Клён ясенелистный',
  B5: 'Ель сибирская',
};

export const BATCHES = [
  { id: 'B1', species: SPECIES.B1, nursery: 'Питомник №1 (демо)' },
  { id: 'B2', species: SPECIES.B2, nursery: 'Питомник №1 (демо)' },
  { id: 'B3', species: SPECIES.B3, nursery: 'Питомник №2 (демо)' },
  { id: 'B4', species: SPECIES.B4, nursery: 'Питомник №3 (демо)' },
  { id: 'B5', species: SPECIES.B5, nursery: 'Питомник №3 (демо)' },
];

export const CONTRACTORS = [
  { id: 'C1', name: 'Подрядчик «А» (демо)' },
  { id: 'C2', name: 'Подрядчик «Б» (демо)' },
  { id: 'C3', name: 'Подрядчик «В» (демо)' },
];

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const M_LAT = 111320;

// Точка в метрах (s вдоль u, t вдоль v) от origin → [lat, lon].
function toLatLon({ origin, u, v }, s, t) {
  const east = u[0] * s + v[0] * t;
  const north = u[1] * s + v[1] * t;
  const mLon = M_LAT * Math.cos((origin[0] * Math.PI) / 180);
  return [r6(origin[0] + north / M_LAT), r6(origin[1] + east / mLon)];
}

// plotsSpec: [{ id, name, contractor, care, batches: [..], cause, lat, lon }]
// cause — истинная причина гибели на участке (для оценки), care — как поливали.
export function buildDistrict(r, { start, end, heatwave, plotsSpec, treesPerPlot = 12, badBatches = [], districtName = 'Демо-район' }) {
  const weather = makeWeather(r, start, end, heatwave);
  const plots = [];
  const trees = [];
  const series = { weather, moisture: {}, watering: {}, ndvi: {}, photos: {} };
  const truth = {};

  plotsSpec.forEach((spec, pi) => {
    // Участок — прямоугольник в локальной системе (метры вдоль u и поперёк v от точки origin).
    // Без frame участок ставится по сторонам света от (lat, lon), как в тестовых сценариях.
    const frame = spec.frame ?? {
      origin: [spec.lat, spec.lon], u: [1, 0], v: [0, -1], along: [0, 180], across: [0, 67],
    };
    const at = (s, t) => toLatLon(frame, s, t);
    const [s0, s1] = frame.along;
    const [t0, t1] = frame.across;
    const polygon = [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
    plots.push({
      id: spec.id,
      name: spec.name,
      contractor: spec.contractor,
      sensor: `S${String(pi + 1).padStart(2, '0')}`,
      polygon,
      center: at((s0 + s1) / 2, (t0 + t1) / 2),
      // Подпись ставим снаружи участка, с дальней от оси бульвара стороны.
      label: t0 >= 0 ? at((s0 + s1) / 2, t1 + 14) : at((s0 + s1) / 2, t0 - 14),
    });
    const sim = simulatePlot(r, weather, start, end, spec.care);
    series.moisture[spec.id] = sim.moisture;
    series.watering[spec.id] = sim.reported;
    series.ndvi[spec.id] = sim.ndvi;
    const planted = addDays(start, r.int(0, 6));

    for (let i = 0; i < treesPerPlot; i++) {
      const row = i % 2;
      const col = Math.floor(i / 2);
      const batch = spec.batches[i % spec.batches.length];
      const tree = {
        id: `AST-26-${spec.id.slice(1)}${String(i + 1).padStart(2, '0')}`,
        plot: spec.id,
        species: BATCHES.find((b) => b.id === batch).species,
        batch,
        planted,
        warranty: addDays(planted, 730),
        ...(() => {
          const s = s0 + ((s1 - s0) * (col + 0.5)) / (treesPerPlot / 2) + r.normal() * 0.8;
          const t = t0 + (t1 - t0) * (0.3 + 0.4 * row) + r.normal() * 0.8;
          const [lat, lon] = at(s, t);
          return { lat, lon };
        })(),
      };
      let cause = null;
      let died = null;
      if (badBatches.includes(batch) && r() < 0.65) {
        died = deathDate(r, tree, sim.moisture, 'bad_material');
        cause = 'bad_material';
      } else if (spec.care !== 'good' && spec.care !== 'bad_material') {
        died = deathDate(r, tree, sim.moisture, spec.care);
        cause = spec.care === 'partial' ? 'no_watering' : spec.care;
      } else {
        // Даже при хорошем уходе затяжная жара иногда убивает саженец.
        died = deathDate(r, tree, sim.moisture, 'drought');
        cause = 'drought';
      }
      if (died && died > addDays(end, -5)) died = null;
      if (!died) cause = null;
      trees.push(tree);
      series.photos[tree.id] = makePhotos(r, tree, died, start, end);
      truth[tree.id] = { died, cause };
    }
  });

  return {
    district: {
      meta: {
        city: 'Астана',
        district: districtName,
        start,
        today: end,
        dataSource: 'synthetic',
      },
      contractors: CONTRACTORS,
      batches: BATCHES,
      plots,
      trees,
    },
    series,
    truth,
  };
}
