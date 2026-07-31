#!/usr/bin/env node
// Génère docs/COUNTRY_CAPABILITY_MATRIX.md À PARTIR du registre des pays —
// la documentation ne peut pas diverger du code (addendum §19) : le test de
// plateforme échoue si le fichier committé diffère de la génération.
//
//   node scripts/generate-capability-matrix.mjs           # écrit le fichier
//   node scripts/generate-capability-matrix.mjs --check   # vérifie sans écrire
//
// La matrice reflète la disponibilité DÉCLARÉE (profils versionnés). Les
// drapeaux à chaud (settings) et l'environnement s'ajoutent à l'exécution via
// /api/public/capabilities — ils ne sont pas documentés ici.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr } from '../src/countries/fr.js';
import { tn } from '../src/countries/tn.js';
import { CAPABILITY_CONCEPTS } from '../src/countries/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'docs', 'COUNTRY_CAPABILITY_MATRIX.md');

const PROFILES = [fr, tn];

const CONCEPT_LABELS = {
  citizenReports: 'Signalements citoyens',
  thermalDetections: 'Détections thermiques satellite',
  burnedAreas: 'Contours de zones brûlées',
  weatherModel: 'Modèle météo configuré',
  airQuality: 'Qualité de l’air',
  officialAlerts: 'Alertes officielles',
  roadEvents: 'Routes barrées / entraves',
  emergencyGrid: 'Carroyage d’urgence',
  aircraft: 'Moyens aériens (ADS-B)',
  smokeSimulation: 'Simulation de fumée',
  replay: 'Replay temporel',
};

const REASON_LABELS = {
  no_verified_source: 'aucune source vérifiée',
  coverage_to_verify: 'couverture à vérifier',
  model_to_integrate: 'à intégrer (candidat identifié)',
  not_applicable: 'sans objet sur ce territoire',
  license_review_pending: 'licence à relire — bloquant',
  charter_decision_pending: 'décision de charte en attente',
  not_yet_enabled: 'pas encore ouvert',
  not_configured: 'clé/configuration absente',
};

function cell(cap) {
  if (!cap) return 'Non déclaré';
  if (cap.enabled) {
    let s = 'Oui';
    if (cap.provider) s += ` (${cap.provider})`;
    if (cap.model) s += ` — modèle \`${cap.model}\``;
    return s;
  }
  let s = `Non — ${REASON_LABELS[cap.reason] || cap.reason}`;
  if (cap.candidateProvider) s += ` (candidat : ${cap.candidateProvider})`;
  return s;
}

export function renderMatrix() {
  const L = [];
  L.push('# Matrice de disponibilité par territoire');
  L.push('');
  L.push('> ⚠️ FICHIER GÉNÉRÉ — ne pas éditer à la main.');
  L.push('> Source de vérité : `src/countries/*.js` (profils versionnés).');
  L.push('> Régénérer : `node scripts/generate-capability-matrix.mjs`');
  L.push('> Le test `tests/platform-check.mjs` échoue si ce fichier diverge du registre.');
  L.push('');
  L.push('Disponibilité DÉCLARÉE par territoire. Les drapeaux administrables et les');
  L.push('clés d’environnement s’appliquent en plus à l’exécution : l’état effectif');
  L.push('est servi par `/api/public/capabilities?country=XX`.');
  L.push('');
  const header = ['Capacité', ...PROFILES.map((p) => p.name.fr)];
  L.push(`| ${header.join(' | ')} |`);
  L.push(`|${header.map(() => '---').join('|')}|`);
  for (const concept of CAPABILITY_CONCEPTS) {
    const row = [CONCEPT_LABELS[concept] || concept,
      ...PROFILES.map((p) => cell(p.capabilities?.[concept]))];
    L.push(`| ${row.join(' | ')} |`);
  }
  L.push('');
  L.push('## Langues, fuseaux et urgences');
  L.push('');
  L.push(`| | ${PROFILES.map((p) => p.name.fr).join(' | ')} |`);
  L.push(`|---|${PROFILES.map(() => '---').join('|')}|`);
  L.push(`| Langues | ${PROFILES.map((p) => p.supportedLanguages.join(', ')).join(' | ')} |`);
  L.push(`| Fuseau | ${PROFILES.map((p) => p.timezone).join(' | ')} |`);
  L.push(`| Pompiers / Protection civile | ${PROFILES.map((p) => p.emergencyNumbers.fire.join(' · ')).join(' | ')} |`);
  L.push(`| Police | ${PROFILES.map((p) => p.emergencyNumbers.police.join(' · ')).join(' | ')} |`);
  L.push(`| Urgences médicales | ${PROFILES.map((p) => p.emergencyNumbers.medical.join(' · ')).join(' | ')} |`);
  L.push('');
  L.push('## Fonds de carte');
  L.push('');
  L.push(`| | ${PROFILES.map((p) => p.name.fr).join(' | ')} |`);
  L.push(`|---|${PROFILES.map(() => '---').join('|')}|`);
  L.push(`| Par défaut | ${PROFILES.map((p) => p.basemaps.default).join(' | ')} |`);
  L.push(`| Repli | ${PROFILES.map((p) => p.basemaps.fallback).join(' | ')} |`);
  L.push(`| Satellite | ${PROFILES.map((p) => p.basemaps.satellite
    || `— (candidat : ${p.basemaps.satelliteCandidate?.provider}, ${REASON_LABELS[p.basemaps.satelliteCandidate?.blocked] || 'bloqué'})`).join(' | ')} |`);
  L.push('');
  L.push('Règle produit : aucune capacité n’est « héritée » d’un autre territoire ;');
  L.push('une page tunisienne ne mentionne jamais EFFIS, DFCI ni AROME. Les couches');
  L.push('absentes s’expliquent (« Cette source n’est pas encore disponible pour');
  L.push('cette zone. ») — jamais une erreur technique, jamais un repli silencieux.');
  L.push('');
  return L.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const content = renderMatrix();
  if (process.argv.includes('--check')) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (existing.trim() !== content.trim()) {
      console.error('✗ docs/COUNTRY_CAPABILITY_MATRIX.md diverge du registre — régénérer.');
      process.exit(1);
    }
    console.log('✓ matrice à jour');
  } else {
    fs.writeFileSync(OUT, content);
    console.log(`✓ écrit : ${OUT}`);
  }
}
