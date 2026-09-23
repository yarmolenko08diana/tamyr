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

// plotsSpec: [{ id, name, contractor, care, batches: [..], cause, lat, lon }]
// cause — истинная причина гибели на участке (для оценки), care — как поливали.
export function buildDistrict(r, { start, end, heatwave, plotsSpec, treesPerPlot = 12, badBatches = [] }) {
  const weather = makeWeather(r, start, end, heatwave);
  const plots = [];
  const trees = [];
  const series = { weather, moisture: {}, watering: {}, ndvi: {}, photos: {} };
  const truth = {};

  plotsSpec.forEach((spec, pi) => {
    const h = 0.0006, w = 0.0026;
    const polygon = [
      [r6(spec.lat), r6(spec.lon)],
      [r6(spec.lat), r6(spec.lon + w)],
      [r6(spec.lat - h), r6(spec.lon + w)],
      [r6(spec.lat - h), r6(spec.lon)],
    ];
    plots.push({
      id: spec.id,
      name: spec.name,
      contractor: spec.contractor,
      sensor: `S${String(pi + 1).padStart(2, '0')}`,
      polygon,
      center: [r6(spec.lat - h / 2), r6(spec.lon + w / 2)],
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
        lat: r6(spec.lat - h * (0.3 + 0.4 * row) + r.normal() * 0.00001),
        lon: r6(spec.lon + (w * (col + 0.5)) / (treesPerPlot / 2) + r.normal() * 0.00001),
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
        district: 'Демо-район',
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
