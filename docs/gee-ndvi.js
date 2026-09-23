// Google Earth Engine (code.earthengine.google.com): NDVI участков Tamyr по Sentinel-2.
// 1. Вставьте в Code Editor. 2. Замените plots на полигоны своих участков (из data/district.json,
//    внимание: там [lat, lon], а здесь [lon, lat]). 3. Run → Tasks → Export → скачайте CSV.
// 4. node scripts/import-ndvi.mjs ndvi.csv

var plots = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Rectangle([71.4185, 51.1256, 71.4211, 51.1262]), { plot_id: 'P01' }),
  ee.Feature(ee.Geometry.Rectangle([71.4221, 51.1256, 71.4247, 51.1262]), { plot_id: 'P02' }),
  // ... остальные участки
]);

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate('2026-04-20', '2026-09-21')
  .filterBounds(plots)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
  .map(function (img) {
    // Маска облаков по слою классификации сцены (SCL): 3 — тень, 8–10 — облака, 11 — снег.
    var scl = img.select('SCL');
    var clear = scl.neq(3).and(scl.lt(8).or(scl.gt(11)));
    return img.normalizedDifference(['B8', 'B4']).rename('ndvi').updateMask(clear)
      .set('date', img.date().format('YYYY-MM-dd'));
  });

var table = s2.map(function (img) {
  return img.reduceRegions({ collection: plots, reducer: ee.Reducer.mean(), scale: 10 })
    .map(function (f) { return f.set('date', img.get('date')); });
}).flatten();

Export.table.toDrive({
  collection: table,
  description: 'tamyr_ndvi',
  fileFormat: 'CSV',
  selectors: ['plot_id', 'date', 'mean'],
});
// В выгруженном CSV переименуйте колонку mean в ndvi.
