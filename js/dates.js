// Даты храним строками YYYY-MM-DD: так их удобно сравнивать и хранить в JSON.

const DAY = 86400000;

const toUtc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

export function addDays(date, n) {
  return new Date(toUtc(date) + n * DAY).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function fmtDate(date) {
  return `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]}`;
}

export function fmtDateFull(date) {
  return `${fmtDate(date)} ${date.slice(0, 4)}`;
}
