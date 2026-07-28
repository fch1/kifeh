// Construit la base de référence DFCI LOCALE (lecture seule à l'exécution) à
// partir de l'artefact prétraité versionné src/data/dfci-2km-wgs84.ndjson.gz.
//
// Chaîne de provenance (documentée dans docs/DFCI.md) :
//   data.gouv.fr « Carroyage DFCI (2 km) » (Licence Ouverte, 2016-06-07,
//   sha1 8fa7aed2a7a0be51c28dc4565ab459c879fd968e, Lambert 93)
//   → reprojeté en WGS84 (pyproj), 339 264 carreaux validés
//     (codes uniques, regex ^[A-Z]{2}[02468]{2}[A-HK-L][0-9]$)
//   → artefact NDJSON gzip (sha1 vérifié ci-dessous)
//   → cette base SQLite + index RTree, reconstruite à l'installation.
//
// Usage : node scripts/build-dfci-reference.mjs [--if-missing] [--force]
// JAMAIS exécuté au démarrage normal du serveur ; jamais de réseau.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, '../src/data/dfci-2km-wgs84.ndjson.gz');
const SOURCE_SHA1 = '2cdad27ea3e70b36eb7ab909395bae22d674478b';
const OUT = process.env.DFCI_REFERENCE_PATH
  || path.join(__dirname, '../data/reference/dfci-france.sqlite');
const VERSION = '2016-06-07';
const CODE_RX = /^[A-Z]{2}[02468]{2}[A-HK-L][0-9]$/;

const args = new Set(process.argv.slice(2));
if (args.has('--if-missing') && fs.existsSync(OUT)) {
  console.log(`[dfci] référence déjà présente (${OUT}) — rien à faire`);
  process.exit(0);
}
if (!fs.existsSync(SOURCE)) {
  console.error('[dfci] artefact source absent :', SOURCE);
  process.exit(args.has('--if-missing') ? 0 : 1); // ne casse jamais npm install
}
const sha1 = crypto.createHash('sha1').update(fs.readFileSync(SOURCE)).digest('hex');
if (sha1 !== SOURCE_SHA1) {
  console.error(`[dfci] empreinte inattendue (${sha1}) — artefact refusé`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(OUT, { force: true });
const db = new Database(OUT);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE dfci_cells (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    min_lng REAL NOT NULL, max_lng REAL NOT NULL,
    geometry_json TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE dfci_cells_rtree USING rtree(id, min_lng, max_lng, min_lat, max_lat);
`);

const insCell = db.prepare(`INSERT INTO dfci_cells
  (id, code, min_lat, max_lat, min_lng, max_lng, geometry_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insTree = db.prepare(`INSERT INTO dfci_cells_rtree VALUES (?, ?, ?, ?, ?)`);

let n = 0, bad = 0;
const rl = readline.createInterface({
  input: fs.createReadStream(SOURCE).pipe(zlib.createGunzip()),
  crlfDelay: Infinity,
});
const tx = db.transaction((rows) => {
  for (const { c, p } of rows) {
    n++;
    const lats = p.map((q) => q[0]), lngs = p.map((q) => q[1]);
    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
    insCell.run(n, c, minLat, maxLat, minLng, maxLng, JSON.stringify(p));
    insTree.run(n, minLng, maxLng, minLat, maxLat);
  }
});
let batch = [];
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (!CODE_RX.test(row.c) || !Array.isArray(row.p) || row.p.length !== 4) { bad++; continue; }
  batch.push(row);
  if (batch.length >= 20_000) { tx(batch); batch = []; }
}
if (batch.length) tx(batch);

const meta = {
  source_name: 'Carroyage DFCI France (2 km)',
  source_dataset: 'https://www.data.gouv.fr/datasets/carroyage-dfci-2-km/',
  source_resource: 'CARRO_DFCI_2x2_L93.7z',
  source_sha1_7z: '8fa7aed2a7a0be51c28dc4565ab459c879fd968e',
  source_updated_at: VERSION,
  generated_at: new Date().toISOString(),
  license: 'Licence Ouverte (fr-lo)',
  checksum: sha1,
  projection_original: 'EPSG:2154 (Lambert 93)',
  projection_runtime: 'EPSG:4326 (WGS84)',
  cell_count: String(n),
};
const insMeta = db.prepare(`INSERT INTO metadata VALUES (?, ?)`);
for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);
db.exec('VACUUM'); // base compacte, lecture seule ensuite
db.close();

const uniq = new Database(OUT, { readonly: true })
  .prepare(`SELECT COUNT(*) n, COUNT(DISTINCT code) u FROM dfci_cells`).get();
console.log(`[dfci] rapport : ${n} cellules (${bad} rejetées), codes uniques : ${uniq.u === uniq.n}, `
  + `taille : ${Math.round(fs.statSync(OUT).size / 1048576)} Mo → ${OUT}`);
if (uniq.u !== uniq.n) process.exit(1);
