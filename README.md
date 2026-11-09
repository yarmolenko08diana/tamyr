# Tamyr: Proof That the Tree Survived

**VENTUREHACK 2026 · Track 3 · Open Innovation**
Focus areas: sustainable development, public and urban services.

Tamyr links every sapling planted in the city to a soil moisture sensor, a satellite image, and a photo from a resident. If a sapling dies, the system names the cause (drought, missed watering, or poor planting stock) and the party responsible, and shows the evidence.

**Demo:** https://yarmolenko08diana.github.io/tamyr/

## Problem

- In Kazakhstan's urban environments, **50–70% of saplings die**. The actual survival rate is about 50%, against a standard of 60% (Mazhilis of the Republic of Kazakhstan, 21.05.2026).
- Among the causes, the government cites "lack of monitoring of plantings."
- The model of "paying contractors for surviving trees" was considered and rejected, because **it is impossible to determine why a tree died** (answer from the First Deputy Prime Minister, June 2026).
- As a result, the same areas are replanted with budget money (16.84 billion ₸ for landscaping and greening in Astana).

## Solution

No single source proves the cause, so Tamyr combines three independent ones:

| Source | What it tells us | Blind spot |
|---|---|---|
| Soil moisture sensor | Whether the soil was drying out, and whether moisture jumped after a watering report | Cannot see whether the tree is standing |
| Sentinel-2 satellite (NDVI) | Whether the area is losing greenery | Cannot see an individual sapling |
| Resident photo and site inspection | Whether a specific sapling is alive | A single photo is easy to fake |

The engine examines the **sequence of events** over the 35 days before death and selects the cause:

- **Missed watering:** the contractor reported watering, but the sensor shows no moisture jump and the soil was drying out. Responsible party: the contractor; the replacement cost is withheld under the warranty.
- **Drought:** watering is confirmed by the sensor, but the heat dried the soil faster than the schedule allowed. The contractor is not at fault; watering frequency needs to increase.
- **Poor planting stock:** the soil is moist, yet the sapling died young, and its batch dies more often than average across different sites. Responsible party: the nursery.
- **Insufficient data:** if no hypothesis reaches sufficient confidence, the system says so.

## What Works in the MVP

- **Nurzhol Boulevard map** (demo sites between Khan Shatyr and Baiterek): "Scheme" or "Satellite" base layer, saplings colored by cause of death, sites colored by NDVI, filters by status and contractor, sapling search.
- **Timeline:** playback of the season day by day; the map, summary, and work orders recalculate for the selected date.
- **Site card:** moisture, NDVI, reported and confirmed waterings, all saplings on the site.
- **Sapling passport with QR code:** species, batch, nursery, contractor, warranty, moisture chart with waterings, NDVI, photos, event history. The QR code opens the passport on a phone.
- **Cause engine** with confidence level and a list of facts that support the conclusion, highlighted.
- **Resident photo verification:** GPS from EXIF (no more than 40 m from the sapling), capture date (no older than 7 days), duplicates (SHA-256), pixel-based greenery analysis (ExG index). Photos that fail are saved but do not change the status.
- **Automatic watering work order:** sites where the soil was dry 2 of the last 3 days.
- **Report for the akimat:** filter by contractor, calculation of the amount to withhold, and saving as PDF.
- **Sensor CSV import:** how the ESP32 is connected, from the `firmware/` folder.

## Engine Accuracy

`npm run eval` runs 30 scenarios (10 for each cause) with a known cause in advance and varying weather:
**29 of 30 scenarios correct, 299 of 314 saplings correct.** The full table and error matrix: [docs/engine-accuracy.md](docs/engine-accuracy.md).

This verifies the logic on a model, not on real trees. Real accuracy will be shown by a pilot in which a dendrologist confirms the cause.

## Architecture

```
 ESP32 + sensor ──CSV──┐
 Sentinel-2 (GEE) ─CSV─┤                   ┌──────────── browser ────────────┐
 Open-Meteo ───────────┼─► data/*.json ──► │ engine.js  → cause, confidence   │
 resident photos ──────┘                   │ photo.js   → photo verification  │
                                           │ app.js     → map, passport, QR   │
                                           │ report.js  → report as PDF       │
                                           └──────────────────────────────────┘
```

Everything runs in the browser without a server, so the MVP can be deployed free on GitHub Pages. The engine (`js/engine.js`) does not depend on the browser, and the same code is verified by tests in Node.

### What the team built and what was taken ready-made (section 5.3 of the Regulations)

| Developed by the team | Taken ready-made |
|---|---|
| Data model: sapling passport, sites, batches, event feed | [Leaflet](https://leafletjs.com) — map; OpenStreetMap / CARTO — scheme view |
| Engine for the cause of death: checking waterings against the sensor, hypotheses, confidence, evidence (`js/engine.js`) | Esri World Imagery — satellite base layer |
| Photo verification: distance, date, duplicates, ExG greenery index (`js/photo.js`) | [exifr](https://github.com/MikeKovarik/exifr) — reading EXIF from photos |
| District simulator and 30 test scenarios (`scripts/sim.mjs`, `scripts/eval-engine.mjs`) | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) — QR codes |
| Interface: map, passport, SVG charts, report (`js/app.js`, `js/charts.js`, `js/report.js`) | Sentinel-2 (Copernicus) via Google Earth Engine — satellite imagery |
| ESP32 firmware (`firmware/`) | Open-Meteo — weather archive |
| Planting layout from satellite imagery (`scripts/layout-from-imagery.py`) | numpy, SciPy, Pillow — only in the layout script |

The libraries are stored in `vendor/` with their licenses, so the application works without external CDNs. AI tools were used in development, as permitted by section 5.3.

## Data: Honestly

Right now the application runs on **demo data**, generated by the district simulator (`scripts/generate-demo-data.mjs`, seed 2026): 8 sites on Nurzhol Boulevard east of Khan Shatyr, 336 saplings, a season from April 20 to September 20, 2026, with a heatwave in July. The interface labels this with a "Demo data" banner. The contractors and nurseries are fictional.

Sapling locations were marked from satellite imagery (`scripts/layout-from-imagery.py` → `data/nurzhol-layout.json`): site outlines were drawn by hand along the boulevard's green areas, and points are placed mainly on crowns visible in the image, no closer than about 8 m to each other. Which specific trees are "ours" and their fate are fictional.

Real data is connected as follows:

```bash
node scripts/fetch-weather.mjs              # real Astana weather from Open-Meteo
node scripts/import-ndvi.mjs ndvi.csv       # site NDVI from Google Earth Engine (docs/gee-ndvi.js)
# ESP32 sensor CSV is uploaded with the "Import sensor CSV" button in the interface
```

## Running

Requires Node.js 18+. No dependencies.

```bash
npm start          # http://localhost:8080
npm test           # 13 engine and photo verification tests
npm run eval       # engine accuracy on 30 scenarios → docs/engine-accuracy.md
npm run data       # regenerate demo data
```

You cannot open `index.html` by double-clicking: the browser will not load the JSON. Use `npm start` or any static server.

## Deployment

1. Push the repository to GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`.

## Structure

```
index.html, css/, js/        application
  js/engine.js               engine for the cause of death
  js/photo.js                resident photo verification
data/                        demo data (district.json, series.json)
scripts/                     simulator, accuracy evaluation, real data import, server
test/                        tests (node --test)
firmware/                    ESP32 firmware for the moisture sensor
docs/                        engine accuracy, survey, interviews, demo script
vendor/                      Leaflet, exifr, qrcode-generator
```

## Team

| Member | Role |
|---|---|
| Moldagali Zhasmina Meirmankyzy | Backend and engine |
| Moldagali Zhasmina Meirmankyzy | Data and ML |
| Yarmolenko Diana Dmitrievna | Frontend |
| Yarmolenko Diana Dmitrievna | Pitch and validation |
