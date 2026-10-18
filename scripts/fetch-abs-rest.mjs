// Ersatzweg, falls der Shapefile-Download der ABS nicht klappt:
// lädt alle Postal Areas (volle Detailstufe) seitenweise über den
// ArcGIS-REST-Dienst der ABS und schreibt eine GeoJSON-FeatureCollection.
//
//   node fetch-abs-rest.mjs <ausgabe.geojson>
import fs from 'node:fs';

const out = process.argv[2];
const BASE = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query';
const PAGE = 25;

async function get(params, attempt = 1) {
  const url = `${BASE}?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json;
  } catch (err) {
    if (attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return get(params, attempt + 1);
  }
}

const ids = await get({ where: '1=1', returnIdsOnly: 'true', f: 'json' });
const objectIds = ids.objectIds.sort((a, b) => a - b);
console.log(`${objectIds.length} Postal Areas gefunden`);

const features = [];
for (let i = 0; i < objectIds.length; i += PAGE) {
  const batch = objectIds.slice(i, i + PAGE);
  const page = await get({
    objectIds: batch.join(','),
    outFields: 'poa_code_2021',
    outSR: '4326',
    geometryPrecision: '7',
    f: 'geojson',
  });
  features.push(...page.features);
  console.log(`${features.length}/${objectIds.length}`);
}

fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
