// Движок причины гибели саженца.
//
// Идея: ни один источник по отдельности не доказывает причину, поэтому движок смотрит на
// последовательность событий за 35 дней до гибели и сводит вместе:
//   датчик влажности (сохла ли почва и был ли после отчёта о поливе скачок влажности),
//   погоду (жара, осадки), NDVI участка по спутнику, возраст саженца, судьбу его партии.
// Каждая гипотеза получает балл, а каждый балл объясняется фактами (evidence).
// Модуль не зависит от браузера: его же запускают тесты и оценка точности в Node.

import { addDays, daysBetween, fmtDate } from './dates.js';

export const WILT = 12; // % объёмной влажности, ниже которого саженец испытывает стресс
export const WINDOW = 35; // дней до обнаружения гибели, которые анализируем
const HOT = 32; // °C, жаркий день
const RISE = 5; // п.п. влажности, которые должен дать реальный полив
const RAIN_MASK = 4; // мм, при таком дожде скачок влажности нельзя приписать поливу
const MIN_SCORE = 0.5; // слабее этого вывод не делаем
const WET = 27; // %, почва почти насыщена: полив по ней датчик не отличит

export const CAUSES = {
  no_watering: {
    label: 'Невыполненный полив',
    who: 'contractor',
    advice: 'Удержать стоимость восстановления по гарантии подрядчика.',
  },
  drought: {
    label: 'Засуха',
    who: 'weather',
    advice: 'Подрядчик не виноват: график полива не рассчитан на жару. Учащать полив при t ≥ 32°C.',
  },
  bad_material: {
    label: 'Плохой посадочный материал',
    who: 'nursery',
    advice: 'Предъявить претензию питомнику и проверить остальные саженцы партии.',
  },
  unknown: {
    label: 'Недостаточно данных',
    who: null,
    advice: 'Ни одна гипотеза не подтверждается. Возможны механическое повреждение или болезнь: нужен осмотр дендролога.',
  },
};

const clamp = (x) => Math.max(0, Math.min(1, x));
const pct = (x) => `${Math.round(x * 100)}%`;

export function createEngine(district, series) {
  const weatherByDate = new Map(series.weather.map((w) => [w.date, w]));
  const moistByPlot = {};
  for (const [pid, rows] of Object.entries(series.moisture)) {
    moistByPlot[pid] = new Map(rows.map((m) => [m.date, m.v]));
  }
  const trees = new Map(district.trees.map((t) => [t.id, t]));
  const plots = new Map(district.plots.map((p) => [p.id, p]));
  const batches = new Map(district.batches.map((b) => [b.id, b]));
  const contractors = new Map(district.contractors.map((c) => [c.id, c]));

  const photosOf = (id) => (series.photos[id] || []).filter((p) => p.trusted);

  function lifeStatus(tree) {
    const photos = photosOf(tree.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    const firstDry = photos.find((p) => p.verdict === 'dry');
    const last = photos[photos.length - 1];
    if (firstDry) return { dead: true, observed: firstDry.date, lastPhoto: last };
    return { dead: false, observed: null, lastPhoto: last };
  }

  // Смертность по партиям считаем один раз: это контекст для гипотезы «плохой саженец».
  const deadSet = new Set(district.trees.filter((t) => lifeStatus(t).dead).map((t) => t.id));
  const overallDead = deadSet.size / Math.max(1, district.trees.length);
  const batchDead = {};
  for (const b of district.batches) {
    const members = district.trees.filter((t) => t.batch === b.id);
    batchDead[b.id] = {
      total: members.length,
      dead: members.filter((t) => deadSet.has(t.id)).length,
      plots: new Set(members.map((t) => t.plot)).size,
    };
  }

  function wateringChecks(plotId, from, to) {
    const moist = moistByPlot[plotId] || new Map();
    const reported = (series.watering[plotId] || []).filter((d) => d >= from && d <= to);
    return reported.map((d) => {
      const before = moist.get(addDays(d, -1));
      const after = Math.max(moist.get(d) ?? -1, moist.get(addDays(d, 1)) ?? -1);
      const rain = (weatherByDate.get(d)?.precip ?? 0) + (weatherByDate.get(addDays(d, 1))?.precip ?? 0);
      let result;
      if (before == null || after < 0) result = 'nodata';
      else if (rain >= RAIN_MASK) result = 'rain';
      else if (before >= WET) result = 'wet';
      else if (after - before >= RISE) result = 'confirmed';
      else result = 'unconfirmed';
      return { date: d, result, before, after: after < 0 ? null : after };
    });
  }

  function facts(tree, deathDate) {
    // Окно анализа не начинается раньше посадки: до неё за саженец никто не отвечал.
    const windowStart = addDays(deathDate, -(WINDOW - 1));
    const from = windowStart > tree.planted ? windowStart : tree.planted;
    const days = daysBetween(from, deathDate) + 1;
    const moist = moistByPlot[tree.plot] || new Map();
    let valid = 0, stress = 0, heat = 0, rain = 0;
    for (let d = from; d <= deathDate; d = addDays(d, 1)) {
      const v = moist.get(d);
      if (v != null) {
        valid++;
        if (v < WILT) stress++;
      }
      const w = weatherByDate.get(d);
      if (w) {
        if (w.tmax >= HOT) heat++;
        rain += w.precip;
      }
    }
    const checks = wateringChecks(tree.plot, from, deathDate);
    const confirmed = checks.filter((c) => c.result === 'confirmed').length;
    const unconfirmed = checks.filter((c) => c.result === 'unconfirmed').length;
    const checkable = confirmed + unconfirmed;
    const ndvi = (series.ndvi[tree.plot] || []).filter((n) => n.v != null && n.date >= from && n.date <= deathDate);
    const bd = batchDead[tree.batch];
    const batchShare = bd ? bd.dead / Math.max(1, bd.total) : 0;
    return {
      from,
      to: deathDate,
      days,
      coverage: valid / days,
      stressDays: stress,
      okShare: valid ? (valid - stress) / valid : null,
      heatDays: heat,
      rainMm: Math.round(rain),
      checks,
      reported: checks.length,
      confirmed,
      unconfirmed,
      unconfShare: checkable ? unconfirmed / checkable : null,
      ageDays: daysBetween(tree.planted, deathDate),
      batchShare,
      batchRatio: overallDead > 0 ? batchShare / overallDead : 1,
      batchPlots: bd?.plots ?? 1,
      ndviFrom: ndvi[0]?.v ?? null,
      ndviTo: ndvi[ndvi.length - 1]?.v ?? null,
    };
  }

  function score(f) {
    const stress = clamp(f.stressDays / 8);
    const s = {};
    if (f.reported === 0) {
      // Подрядчик вообще не отчитался о поливе, а почва сохла.
      s.no_watering = 0.35 * stress + 0.5 * stress;
    } else if (f.unconfShare == null) {
      s.no_watering = 0.3 * stress;
    } else {
      s.no_watering = 0.35 * stress + 0.65 * clamp((f.unconfShare - 0.2) / 0.5);
    }
    const confirmedCare = f.unconfShare == null ? 0.3 : clamp(1 - f.unconfShare / 0.4);
    s.drought = 0.35 * stress + 0.35 * clamp(f.heatDays / 8) + 0.3 * confirmedCare * (f.reported ? 1 : 0);
    const wet = f.okShare == null ? 0 : clamp((f.okShare - 0.6) / 0.35);
    const young = f.ageDays <= 60 ? 1 : f.ageDays <= 90 ? 0.4 : 0;
    const batch = clamp((f.batchRatio - 1.3) / 1.5);
    s.bad_material = (0.45 * wet + 0.25 * young + 0.3 * batch) * (1 - 0.6 * stress);
    return s;
  }

  function evidence(tree, f, cause) {
    const e = [];
    const plot = plots.get(tree.plot);
    const b = batches.get(tree.batch);
    const add = (text, supports, kind, key = kind) => e.push({ text, supports, kind, key });

    add(
      `Влажность почвы ниже ${WILT}%: ${f.stressDays} из ${f.days} дней перед гибелью (датчик ${plot.sensor}, данные за ${pct(f.coverage)} дней).`,
      f.stressDays >= 4 ? ['no_watering', 'drought'] : ['bad_material'],
      'sensor',
    );
    if (f.reported === 0) {
      add('Подрядчик не отчитался ни об одном поливе за этот период.', ['no_watering'], 'contract');
    } else {
      const rain = f.checks.filter((c) => c.result === 'rain').length;
      const wet = f.checks.filter((c) => c.result === 'wet').length;
      const nod = f.checks.filter((c) => c.result === 'nodata').length;
      let t = `Подрядчик отчитался о ${f.reported} поливах. Датчик подтвердил ${f.confirmed}, не подтвердил ${f.unconfirmed}`;
      const skipped = [rain && `дождь: ${rain}`, wet && `почва и так влажная: ${wet}`, nod && `нет данных: ${nod}`].filter(Boolean);
      if (skipped.length) t += `. Не проверить (${skipped.join(', ')})`;
      add(t + '.', f.unconfShare != null && f.unconfShare > 0.4 ? ['no_watering'] : ['drought', 'bad_material'], 'contract');
      const miss = f.checks.filter((c) => c.result === 'unconfirmed').slice(0, 3);
      if (miss.length) {
        add(
          'Нет скачка влажности после «полива»: ' +
            miss.map((c) => `${fmtDate(c.date)} (${c.before} → ${c.after}%)`).join(', ') + '.',
          ['no_watering'],
          'sensor',
        );
      }
    }
    add(
      `Погода: ${f.heatDays} дней с t ≥ ${HOT}°C, осадки ${f.rainMm} мм за ${f.days} дней.`,
      f.heatDays >= 5 ? ['drought'] : [],
      'weather',
    );
    if (f.ndviFrom != null && f.ndviTo != null) {
      const drop = f.ndviFrom - f.ndviTo;
      add(
        `NDVI участка по Sentinel-2: ${f.ndviFrom.toFixed(2)} → ${f.ndviTo.toFixed(2)}${drop > 0.05 ? ', участок в целом теряет зелень' : ', участок в целом зелёный'}.`,
        drop > 0.05 ? ['no_watering', 'drought'] : ['bad_material'],
        'satellite',
      );
    }
    add(`Возраст саженца на момент гибели: ${f.ageDays} дней.`, f.ageDays <= 60 ? ['bad_material'] : [], 'passport');
    add(
      `Партия ${b.id}, ${b.nursery}: погибло ${pct(f.batchShare)} саженцев против ${pct(overallDead)} в среднем по району, партия высажена на ${f.batchPlots} участках.`,
      f.batchRatio > 1.8 ? ['bad_material'] : [],
      'passport',
      'batch',
    );
    // Главное доказательство для акта: самый специфичный факт в пользу вывода.
    const KEY = { no_watering: 'contract', drought: 'weather', bad_material: 'batch' };
    const keyIndex = e.findIndex((x) => x.key === KEY[cause] && x.supports.includes(cause));
    return e.map((x, i) => ({ ...x, forCause: x.supports.includes(cause), key: i === keyIndex }));
  }

  function responsible(tree, cause) {
    const plot = plots.get(tree.plot);
    const b = batches.get(tree.batch);
    if (cause === 'no_watering') return { type: 'contractor', name: contractors.get(plot.contractor).name };
    if (cause === 'bad_material') return { type: 'nursery', name: b.nursery };
    if (cause === 'drought') return { type: 'weather', name: 'Погодный фактор' };
    return { type: null, name: 'Не установлен' };
  }

  function diagnose(treeId) {
    const tree = trees.get(treeId);
    const life = lifeStatus(tree);
    if (!life.dead) return { tree, dead: false, lastPhoto: life.lastPhoto };
    const f = facts(tree, life.observed);
    const s = score(f);
    const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
    const [best, bestScore] = ranked[0];
    const total = ranked.reduce((a, [, v]) => a + v, 0) || 1;
    let cause = best;
    // Уверенность учитывает и силу лучшей гипотезы, и её отрыв от остальных, и полноту данных.
    let confidence = Math.sqrt(bestScore * (bestScore / total)) * Math.min(1, f.coverage / 0.7);
    if (bestScore < MIN_SCORE || f.coverage < 0.4) {
      cause = 'unknown';
      confidence = 0;
    }
    return {
      tree,
      dead: true,
      observed: life.observed,
      cause,
      label: CAUSES[cause].label,
      advice: CAUSES[cause].advice,
      confidence,
      scores: s,
      facts: f,
      evidence: evidence(tree, f, cause),
      responsible: responsible(tree, cause),
    };
  }

  // Автонаряд на полив: участки, где почва сухая последние дни.
  function plotAlerts(today) {
    const out = [];
    for (const p of district.plots) {
      const moist = moistByPlot[p.id] || new Map();
      let dry = 0;
      let last = null;
      for (let i = 0; i < 3; i++) {
        const v = moist.get(addDays(today, -i));
        if (i === 0) last = v;
        if (v != null && v < WILT) dry++;
      }
      if (dry >= 2) out.push({ plot: p, moisture: last, dryDays: dry });
    }
    return out;
  }

  return {
    diagnose,
    diagnoseAll: () => district.trees.map((t) => diagnose(t.id)),
    plotAlerts,
    wateringChecks,
    lifeStatus,
  };
}
