// Проверка фото горожанина. Одно фото легко подделать, поэтому оно проходит четыре проверки:
//   1) GPS из EXIF: снято не дальше MAX_DISTANCE метров от саженца;
//   2) время из EXIF: снято недавно, а не взято из старой галереи;
//   3) дубликат: тот же файл уже присылали;
//   4) анализ пикселей: есть ли живая зелень (индекс ExG) или сухие бурые тона.
// Фото, не прошедшее проверки, сохраняется, но не влияет на статус, пока его не подтвердит инспектор.

export const MAX_DISTANCE = 40; // м
export const MAX_AGE_DAYS = 7;

export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Доли «зелёных» и «бурых» пикселей. ExG = 2g − r − b — классический индекс зелени для RGB-фото.
export function vegetationIndex(pixels) {
  let green = 0, brown = 0, n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const sum = r + g + b;
    if (sum < 0.15) continue; // слишком тёмные пиксели не учитываем
    n++;
    const exg = (2 * g - r - b) / sum;
    if (exg > 0.12 && g > r) green++;
    else if (r > g && g > b && r - b > 0.12 && sum < 2.2) brown++;
  }
  const greenShare = n ? green / n : 0;
  const brownShare = n ? brown / n : 0;
  let verdict = 'uncertain';
  if (greenShare >= 0.12) verdict = 'alive';
  else if (brownShare >= 0.25 && greenShare < 0.06) verdict = 'dry';
  return { greenShare, brownShare, verdict };
}

async function readPixels(file) {
  const bmp = await createImageBitmap(file);
  const scale = 160 / Math.max(bmp.width, bmp.height);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// demoAtTree: режим демонстрации, когда фото сделано не у демо-саженца. Координаты подставляются
// из паспорта, и фото помечается как демо.
export async function checkPhoto(file, tree, { knownHashes = new Set(), now = new Date(), demoAtTree = false } = {}) {
  const exifr = window.exifr;
  const checks = [];
  let gps = null, taken = null;
  try {
    gps = await exifr.gps(file);
  } catch { /* нет EXIF */ }
  try {
    const meta = await exifr.parse(file);
    taken = meta?.DateTimeOriginal || meta?.ModifyDate || null;
  } catch { /* нет EXIF */ }

  if (demoAtTree) {
    gps = { latitude: tree.lat, longitude: tree.lon };
    checks.push({ level: 'warn', text: 'Режим демонстрации: координаты взяты из паспорта саженца.' });
  }
  let gpsOk = false;
  if (!gps || gps.latitude == null) {
    checks.push({ level: 'bad', text: 'В фото нет GPS. Включите геолокацию в камере.' });
  } else {
    const d = distanceM(gps.latitude, gps.longitude, tree.lat, tree.lon);
    gpsOk = d <= MAX_DISTANCE;
    checks.push({ level: gpsOk ? 'ok' : 'bad', text: `Снято в ${Math.round(d)} м от саженца (допустимо до ${MAX_DISTANCE} м).` });
  }

  let timeOk = false;
  let date = now.toISOString().slice(0, 10);
  if (!taken) {
    checks.push({ level: demoAtTree ? 'warn' : 'bad', text: 'В фото нет даты съёмки.' });
    timeOk = demoAtTree;
  } else {
    const t = new Date(taken);
    const ageDays = (now - t) / 86400000;
    timeOk = ageDays >= -1 && ageDays <= MAX_AGE_DAYS;
    date = t.toISOString().slice(0, 10);
    checks.push({ level: timeOk ? 'ok' : 'bad', text: `Снято ${t.toLocaleDateString('ru-RU')} (не старше ${MAX_AGE_DAYS} дней).` });
  }

  const hash = await sha256(file);
  const duplicate = knownHashes.has(hash);
  checks.push(duplicate
    ? { level: 'bad', text: 'Это фото уже присылали.' }
    : { level: 'ok', text: 'Фото новое, повторов нет.' });

  const veg = vegetationIndex(await readPixels(file));
  const vText = {
    alive: 'На фото живая зелень',
    dry: 'На фото сухие бурые тона без зелени',
    uncertain: 'По фото не понять состояние',
  }[veg.verdict];
  checks.push({
    level: veg.verdict === 'uncertain' ? 'warn' : 'ok',
    text: `${vText}: зелёных пикселей ${Math.round(veg.greenShare * 100)}%, бурых ${Math.round(veg.brownShare * 100)}%.`,
  });

  const trusted = gpsOk && timeOk && !duplicate && veg.verdict !== 'uncertain';
  return {
    trusted,
    verdict: veg.verdict === 'uncertain' ? 'alive' : veg.verdict,
    date,
    hash,
    lat: gps?.latitude ?? null,
    lon: gps?.longitude ?? null,
    demo: demoAtTree,
    checks,
    veg,
  };
}
