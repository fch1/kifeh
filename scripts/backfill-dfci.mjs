// Enrichit les incendies français EXISTANTS avec leur repère DFCI.
// Idempotent (ne touche que dfci_code IS NULL), par lots transactionnels,
// ne modifie NI coordonnées NI statut. Mode répétition générale : --dry-run.
//
// Usage : DFCI_ENABLED_FR=1 node scripts/backfill-dfci.mjs --country FR --type fire [--dry-run]
import { db } from '../src/db.js';
import { lookupDfci } from '../src/services/dfci.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const dryRun = args.includes('--dry-run');
const country = opt('country', 'FR');
const type = opt('type', 'fire');
const batchSize = Number(opt('batch', '200'));

const rows = db.prepare(
  `SELECT id, lat, lng FROM incidents
   WHERE COALESCE(country_code, 'TN') = ? AND type = ? AND dfci_code IS NULL
     AND status != 'deleted'`
).all(country, type);

let ok = 0, noMatch = 0, errors = 0;
const upd = db.prepare(`UPDATE incidents SET dfci_code = ?, dfci_precision = ?,
  dfci_source_version = ?, dfci_computed_at = ?, dfci_ambiguous = ? WHERE id = ?`);

for (let k = 0; k < rows.length; k += batchSize) {
  const batch = rows.slice(k, k + batchSize);
  db.transaction(() => {
    for (const r of batch) {
      const d = lookupDfci({ lat: r.lat, lng: r.lng, countryCode: country, incidentType: type });
      if (d.available) {
        ok++;
        if (!dryRun) upd.run(d.code, d.precision, d.sourceVersion, d.computedAt, d.ambiguous ? 1 : 0, r.id);
      } else if (d.reason === 'outside_coverage') noMatch++;
      else errors++;
    }
  })();
}

console.log(`Incidents examinés : ${rows.length}`);
console.log(`Repères ${dryRun ? 'calculables (répétition)' : 'ajoutés'} : ${ok}`);
console.log(`Hors couverture : ${noMatch}`);
console.log(`Erreurs : ${errors}`);
process.exit(errors > 0 && ok === 0 ? 1 : 0);
