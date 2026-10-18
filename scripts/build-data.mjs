// Zerlegt eine GeoJSON-FeatureCollection der ABS Postal Areas (POA 2021, WGS84)
// in eine Datei pro Postleitzahl plus einen Index.
//
//   node build-data.mjs <poa.geojson> <poa-uebersicht.geojson> <ausgabe-ordner>
//
// Ergebnis:
//   <ausgabe-ordner>/index.json         { "2000": { "s": "NSW", "b": [w, s, e, n] }, ... }
//   <ausgabe-ordner>/poa/2000.json      volle Geometrie der Postleitzahl 2000 (GeoJSON-Feature)
//   <ausgabe-ordner>/overview/2.json    vereinfachte Geometrien aller 2xxx-Postleitzahlen
//                                       { "2000": <GeoJSON-Geometrie>, ... }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stateOf } = require('../states.js');

const [input, overviewInput, outDir] = process.argv.slice(2);
if (!input || !overviewInput || !outDir) {
  console.error('Aufruf: node build-data.mjs <poa.geojson> <poa-uebersicht.geojson> <ausgabe-ordner>');
  process.exit(1);
}

const fc = JSON.parse(fs.readFileSync(input, 'utf8'));
const poaDir = path.join(outDir, 'poa');
const overviewDir = path.join(outDir, 'overview');
fs.mkdirSync(poaDir, { recursive: true });
fs.mkdirSync(overviewDir, { recursive: true });

function codeOf(props) {
  const key = Object.keys(props).find((k) => /^poa_code/i.test(k));
  if (!key) return null;
  const code = String(props[key]).trim();
  return /^\d{3,4}$/.test(code) ? code.padStart(4, '0') : null;
}

function extendBbox(b, coords) {
  if (typeof coords[0] === 'number') {
    if (coords[0] < b[0]) b[0] = coords[0];
    if (coords[1] < b[1]) b[1] = coords[1];
    if (coords[0] > b[2]) b[2] = coords[0];
    if (coords[1] > b[3]) b[3] = coords[1];
    return;
  }
  for (const c of coords) extendBbox(b, c);
}

const round = (n) => Math.round(n * 1e6) / 1e6;
const index = {};
let skipped = 0;

for (const f of fc.features) {
  const code = codeOf(f.properties || {});
  if (!code || !f.geometry) { skipped++; continue; }
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  extendBbox(bbox, f.geometry.coordinates);
  const state = stateOf(code);
  index[code] = { s: state, b: bbox.map(round) };
  const feature = {
    type: 'Feature',
    properties: { code, state },
    geometry: f.geometry,
  };
  fs.writeFileSync(path.join(poaDir, `${code}.json`), JSON.stringify(feature));
}

const overview = {};
for (const f of JSON.parse(fs.readFileSync(overviewInput, 'utf8')).features) {
  const code = codeOf(f.properties || {});
  if (!code || !f.geometry || !index[code]) continue;
  (overview[code[0]] = overview[code[0]] || {})[code] = f.geometry;
}
for (const code of Object.keys(index)) {
  // Fällt ein winziges Gebiet in der Übersicht weg, die volle Geometrie verwenden.
  const chunk = (overview[code[0]] = overview[code[0]] || {});
  if (!chunk[code]) chunk[code] = JSON.parse(fs.readFileSync(path.join(poaDir, `${code}.json`), 'utf8')).geometry;
}
for (const [digit, chunk] of Object.entries(overview)) {
  fs.writeFileSync(path.join(overviewDir, `${digit}.json`), JSON.stringify(chunk));
}

const sorted = Object.fromEntries(Object.keys(index).sort().map((k) => [k, index[k]]));
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(sorted));
console.log(`${Object.keys(index).length} Postleitzahlen geschrieben, ${skipped} ohne Geometrie übersprungen.`);
