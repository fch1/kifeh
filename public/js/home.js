// Accueil : carte temps réel, recherche, filtres, liste, détail, confirmation.
'use strict';

// ── Kifeh Léger : mode économe (connexions instables, batterie faible) ───────
// Activé manuellement (filtres) ou automatiquement quand le navigateur signale
// une préférence d'économie de données ou une connexion très lente — jamais
// depuis une estimation de batterie.
function liteEnabled() {
  try {
    const v = localStorage.getItem('kifeh_lite');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  const c = navigator.connection;
  return Boolean(c && (c.saveData || ['slow-2g', '2g'].includes(c.effectiveType)));
}
const LITE = liteEnabled();

// ── Vue mémorisée PAR PAYS : revenir à la Tunisie retrouve la vue tunisienne,
//    passer à la France ouvre la vue française (ou sa vue par défaut). ────────
function readViewports() {
  try { return JSON.parse(localStorage.getItem('kifeh_viewport') || '{}'); } catch { return {}; }
}
function initialView() {
  const saved = readViewports()[currentCountry()];
  if (saved?.center && saved?.zoom) return { center: saved.center, zoom: saved.zoom };
  const p = countryProfile();
  return { center: p.map.defaultCenter, zoom: p.map.defaultZoom };
}

const map = createMap('map', { deferTiles: LITE, ...initialView() });
map.on('moveend', () => {
  try {
    const v = readViewports();
    const c = map.getCenter();
    v[currentCountry()] = { center: [c.lat, c.lng], zoom: map.getZoom() };
    localStorage.setItem('kifeh_viewport', JSON.stringify(v));
  } catch { /* stockage indisponible : sans conséquence */ }
});

let userPos = null;
let verificationRequired = true;
API.get('/api/public/config').then((c) => {
  verificationRequired = c.verificationRequired !== false;
  if (c.sandbox) showSandboxBanner();
  pushKey = c.pushKey || null; // clé publique VAPID (alertes de zone)
  // Fond de carte configuré côté serveur (fournisseur principal + secours).
  setTileProviders(c.tileProviders, c.tileFailThreshold);
  // Pays réellement activés côté serveur : les autres options sont masquées.
  if (Array.isArray(c.countries)) {
    const enabled = new Set(c.countries.map((x) => x.code));
    document.getElementById('countryTN').hidden = !enabled.has('TN');
    document.getElementById('countryFR').hidden = !enabled.has('FR');
  }
}).catch(() => {});

// ── Alertes de zone « M'alerter dans cette zone » (Web Push, gratuit) ────────
// Abonnement au navigateur : quand un incident est publié dans le rayon choisi
// (centre de carte arrondi ~1 km), une notification arrive — même app fermée.
let pushKey = null;
const pushSupported = kifehPushSupported; // helpers partagés (api.js)
function alertsBtnState(on) {
  const btn = document.getElementById('btnAlerts');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? t('alerts_btn_on') : t('alerts_btn');
}
function transientBanner(text) {
  const b = document.createElement('div');
  b.className = 'map-banner'; b.setAttribute('role', 'status');
  b.innerHTML = `<span>${esc(text)}</span>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 5000);
}
const currentPushSubscription = kifehCurrentPushSubscription; // helper partagé (api.js)
async function toggleAlerts() {
  if (!pushSupported()) return transientBanner(t('alerts_unsupported'));
  try {
    const existing = await currentPushSubscription();
    if (existing) {
      // Désactivation : on se désabonne côté navigateur ET côté serveur.
      await API.post('/api/public/push/unsubscribe', { endpoint: existing.endpoint }).catch(() => {});
      await existing.unsubscribe();
      alertsBtnState(false);
      window.track?.('zone_alerts_disabled', {});
      return transientBanner(t('alerts_off_done'));
    }
    // Zone = centre actuel de la carte ; rayon selon le niveau de zoom (5–50 km).
    const c = map.getCenter();
    const radiusKm = Math.max(5, Math.min(50, Math.round(300 / 2 ** (map.getZoom() - 6))));
    await kifehSubscribePush({ lat: c.lat, lng: c.lng, radiusKm, key: pushKey, country: currentCountry() });
    alertsBtnState(true);
    window.track?.('zone_alerts_enabled', { radius_km: radiusKm });
    transientBanner(t('alerts_on_done', { km: radiusKm }));
  } catch (ex) {
    transientBanner(t(ex.message === 'denied' ? 'alerts_denied' : 'search_error'));
  }
}
document.getElementById('btnAlerts').addEventListener('click', (e) => withButton(e.currentTarget, toggleAlerts));
// État initial du bouton (abonnement déjà actif ?) — sans demander de permission.
if (pushSupported()) {
  currentPushSubscription().then((s) => alertsBtnState(Boolean(s))).catch(() => {});
}

// ── Choix du pays : première visite (aucun pays mémorisé) + bouton d'en-tête ──
function renderCountryButton() {
  const btn = document.getElementById('countrySwitch');
  const p = countryProfile();
  btn.textContent = `${p.flag} ${p.name[LANG] || p.name.fr}`;
  // Marque selon le pays consulté : bilingue en Tunisie (« Kifeh كيفاه »),
  // française en France (« Kifeh »). Indépendant de la langue de l'interface.
  const ar = document.getElementById('brandArabic');
  if (ar) ar.hidden = currentCountry() === 'FR';
  // Titre descriptif (référencement) — marque bilingue seulement côté Tunisie.
  document.title = currentCountry() === 'FR'
    ? 'Kifeh — incidents en temps réel : électricité, eau, incendie, internet'
    : 'Kifeh كيفاه — incidents en temps réel : électricité, eau, incendie, internet';
}
renderCountryButton();
document.getElementById('countrySwitch').addEventListener('click', () => openSheet('countrySheet'));
// Choisir le pays déjà actif referme simplement la feuille (sans rechargement).
function pickCountry(code) {
  if (code === currentCountry() && COUNTRY !== null) { closeSheets(); return; }
  setCountry(code);
}
document.getElementById('countryTN').addEventListener('click', () => pickCountry('TN'));
document.getElementById('countryFR').addEventListener('click', () => pickCountry('FR'));
// « Utiliser ma position » : géolocalisation UNIQUEMENT sur ce clic, résolution
// côté serveur (jamais de rattachement au pays « le plus proche »).
document.getElementById('countryGeo').addEventListener('click', (e) => withButton(e.currentTarget, () => new Promise((resolve) => {
  const info = document.getElementById('countryGeoInfo');
  if (!navigator.geolocation) { info.textContent = t('geo_unavailable'); return resolve(); }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const r = await API.get(`/api/public/resolve-country?lat=${pos.coords.latitude.toFixed(3)}&lng=${pos.coords.longitude.toFixed(3)}`);
        if (r.country) setCountry(r.country);
        else info.textContent = t('country_not_covered');
      } catch { info.textContent = t('search_error'); }
      resolve();
    },
    () => { info.textContent = t('geo_not_found'); resolve(); },
    { enableHighAccuracy: false, timeout: 8000 }
  );
})));
// Première visite : proposer le choix (sans bloquer — la Tunisie s'affiche déjà).
if (typeof COUNTRY !== 'undefined' && COUNTRY === null
    && !location.search.includes('incident=') && !location.search.includes('confirm=')) {
  setTimeout(() => openSheet('countrySheet'), 400);
}

// Bandeau discret quand le fond de carte est indisponible : Kifeh reste
// entièrement utilisable (liste, recherche, filtres, déclaration).
document.addEventListener('kifeh:tiles-failed', () => {
  if (document.getElementById('tilesBanner')) return;
  const b = document.createElement('div');
  b.id = 'tilesBanner';
  b.className = 'map-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `<span>${t('tiles_failed')}</span> <button class="btn small-btn" id="tilesSeeList">${t('see_list')}</button>`;
  document.body.appendChild(b);
  document.getElementById('tilesSeeList').addEventListener('click', () => { renderList(); openSheet('listSheet'); });
  window.track?.('tiles_all_failed', {});
});
document.addEventListener('kifeh:tiles-ok', () => document.getElementById('tilesBanner')?.remove());

// Mode léger : bandeau + carte à la demande + liste ouverte en premier.
if (LITE) {
  const b = document.createElement('div');
  b.className = 'map-banner lite';
  b.innerHTML = `<span>${t('lite_banner')}</span> <button class="btn small-btn" id="btnShowMap">${t('lite_show_map')}</button>`;
  document.body.appendChild(b);
  document.getElementById('btnShowMap').addEventListener('click', (e) => {
    map._loadTiles?.();
    e.currentTarget.remove();
  });
  window.track?.('lite_mode_active', {});
}

function showSandboxBanner() {
  const b = document.createElement('div');
  b.className = 'sandbox-banner';
  b.setAttribute('role', 'status');
  b.textContent = t('sandbox_banner');
  document.body.appendChild(b);
}
let incidents = [];
let satEvents = [];
let satLastSync = null;
let fireSit = null; // « Situation incendie » (France) : vent + infos officielles

// Nom cardinal d'une direction (degrés → « nord-est »).
function windDirName(deg) {
  const names = ['dir_n', 'dir_ne', 'dir_e', 'dir_se', 'dir_s', 'dir_sw', 'dir_w', 'dir_nw'];
  return t(names[Math.round(((deg % 360) + 360) % 360 / 45) % 8]);
}
// Libellé public d'un type d'information officielle (jamais l'énumération brute).
function infoTypeLabel(type) { return t(`it_${type}`) === `it_${type}` ? t('it_other') : t(`it_${type}`); }
// Par défaut : incidents en cours + terminés récents (marqués, grisés sur la
// carte) — le compteur principal, lui, ne compte QUE les incidents en cours.
const filters = { types: new Set(), status: '', periodH: '', source: '', satConf: '' };
document.getElementById('fStatus').value = filters.status;
document.getElementById('chipOngoing').setAttribute('aria-pressed', 'false');

const cluster = new GridCluster(map, (it) => it.satellite ? openSatDetail(it.id) : openDetail(it.public_id));

// « Feux satellite » est un TYPE cochable comme les autres (puce rapide et
// feuille de filtres synchronisées). Types cochés sans type citoyen → seuls
// les événements satellite s'affichent, et réciproquement.
function citizenTypes() { return [...filters.types].filter((x) => x !== 'satellite'); }
function citizenVisible() {
  if (filters.source === 'satellite') return false;
  return filters.types.size === 0 || citizenTypes().length > 0;
}
// Fenêtre satellite : 24 h par défaut (nombre « en cours » digne de confiance) ;
// 72 h quand l'utilisateur demande explicitement les feux satellite.
function satWindowH() {
  return (filters.types.has('satellite') || filters.satConf) ? 72 : 24;
}
function visibleSats() {
  if (filters.source === 'citizen' || filters.source === 'corroborated') return [];
  if (filters.types.size && !filters.types.has('satellite') && !filters.types.has('fire')) return [];
  const cutoff = Date.now() - satWindowH() * 3600_000;
  return satEvents.filter((e) => Date.parse(e.last_detected_at) >= cutoff);
}

// Jeu d'éléments affichés (carte + liste + compteurs = MÊME jeu, cohérence garantie).
function visibleItems() {
  const sats = visibleSats().map((e) => ({ ...e, satellite: true }));
  let incs = citizenVisible() ? incidents : [];
  if (filters.source === 'corroborated') incs = incs.filter((i) => i.satellite_last_seen);
  return [...incs, ...sats];
}

// --- Chargement des incidents de la zone -----------------------------------
let loadTimer = null;
async function loadIncidents() {
  const b = map.getBounds();
  const params = new URLSearchParams({
    minLat: b.getSouth().toFixed(4), maxLat: b.getNorth().toFixed(4),
    minLng: b.getWest().toFixed(4), maxLng: b.getEast().toFixed(4),
  });
  const srvTypes = citizenTypes(); // « satellite » n'est pas un type serveur
  if (srvTypes.length) params.set('types', srvTypes.join(','));
  if (filters.status) params.set('status', filters.status);
  // Filtre « période » : basé sur la date de PUBLICATION du signalement.
  if (filters.periodH) params.set('publishedSince', new Date(Date.now() - filters.periodH * 3600_000).toISOString());
  try {
    const data = await API.get(`/api/public/incidents?${params}`);
    incidents = data.incidents;
    // Détections satellitaires (NASA FIRMS) — récupérées depuis l'API Kifeh
    // uniquement (jamais d'appel direct FIRMS depuis le navigateur). Seuls les
    // événements de moins de 72 h (cycle de vie serveur) sont renvoyés.
    try {
      const sat = await API.get(`/api/public/satellite/events${filters.satConf ? `?confidence=${filters.satConf}` : ''}`);
      satEvents = sat.events || [];
      satLastSync = sat.lastSyncAt;
    } catch { /* la carte citoyenne fonctionne même sans données satellite */ }
    // « Situation incendie » (France) : résumé compact de la zone VISIBLE —
    // vent + dernière info officielle. Panne indépendante : jamais bloquant.
    if (currentCountry() === 'FR') {
      try {
        fireSit = await API.get(`/api/fire-situation/summary?${new URLSearchParams({
          minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
          minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
        })}`);
        if (fireSit && !fireSit.enabled) fireSit = null;
      } catch { fireSit = null; }
    } else fireSit = null;
    cluster.setItems(visibleItems());
    renderSummary(false);
    refreshVigilanceMarkers(); // marqueurs ⚠️ vigilance (asynchrone, jamais bloquant)
    // Instantané local : la dernière situation chargée reste consultable
    // hors connexion (avec son horodatage, jamais présentée comme actuelle).
    try {
      localStorage.setItem('kifeh_snapshot', JSON.stringify({
        at: Date.now(), incidents, satEvents, satLastSync,
      }));
    } catch { /* stockage plein ou indisponible : sans conséquence */ }
    updateFilterCount();
    const syncEl = document.getElementById('satSyncInfo');
    if (syncEl) {
      syncEl.hidden = !satLastSync;
      if (satLastSync) syncEl.textContent = t('sat_last_sync', { t: fmtDate(satLastSync) });
    }
  } catch (e) {
    // API indisponible / hors connexion : on présente le dernier instantané
    // local, clairement horodaté — jamais comme information actuelle.
    let restored = false;
    try {
      const snap = JSON.parse(localStorage.getItem('kifeh_snapshot') || 'null');
      if (snap?.incidents) {
        incidents = snap.incidents;
        satEvents = snap.satEvents || [];
        cluster.setItems(visibleItems());
        renderSummary(true, snap.at);
        restored = true;
        window.track?.('offline_snapshot_used', {});
      }
    } catch {}
    if (!restored) document.getElementById('counter').textContent = e.message;
  }
}

// ── Résumé d'information (zone visible) ──────────────────────────────────────
// « Autour de X — N incidents en cours » + répartition par type, incluant les
// détections satellite actives (moins de 72 h). Généré à partir des MÊMES
// données filtrées que la carte ; reste visible même sans fond de carte.
function renderSummary(degraded, snapshotAt) {
  const counter = document.getElementById('counter');
  const shown = visibleItems();
  const active = citizenVisible() ? incidents.filter((i) => i.status === 'active') : [];
  const satsShown = visibleSats();
  if (shown.length === 0 && activeFilterCount() > 0 && !degraded) {
    counter.textContent = t('filter_results_none');
    return;
  }
  const q = document.getElementById('search').value.trim();
  const where = q ? t('summary_around', { q: q.split(',')[0] }) : t('summary_here');

  // Lignes distinctes : les signalements citoyens et les détections satellite
  // ne sont jamais additionnés dans un même chiffre ambigu.
  const byType = {};
  for (const i of active) byType[i.type] = (byType[i.type] || 0) + 1;
  const typeParts = Object.entries(byType).map(([ty, n]) => `${TYPE_ICONS[ty]} ${n}`);
  // Incidents terminés récents affichés (grisés) : comptés à part, jamais
  // mélangés au chiffre principal « en cours ».
  const ended = citizenVisible() ? incidents.filter((i) => i.status !== 'active').length : 0;
  let mainLine;
  if (active.length === 0 && satsShown.length === 0) mainLine = t('counter_none');
  else if (active.length > 0) mainLine = active.length === 1 ? t('counter_one') : t('counter_n', { n: active.length });
  else mainLine = `🛰️ ${t('summary_sat_n', { n: satsShown.length })}`;

  counter.innerHTML = `
    <span class="summary-where">${esc(where)}</span>
    <strong>${mainLine}</strong>
    ${active.length > 0 && typeParts.length ? `<span class="summary-types">${typeParts.join(' · ')}</span>` : ''}
    ${ended > 0 ? `<span class="summary-types">✓ ${ended === 1 ? t('summary_ended_one') : t('summary_ended_n', { n: ended })}</span>` : ''}
    ${active.length > 0 && satsShown.length ? `<span class="summary-sat">🛰️ ${t('summary_sat_n', { n: satsShown.length })} · ${satWindowH()} h</span>` : ''}
    ${fireSit?.wind && !fireSit.wind.stale ? `<span class="summary-types">💨 ${esc(t('fs_wind_line', { v: fireSit.wind.speedKmh, dir: windDirName(fireSit.wind.directionToDeg) }))}${fireSit.wind.gustsKmh ? ` · ${esc(t('fs_wind_gusts', { g: fireSit.wind.gustsKmh }))}` : ''}</span>` : ''}
    ${fireSit?.latestOfficialAt ? `<span class="summary-types${fireSit.safetyActive ? ' summary-official-active' : ''}">🏛️ ${esc(t('fs_latest_official', { t: timeAgo(fireSit.latestOfficialAt) }))}</span>` : ''}
    ${fireSit?.vigilance ? `<span id="vigStatusLine" class="summary-types vig-line${fireSit.vigilance.activeDepartments > 0 ? ' summary-official-active vig-active' : ''}" role="button" tabindex="0" aria-haspopup="dialog">${fireSit.vigilance.activeDepartments > 0 ? `🟠 ${esc(t('fs_vigilance_active', { n: fireSit.vigilance.activeDepartments }))}` : `🟢 ${esc(t('fs_vigilance_none'))}`} ›</span>` : ''}
    ${degraded ? `<span class="summary-degraded">${t('api_degraded')}<br>${t('offline_snapshot', { t: timeAgo(new Date(snapshotAt).toISOString()) })}</span>` : ''}`;
}
// Le résumé ouvre la liste correspondante (même jeu de données) ; la ligne
// d'état Vigilance ouvre sa fiche dédiée (clavier : Entrée ou Espace).
document.getElementById('counter').addEventListener('click', (e) => {
  if (e.target.closest('#vigStatusLine')) { openVigilanceSheet(); return; }
  renderList(); openSheet('listSheet');
});
document.getElementById('counter').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('#vigStatusLine')) {
    e.preventDefault(); openVigilanceSheet();
  }
});

// ── Vigilance Météo-France : fiche dédiée + marqueurs départementaux ─────────
// Flow : ligne d'état (toujours visible côté France) → 1 tap → fiche complète.
// Période calme : explication de la veille + horodatage du dernier contrôle.
// Alerte : carte par département (couleur, phénomène, validité, bulletin
// officiel) + marqueurs ⚠️ sur la carte. CTA : activer les alertes de sa zone.
const vigLayer = L.layerGroup().addTo(map);

async function openVigilanceSheet() {
  const el = document.getElementById('vigContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('vigSheet');
  let v;
  try { v = await API.get('/api/fire-situation/vigilance'); } catch { v = null; }
  if (!v?.enabled || !v.monitored) {
    el.innerHTML = `<h2>${esc(t('vig_title'))}</h2><p class="muted small">${esc(t('vig_unavailable'))}</p>`;
    return;
  }
  window.track?.('vigilance_sheet_opened', { alerts: v.alerts.length });
  const head = v.alerts.length
    ? `<h2>🟠 ${esc(t('vig_title'))}</h2>
       <p><strong>${esc(t('fs_vigilance_active', { n: v.alerts.length }))}</strong></p>`
    : `<h2>🟢 ${esc(t('vig_title'))}</h2>
       <p><strong>${esc(t('fs_vigilance_none'))}</strong></p>
       <p class="muted">${esc(t('vig_explainer'))}</p>`;
  const cards = v.alerts.map((a) => {
    const summary = LANG === 'ar' && a.summaryAr
      ? `${esc(a.summaryAr)}<br><span class="muted small">${esc(t('fs_ar_summary_note'))}</span>`
      : esc(a.summaryFr);
    return `
      <div class="notice ${a.color === 'rouge' ? 'danger' : 'warn'}">
        <strong>${a.color === 'rouge' ? '🔴' : '🟠'} ${esc(a.title)}</strong>
        <p>${summary}</p>
        ${a.validUntil ? `<span class="small">${esc(t('vig_valid_until', { t: fmtDate(a.validUntil) }))}</span><br>` : ''}
        <a href="${esc(a.sourceUrl || 'https://vigilance.meteofrance.fr')}" target="_blank" rel="noopener">${esc(t('fs_official_read'))}</a>
      </div>`;
  }).join('');
  el.innerHTML = `${head}${cards}
    ${v.alerts.length ? `<p class="muted small">${esc(t('fs_fr_alert_note'))}</p>` : ''}
    <p><a href="https://vigilance.meteofrance.fr" target="_blank" rel="noopener">${esc(t('vig_official_map'))} ↗</a></p>
    ${v.checkedAt ? `<p class="muted small">${esc(t('vig_checked_at', { t: fmtDate(v.checkedAt) }))}</p>` : ''}
    ${pushSupported() ? `<button class="btn secondary" id="vigAlertsBtn" type="button">🔔 ${esc(t('vig_enable_alerts'))}</button>` : ''}`;
  document.getElementById('vigAlertsBtn')?.addEventListener('click', (e) => {
    closeSheets();
    withButton(document.getElementById('btnAlerts'), toggleAlerts);
  });
}

// Marqueurs ⚠️ des départements en alerte — un point honnête au centre du
// département, jamais un faux périmètre. Rafraîchis à chaque chargement.
async function refreshVigilanceMarkers() {
  try {
    vigLayer.clearLayers();
    if (!fireSit?.vigilance || fireSit.vigilance.activeDepartments === 0) return;
    const v = await API.get('/api/fire-situation/vigilance');
    for (const a of v.alerts || []) {
      if (a.lat == null || a.lng == null) continue;
      L.marker([a.lat, a.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="vig-marker ${a.color === 'rouge' ? 'vig-rouge' : 'vig-orange'}" title="${esc(a.title)}">⚠️</div>`,
          iconSize: [34, 34], iconAnchor: [17, 17],
        }),
      }).on('click', openVigilanceSheet).addTo(vigLayer);
    }
  } catch { /* jamais bloquant pour la carte */ }
}

// Nombre de filtres actifs (badge du bouton « Plus de filtres »).
function activeFilterCount() {
  // Un filtre est « actif » quand il diffère de son défaut (défaut : tous les
  // statuts — en cours + terminés récents).
  return filters.types.size + (filters.status ? 1 : 0) + (filters.periodH ? 1 : 0)
    + (filters.source ? 1 : 0) + (filters.satConf ? 1 : 0);
}
function updateFilterBadge() {
  const n = activeFilterCount();
  const badge = document.getElementById('filterBadge');
  badge.hidden = n === 0;
  badge.textContent = n;
}
function updateFilterCount() {
  const el = document.getElementById('filterCount');
  if (!el) return;
  const n = visibleItems().length;
  el.textContent = n === 0 ? t('filter_results_none')
    : n === 1 ? t('filter_results_one') : t('filter_results_n', { n });
}
// Anti-rebond des déplacements de carte : requêtes annulées tant que la carte
// bouge ; fenêtre plus longue en mode léger.
map.on('moveend', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadIncidents, LITE ? 800 : 400); });
loadIncidents().then(() => {
  // Mode léger : l'information d'abord — la liste s'ouvre avant la carte.
  if (LITE && !location.search.includes('incident=') && !location.search.includes('confirm=')) {
    renderList();
    openSheet('listSheet');
  }
});

// --- Temps réel (SSE) -------------------------------------------------------
// Économie de batterie : AUCUN rafraîchissement tant que l'onglet est caché —
// une seule mise à jour au retour au premier plan.
let refreshWhenVisible = false;
function scheduleRefresh(delay = 500) {
  if (document.visibilityState === 'hidden') { refreshWhenVisible = true; return; }
  clearTimeout(loadTimer);
  loadTimer = setTimeout(loadIncidents, delay);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && refreshWhenVisible) {
    refreshWhenVisible = false;
    scheduleRefresh(200);
  }
});
try {
  const es = new EventSource(`${API_BASE}/api/events`);
  es.addEventListener('incident', () => scheduleRefresh(500));
} catch { /* repli : rechargement au déplacement de carte */ }

// --- Géolocalisation (consentement explicite : uniquement sur action) -------
document.getElementById('btnLocate').addEventListener('click', () => {
  if (!navigator.geolocation) return alert(t('geo_unavailable'));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userPos.lat, userPos.lng], 14);
      L.circleMarker([userPos.lat, userPos.lng], { radius: 8, color: '#17557E', fillOpacity: .9 })
        .addTo(map).bindPopup(esc(t('you_are_here')));
    },
    () => alert(t('geo_not_found')),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// --- Recherche d'adresse ----------------------------------------------------
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('searchResults');
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const { results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`);
      searchResults.innerHTML = '';
      if (!results.length) {
        const b = document.createElement('button');
        b.disabled = true; b.textContent = t('addr_not_found');
        searchResults.appendChild(b);
      }
      for (const r of results) {
        const b = document.createElement('button');
        b.setAttribute('role', 'option');
        b.textContent = r.label;
        b.addEventListener('click', () => {
          searchResults.hidden = true;
          searchInput.value = r.label.split(',').slice(0, 2).join(',');
          searchInput.blur(); // referme le clavier mobile pour voir la carte
          map.setView([r.lat, r.lng], 15);
          if (window._searchMarker) map.removeLayer(window._searchMarker);
          window._searchMarker = L.circleMarker([r.lat, r.lng], { radius: 9, color: '#C4622D', fillOpacity: .7 })
            .addTo(map).bindPopup(esc(r.label.split(',').slice(0, 2).join(',')));
        });
        searchResults.appendChild(b);
      }
      searchResults.hidden = false;
    } catch {
      searchResults.innerHTML = '';
      const b = document.createElement('button');
      b.disabled = true; b.textContent = t('search_error');
      searchResults.appendChild(b);
      searchResults.hidden = false;
    }
  }, 350);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.searchbox')) searchResults.hidden = true;
});

// --- Filtres ----------------------------------------------------------------
// Les puces rapides (types) et la feuille « Plus de filtres » (types, statut,
// période) agissent sur le MÊME jeu de filtres : carte, liste et compteur
// restent toujours cohérents.
function syncTypeControls() {
  document.querySelectorAll('.chip[data-type]').forEach((c) =>
    c.setAttribute('aria-pressed', filters.types.has(c.dataset.type)));
  document.querySelectorAll('.fType').forEach((c) => { c.checked = filters.types.has(c.value); });
  document.getElementById('chipSat').setAttribute('aria-pressed', filters.types.has('satellite'));
  document.getElementById('fSource').value = filters.source;
  updateFilterBadge();
}
// Filtre rapide : les feux détectés par satellite, comme un type d'incident.
document.getElementById('chipSat').addEventListener('click', () => {
  if (filters.types.has('satellite')) filters.types.delete('satellite');
  else filters.types.add('satellite');
  syncTypeControls();
  loadIncidents();
});
for (const chip of document.querySelectorAll('.chip[data-type]')) {
  chip.addEventListener('click', () => {
    const ty = chip.dataset.type;
    if (filters.types.has(ty)) filters.types.delete(ty); else filters.types.add(ty);
    syncTypeControls();
    loadIncidents();
  });
}
for (const box of document.querySelectorAll('.fType')) {
  box.addEventListener('change', () => {
    if (box.checked) filters.types.add(box.value); else filters.types.delete(box.value);
    syncTypeControls();
  });
}
document.getElementById('chipOngoing').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on);
  filters.status = on ? 'active' : '';
  document.getElementById('fStatus').value = filters.status;
  updateFilterBadge();
  loadIncidents();
});
document.getElementById('chipFilters').addEventListener('click', () => openSheet('filterSheet'));
// Bascule manuelle du mode léger (mémorisée ; rechargement pour appliquer).
const liteToggle = document.getElementById('liteToggle');
liteToggle.checked = LITE;
liteToggle.addEventListener('change', () => {
  try { localStorage.setItem('kifeh_lite', liteToggle.checked ? '1' : '0'); } catch {}
  location.reload();
});
document.getElementById('filterApply').addEventListener('click', async () => {
  filters.status = document.getElementById('fStatus').value;
  filters.periodH = document.getElementById('fPeriod').value;
  filters.source = document.getElementById('fSource').value;
  filters.satConf = document.getElementById('fSatConf').value;
  document.getElementById('chipOngoing').setAttribute('aria-pressed', filters.status === 'active');
  window.track?.('filters_applied', { types: [...filters.types].join(',') || 'all', period_h: filters.periodH || 'all', source: filters.source || 'all' });
  await loadIncidents();
  updateFilterBadge();
  closeSheets();
});
document.getElementById('filterReset').addEventListener('click', () => {
  filters.types.clear(); filters.status = ''; filters.periodH = '';
  filters.source = ''; filters.satConf = '';
  document.getElementById('fStatus').value = '';
  document.getElementById('fPeriod').value = '';
  document.getElementById('fSource').value = '';
  document.getElementById('fSatConf').value = '';
  document.getElementById('chipOngoing').setAttribute('aria-pressed', 'false');
  syncTypeControls();
  closeSheets(); loadIncidents();
});

// --- Feuilles (bottom sheets) ----------------------------------------------
function openSheet(id) { closeSheets(); document.getElementById(id).classList.add('open'); }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open')); }
document.querySelectorAll('.sheet .handle').forEach((h) =>
  h.parentElement.addEventListener('click', (e) => { if (e.target === h) closeSheets(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
map.on('click', closeSheets);

// --- Liste ------------------------------------------------------------------
document.getElementById('btnList').addEventListener('click', () => { renderList(); openSheet('listSheet'); });
document.getElementById('sortSelect').addEventListener('change', renderList);

function renderList() {
  const sort = document.getElementById('sortSelect').value;
  const sevRank = { immediate_danger: 0, high: 1, moderate: 2, low: 3 };
  // Même jeu filtré que la carte et le résumé (cohérence garantie).
  let rows = citizenVisible() ? [...incidents] : [];
  if (filters.source === 'corroborated') rows = rows.filter((i) => i.satellite_last_seen);
  if (sort === 'time') rows.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  if (sort === 'severity') rows.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  if (sort === 'near' && userPos) {
    const d = (i) => (i.lat - userPos.lat) ** 2 + (i.lng - userPos.lng) ** 2;
    rows.sort((a, b) => d(a) - d(b));
  }
  const el = document.getElementById('listContainer');
  const showSat = filters.source !== 'citizen' && filters.source !== 'corroborated';
  el.innerHTML = (rows.length || (showSat && visibleSats().length)) ? '' : `<p class="muted">${t('list_empty')}</p>`;
  for (const i of rows) {
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.innerHTML = `
      <div class="type-dot ${esc(i.type)}">${TYPE_ICONS[i.type] || '•'}</div>
      <div style="flex:1">
        <strong>${esc(TYPE_LABELS[i.type])}</strong>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span>
        ${i.satellite_last_seen ? '<span class="badge sat">🛰️</span>' : ''}<br>
        <span class="muted">${esc(i.area || t('area_approx'))} · ${t('started_ago')} ${esc(fmtDate(i.started_at))}
        · ${t('severity_short')} ${esc(SEVERITY_LABELS[i.severity])}</span>
      </div>`;
    btn.addEventListener('click', () => openDetail(i.public_id));
    el.appendChild(btn);
  }
  // Détections satellite : accessibles aussi depuis la liste (sans carte).
  if (showSat) {
    for (const ev of visibleSats()) {
      const btn = document.createElement('button');
      btn.className = 'list-item';
      btn.innerHTML = `
        <div class="type-dot fire">🛰️</div>
        <div style="flex:1">
          <strong>${t('sat_detection')}</strong> <span class="badge sat">NASA FIRMS</span><br>
          <span class="muted">${t('sat_potential_fire')} · ${t('sat_last_seen')} ${esc(fmtDate(ev.last_detected_at))}</span>
        </div>`;
      btn.addEventListener('click', () => openSatDetail(ev.id));
      el.appendChild(btn);
    }
  }
}

// --- Détail + confirmation + fin d'incident + corrections --------------------
// Toutes les actions s'appliquent à l'incident EXISTANT : aucune ne crée de
// doublon d'incident ni de nouveau marqueur.

// Statut communautaire d'un incendie (jamais présenté comme officiel).
function fireStatusHtml(i) {
  if (i.type !== 'fire' || i.status !== 'active') return '';
  const total = i.fireThreshold || 3;
  const n = i.confirmations_count;
  const confirmed = n >= total;
  return `
    <div class="notice ${confirmed ? 'ok' : 'warn'}" id="fireStatus">
      <strong>${confirmed ? t('fire_confirmed_comm') : t('fire_to_confirm')}</strong><br>
      <span>${confirmed ? t('fire_progress_done', { total }) : t('fire_progress', { n, total })}</span><br>
      <span class="small muted">${t('fire_not_official')}</span>
    </div>`;
}

// Capsule de confiance : au plus 3 signaux essentiels en langage simple,
// le détail des sources derrière « Pourquoi cette information ? ».
// Jamais de score chiffré inexpliqué, jamais de « confirmation officielle ».
function trustCapsuleHtml(i) {
  const signals = [];
  signals.push(t('trust_reported_ago', { t: timeAgo(i.published_at || i.created_at) }));
  if (i.still_active_at && Date.now() - Date.parse(i.still_active_at) < 6 * 3600_000) {
    signals.push(t('trust_still', { t: timeAgo(i.still_active_at) }));
  }
  if (i.confirmations_count > 0) {
    signals.push(i.confirmations_count > 1 ? t('trust_confirmed_n', { n: i.confirmations_count }) : t('trust_confirmed_one'));
  }
  if (i.satellite_last_seen) signals.push(t('trust_sat'));
  signals.push(t('trust_approx'));
  return `
    <div class="trust-capsule">
      ${signals.slice(0, 3).map((s) => `<span class="trust-chip">${s}</span>`).join('')}
      <details><summary>${t('trust_why')}</summary><p class="small muted">${t('trust_explain')}</p></details>
    </div>`;
}

async function openDetail(publicId) {
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('detailSheet');
  let i;
  try { i = await API.get(`/api/public/incidents/${encodeURIComponent(publicId)}`); }
  catch (e) { el.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }

  const confirmed = isDone('confirmed', i.public_id);
  const endedReported = isDone('ended', i.public_id);
  const isFire = i.type === 'fire';
  const confirmLabel = isFire ? t('confirm_fire_btn') : t('im_affected');

  el.innerHTML = `
    <h2><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
    <p class="muted">${esc(i.area || t('area_approx'))} · ${t('ref')} ${esc(i.public_id)}</p>
    ${trustCapsuleHtml(i)}
    ${i.satellite_last_seen ? `<p class="notice sat">🛰️ <strong>${t('sat_corroborated')} — NASA FIRMS</strong><br>
      <span class="small">${t('sat_last_seen')} ${esc(fmtDate(i.satellite_last_seen))} · ${t('sat_source')}</span></p>` : ''}
    ${fireStatusHtml(i)}
    <p><strong>${t('started')}</strong> ${esc(fmtDate(i.started_at))}${i.time_approximate ? ` ${t('approx_suffix')}` : ''}<br>
    ${i.ended_at ? `<strong>${t('ended')}</strong> ${esc(fmtDate(i.ended_at))}<br>
    <strong>${t('duration_label')}</strong> ${esc(fmtDuration(i.started_at, i.ended_at))}<br>` : ''}
    <strong>${t('severity_label')}</strong> ${esc(SEVERITY_LABELS[i.severity])}<br>
    <strong>${t('last_update')}</strong> ${esc(timeAgo(i.updated_at))}</p>
    ${i.description ? `<p>${esc(i.description)}</p>` : ''}
    ${i.confirmations_count > 0 ? `<p class="notice ok" id="affectedCount">${i.confirmations_count > 1 ? t('affected_n', { n: i.confirmations_count }) : t('affected_one')}</p>` : '<p hidden id="affectedCount"></p>'}
    ${i.resolutionReports > 0 && i.status === 'active' ? `<p class="notice warn" id="endedCount"><strong>${t('ended_pending')}</strong><br>${i.resolutionReports > 1 ? t('ended_reports_n', { n: i.resolutionReports }) : t('ended_reports_one')}</p>` : ''}
    <div id="confirmZone">
      ${i.status === 'active' ? (confirmed
        ? `<p class="notice ok">${t('you_confirmed')}</p>`
        : `<button class="btn" id="btnConfirm">${confirmLabel}</button>`) : ''}
    </div>
    ${i.status === 'active' && !isDone('still', i.public_id) ? `<button class="btn secondary" id="btnStill" style="margin-top:.5rem">${t('still_active_btn')}</button>` : ''}
    <div id="stillZone"></div>
    ${i.status === 'active' && !endedReported ? `<button class="btn secondary" id="btnEnded" style="margin-top:.5rem">${t('ended_report_btn')}</button>` : ''}
    <div id="endedZone"></div>
    ${i.status === 'resolved' && (!i.resolved_at || Date.now() - Date.parse(i.resolved_at) < 24 * 3600_000)
    ? `<button class="btn secondary" id="btnReopen" style="margin-top:.5rem">${t('reopen_btn')}</button>
    <div id="reopenZone"></div>` : ''}
    <button class="btn ghost small-btn" id="btnShare" style="margin-top:.5rem">${t('share_btn')}</button>
    <button class="btn ghost small-btn" id="btnLocCorrect" style="margin-top:.5rem">${t('loc_correct_title')}</button>
    <div id="locCorrectZone"></div>
    <button class="btn ghost small-btn" id="btnReport" style="margin-top:.5rem">${t('report_content')}</button>
    <div id="reportZone"></div>`;

  // « Situation incendie » (France) : vent + consignes officielles sur les feux.
  if (i.type === 'fire') renderFireSituationSections(el, i.lat, i.lng);

  document.getElementById('btnConfirm')?.addEventListener('click', (e) => {
    if (!verificationRequired) return withButton(e.currentTarget, () => directConfirm(i));
    renderConfirmForm(i);
  });
  document.getElementById('btnEnded')?.addEventListener('click', () => renderEndedForm(i));
  // Partage : lien direct vers la fiche (Web Share natif, repli copie).
  document.getElementById('btnShare').addEventListener('click', async (e) => {
    const url = `${location.origin}${API_BASE}/?incident=${encodeURIComponent(i.public_id)}`;
    const text = `${TYPE_ICONS[i.type]} ${TYPE_LABELS[i.type]} — ${i.area || t('area_approx')}`;
    window.track?.('incident_shared', { incident_type: i.type });
    try {
      if (navigator.share) await navigator.share({ title: 'Kifeh', text, url });
      else { await navigator.clipboard.writeText(url); e.target.textContent = t('link_copied'); }
    } catch { /* partage annulé par l'utilisateur : sans conséquence */ }
  });
  document.getElementById('btnLocCorrect').addEventListener('click', () => renderCorrectionForm(i));
  document.getElementById('btnReport').addEventListener('click', () => renderReportForm(i));

  // « C'est toujours en cours » : actualise la fraîcheur, sans doublon ni compteur.
  document.getElementById('btnStill')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/still-active`, { deviceId: getDeviceId() });
      window.track?.('incident_still_active', { incident_type: i.type });
      markDone('still', i.public_id);
      document.getElementById('btnStill')?.remove();
      document.getElementById('stillZone').innerHTML = `<p class="notice ok">${t('still_thanks')}</p>`;
      loadIncidents();
    } catch (ex) {
      if (ex.data?.alreadyReported) {
        markDone('still', i.public_id);
        document.getElementById('btnStill')?.remove();
        document.getElementById('stillZone').innerHTML = `<p class="notice ok">${t('still_thanks')}</p>`;
      } else document.getElementById('stillZone').innerHTML = `<p class="field-error">${esc(ex.message)}</p>`;
    }
  }));

  // Réouverture communautaire (clôture erronée, dans les 24 h).
  document.getElementById('btnReopen')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const r = await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/reopen`, { deviceId: getDeviceId() });
      window.track?.('incident_reopened', { incident_type: i.type });
      document.getElementById('reopenZone').innerHTML = `<p class="notice ok">${esc(r.message)}</p>`;
      loadIncidents();
      setTimeout(() => openDetail(i.public_id), 800);
    } catch (ex) {
      document.getElementById('reopenZone').innerHTML = `<p class="field-error">${esc(ex.message)}</p>`;
    }
  }));
}

// ── « Situation incendie » : sections vent + consignes officielles d'une fiche.
// Chaque source échoue INDÉPENDAMMENT ; les états « indisponible » et
// « périmé » sont toujours affichés honnêtement, jamais tus.
async function renderFireSituationSections(host, fireLat, fireLng) {
  if (currentCountry() !== 'FR' || !host) return;
  const zone = document.createElement('div');
  host.appendChild(zone);
  // A. Ce que le vent indique
  try {
    const params = new URLSearchParams({ fireLat: fireLat.toFixed(3), fireLng: fireLng.toFixed(3) });
    if (userPos) { params.set('userLat', userPos.lat.toFixed(3)); params.set('userLng', userPos.lng.toFixed(3)); }
    const w = await API.get(`/api/fire-situation/wind?${params}`);
    if (w.enabled) {
      let inner;
      if (!w.wind) inner = `<p class="muted small">${esc(t('fs_wind_unavailable'))}</p>`;
      else if (w.wind.stale) inner = `<p class="muted small">${esc(t('fs_wind_stale'))}</p>`;
      else {
        const dirTxt = windDirName(w.wind.directionToDeg);
        const ctx = w.downwind === 'downwind' ? t('fs_downwind')
          : (w.downwind === 'crosswind' || w.downwind === 'upwind') ? t('fs_not_downwind')
          : w.downwind === 'unknown' ? t('fs_downwind_unknown') : '';
        inner = `
          <p><strong>💨 ${esc(t('fs_wind_line', { v: w.wind.speedKmh, dir: dirTxt }))}</strong>
          ${w.wind.gustsKmh ? `· ${esc(t('fs_wind_gusts', { g: w.wind.gustsKmh }))}` : ''}</p>
          ${ctx ? `<p>${esc(ctx)}</p>` : ''}
          <p class="muted small">${esc(t('fs_wind_note'))}<br>${esc(t('fs_wind_at', { t: fmtDate(w.wind.observedAt) }))}</p>`;
      }
      zone.insertAdjacentHTML('beforeend', `<h2 style="margin-top:1rem">${esc(t('fs_wind_head'))}</h2>${inner}`);
    }
  } catch { /* le vent tombe en panne sans bloquer la fiche */ }
  // B. Consignes officielles (source la plus spécifique d'abord)
  try {
    const o = await API.get(`/api/fire-situation/official?lat=${fireLat.toFixed(3)}&lng=${fireLng.toFixed(3)}`);
    if (o.enabled) {
      let inner;
      if (!o.updates.length) inner = `<p class="muted small">${esc(t('fs_official_none'))}</p>`;
      else {
        const u = o.updates[0];
        const summary = LANG === 'ar' && u.summaryAr
          ? `${esc(u.summaryAr)}<br><span class="muted small">${esc(t('fs_ar_summary_note'))}</span>`
          : esc(u.summaryFr);
        inner = `
          <div class="notice ${['evacuation', 'shelter_in_place', 'safety_instruction'].includes(u.infoType) ? 'danger' : ''}">
            <strong>${esc(u.isFrAlert ? 'FR-Alert' : u.authority)}</strong> · ${esc(infoTypeLabel(u.infoType))}<br>
            <span class="small">${esc(timeAgo(u.publishedAt))}</span>
            <p>${summary}</p>
            ${u.sourceUrl ? `<a href="${esc(u.sourceUrl)}" target="_blank" rel="noopener">${esc(t('fs_official_read'))}</a>` : ''}
          </div>
          <p class="muted small">${esc(t('fs_fr_alert_note'))}</p>`;
      }
      zone.insertAdjacentHTML('beforeend', `<h2 style="margin-top:1rem">${esc(t('fs_official_head'))}</h2>${inner}`);
    }
  } catch {
    zone.insertAdjacentHTML('beforeend',
      `<h2 style="margin-top:1rem">${esc(t('fs_official_head'))}</h2><p class="muted small">${esc(t('fs_official_unavailable'))}</p>`);
  }
}

// --- Fiche d'un événement satellite (NASA FIRMS) -----------------------------
// Anomalie thermique détectée par satellite : présentation distincte des
// signalements citoyens, jamais comme confirmation officielle d'incendie.
async function openSatDetail(id) {
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('detailSheet');
  let ev;
  try { ev = await API.get(`/api/public/satellite/events/${encodeURIComponent(id)}`); }
  catch (e) { el.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }

  const confirmed = isDone('sat_confirmed', ev.id);
  const confLabel = t(`sat_conf_${ev.max_confidence}`) || ev.max_confidence;
  el.innerHTML = `
    <h2><span class="badge sat">🛰️ ${t('sat_detection')} — NASA FIRMS</span>
        ${ev.status === 'no_new_detection' ? `<span class="badge status expired">${t('sat_no_new')}</span>` : ''}</h2>
    <p><strong>${t('sat_potential_fire')}</strong></p>
    <p class="notice sat small"><strong>${t('sat_source')}</strong> · ${t('area_approx')}</p>
    <p><strong>${t('sat_first_seen')}</strong> ${esc(fmtDate(ev.first_detected_at))}<br>
    <strong>${t('sat_last_seen')}</strong> ${esc(fmtDate(ev.last_detected_at))}<br>
    <strong>${t('sat_confidence')}</strong> ${esc(confLabel)}<br>
    ${ev.detection_count > 1 ? t('sat_detections_n', { n: ev.detection_count }) : t('sat_detections_one')}
    ${ev.satellites ? `<br><strong>${t('sat_satellites')}</strong> ${esc(ev.satellites)}` : ''}
    ${ev.max_frp ? `<br><strong>${t('sat_frp')}</strong> ${esc(String(Math.round(ev.max_frp)))} MW` : ''}
    ${ev.lastSyncAt ? `<br><span class="muted small">${t('sat_last_sync', { t: fmtDate(ev.lastSyncAt) })}</span>` : ''}</p>
    ${ev.confirmations_count > 0 ? `<p class="notice ok">${ev.confirmations_count > 1 ? t('affected_n', { n: ev.confirmations_count }) : t('affected_one')}</p>` : ''}
    <p class="notice warn small">${t('sat_disclaimer')}</p>
    <p class="notice danger small">${t(currentCountry() === 'FR' ? 'sat_danger_fr' : 'sat_danger')}</p>
    <div id="satConfirmZone">
      ${confirmed ? `<p class="notice ok">${t('sat_you_confirmed')}</p>` : `<button class="btn" id="btnSatSee">${t('sat_i_see')}</button>`}
    </div>
    <button class="btn ghost small-btn" id="btnSatNotFire" style="margin-top:.5rem">${t('sat_not_fire')}</button>
    <button class="btn ghost small-btn" id="btnSatError" style="margin-top:.5rem">${t('sat_report_error')}</button>
    <div id="satFeedbackZone"></div>`;

  // Zone d'activité approximative + vent + consignes officielles (France).
  if (ev.activityRadiusM) {
    el.insertAdjacentHTML('beforeend',
      `<p class="notice sat small"><strong>${esc(t('fs_sat_zone'))}</strong> · ~${esc(String(Math.round(ev.activityRadiusM / 100) / 10))} km<br>${esc(t('fs_sat_zone_note'))}</p>`);
  }
  renderFireSituationSections(el, ev.lat, ev.lng);

  const feedback = async (kind, btn) => {
    try {
      const r = await API.post(`/api/public/satellite/events/${encodeURIComponent(ev.id)}/feedback`,
        { kind, deviceId: getDeviceId() });
      window.track?.('satellite_event_feedback', { kind });
      if (kind === 'confirm') {
        markDone('sat_confirmed', ev.id);
        document.getElementById('satConfirmZone').innerHTML = `<p class="notice ok">${t('sat_you_confirmed')}<br>
          ${r.confirmations > 1 ? t('affected_n', { n: r.confirmations }) : t('affected_one')}</p>`;
        loadIncidents();
      } else {
        document.getElementById('satFeedbackZone').innerHTML = `<p class="notice ok">${t('sat_thanks')}</p>`;
        btn?.remove();
      }
    } catch (ex) {
      if (ex.data?.alreadyConfirmed && kind === 'confirm') {
        markDone('sat_confirmed', ev.id);
        document.getElementById('satConfirmZone').innerHTML = `<p class="notice ok">${t('sat_you_confirmed')}</p>`;
      } else document.getElementById('satFeedbackZone').innerHTML = `<p class="field-error">${esc(ex.message)}</p>`;
    }
  };
  document.getElementById('btnSatSee')?.addEventListener('click', (e) => withButton(e.currentTarget, () => feedback('confirm')));
  document.getElementById('btnSatNotFire').addEventListener('click', (e) => feedback('not_fire', e.currentTarget));
  document.getElementById('btnSatError').addEventListener('click', (e) => feedback('error', e.currentTarget));
}

// Position rapide et silencieuse (renforce la confirmation d'un incendie) —
// jamais bloquante : sans réponse en 4 s, la confirmation part sans position.
function quickPosition() {
  return new Promise((resolve) => {
    if (userPos) return resolve(userPos);
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 120000 }
    );
  });
}

async function directConfirm(i) {
  const zone = document.getElementById('confirmZone');
  try {
    const pos = i.type === 'fire' ? await quickPosition() : userPos;
    const r = await API.post('/api/public/confirm/direct', {
      publicId: i.public_id, deviceId: getDeviceId(),
      approxLat: pos?.lat, approxLng: pos?.lng,
    });
    window.track?.('incident_confirmed', { incident_type: i.type });
    markDone('confirmed', i.public_id);
    zone.innerHTML = `<p class="notice ok">${t('you_confirmed')}</p>`;
    // Moment de motivation maximale : proposer (sans forcer) les alertes de zone.
    offerZoneAlerts(zone, i.lat, i.lng);
    const counts = document.getElementById('affectedCount');
    counts.hidden = false;
    counts.className = 'notice ok';
    counts.textContent = r.confirmations > 1 ? t('affected_n', { n: r.confirmations }) : t('affected_one');
    if (i.type === 'fire') {
      i.confirmations_count = r.confirmations;
      i.fireThreshold = r.fireThreshold;
      document.getElementById('fireStatus')?.remove();
      counts.insertAdjacentHTML('beforebegin', fireStatusHtml(i));
    }
    loadIncidents();
  } catch (ex) {
    if (ex.data?.alreadyConfirmed) {
      markDone('confirmed', i.public_id);
      zone.innerHTML = `<p class="notice ok">${t('you_confirmed')}</p>`;
    } else {
      zone.insertAdjacentHTML('beforeend', `<p class="field-error">${esc(ex.message)}</p>`);
    }
  }
}

// « Signaler que cet incident est terminé » — signalement communautaire lié à
// l'incident existant ; clôture automatique seulement au seuil configuré.
function renderEndedForm(i) {
  const zone = document.getElementById('endedZone');
  zone.innerHTML = `
    <div class="card">
      <h2>${t('ended_q')}</h2>
      <div class="seg" role="group">
        <button id="endedModeNow" aria-pressed="true">${t('ended_now')}</button>
        <button id="endedModePick" aria-pressed="false">${t('ended_pick')}</button>
      </div>
      <div id="endedTimeField" hidden>
        <label for="endedTime">${t('ended_time_label')}</label>
        <input id="endedTime" type="datetime-local" value="${toLocalInput(new Date())}"
               min="${toLocalInput(i.started_at)}" max="${toLocalInput(new Date())}">
      </div>
      <label for="endedComment">${t('ended_comment_label')}</label>
      <textarea id="endedComment" maxlength="300"></textarea>
      <div class="field-error" id="endedError" role="alert"></div>
      <button class="btn" id="endedSend">${t('ended_send')}</button>
    </div>`;
  let mode = 'now';
  const setMode = (m) => {
    mode = m;
    document.getElementById('endedModeNow').setAttribute('aria-pressed', m === 'now');
    document.getElementById('endedModePick').setAttribute('aria-pressed', m === 'pick');
    document.getElementById('endedTimeField').hidden = m !== 'pick';
  };
  document.getElementById('endedModeNow').addEventListener('click', () => setMode('now'));
  document.getElementById('endedModePick').addEventListener('click', () => setMode('pick'));
  document.getElementById('endedSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const err = document.getElementById('endedError'); err.textContent = '';
    try {
      const v = document.getElementById('endedTime').value;
      // Validation côté client (le serveur revalide toujours) :
      if (mode === 'pick') {
        if (!v) { err.textContent = t('err_end_required'); return; }
        const ts = new Date(v).getTime();
        if (ts <= Date.parse(i.started_at)) { err.textContent = t('err_end_before'); return; }
        if (ts > Date.now() + 60_000) { err.textContent = t('err_end_future'); return; }
      }
      const r = await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/resolution`, {
        deviceId: getDeviceId(),
        isNow: mode === 'now',
        proposedEndedAt: mode === 'pick' && v ? new Date(v).toISOString() : null,
        comment: document.getElementById('endedComment').value,
      });
      window.track?.('incident_resolution_reported', { incident_type: i.type, resolved: r.resolved });
      markDone('ended', i.public_id);
      zone.innerHTML = `<p class="notice ok">${r.reports > 1 ? t('ended_reports_n', { n: r.reports }) : t('ended_reports_one')}</p>`;
      document.getElementById('btnEnded')?.remove();
      if (r.resolved) openDetail(i.public_id);
      loadIncidents();
    } catch (ex) {
      if (ex.data?.alreadyReported) {
        markDone('ended', i.public_id);
        zone.innerHTML = `<p class="notice ok">${esc(ex.message)}</p>`;
        document.getElementById('btnEnded')?.remove();
      } else document.getElementById('endedError').textContent = ex.message;
    }
  }));
}

// Correction de localisation proposée par un visiteur : carte avec repère
// déplaçable + recherche d'adresse + position GPS. La proposition part en
// modération — elle ne déplace jamais l'incident de quelqu'un d'autre en direct.
let correctMap = null, correctMarker = null;
function renderCorrectionForm(i) {
  const zone = document.getElementById('locCorrectZone');
  correctMap = null; correctMarker = null;
  zone.innerHTML = `
    <div class="card">
      <h2>${t('loc_correct_title')}</h2>
      <p class="muted small">${t('loc_correct_hint_public')}</p>
      <button class="btn secondary small-btn" id="corrGeo">${t('use_position')}</button>
      <div class="searchbox" style="margin-top:.5rem">
        <input id="corrSearch" type="text" autocomplete="off" placeholder="${esc(t('addr_ph'))}">
        <div id="corrResults" class="search-results" role="listbox" hidden></div>
      </div>
      <div id="correctMap" class="mini-map" aria-label="${esc(t('minimap_aria'))}"></div>
      <p class="muted small" id="corrPreview" aria-live="polite"></p>
      <div class="field-error" id="corrError" role="alert"></div>
      <button class="btn" id="corrSend" disabled>${t('loc_correct_send')}</button>
    </div>`;
  const state = { lat: i.lat, lng: i.lng, address: null };
  setTimeout(() => {
    correctMap = createMap('correctMap', { center: [i.lat, i.lng], zoom: 15 });
    correctMarker = L.marker([i.lat, i.lng], { draggable: true, icon: typeIcon(i.type, i.status) }).addTo(correctMap);
    const setPos = (lat, lng, address) => {
      state.lat = lat; state.lng = lng; state.address = address || null;
      correctMarker.setLatLng([lat, lng]);
      document.getElementById('corrSend').disabled = false;
      document.getElementById('corrPreview').textContent =
        `${t('loc_correct_preview')} ${address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`;
    };
    correctMarker.on('dragend', () => { const p = correctMarker.getLatLng(); setPos(p.lat, p.lng); });
    correctMap.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng));
    document.getElementById('corrGeo').addEventListener('click', (e) => withButton(e.currentTarget, () => new Promise((resolve) => {
      if (!navigator.geolocation) { document.getElementById('corrError').textContent = t('geo_unavailable'); return resolve(); }
      navigator.geolocation.getCurrentPosition(
        (pos) => { correctMap.setView([pos.coords.latitude, pos.coords.longitude], 16); setPos(pos.coords.latitude, pos.coords.longitude); resolve(); },
        () => { document.getElementById('corrError').textContent = t('geo_not_found'); resolve(); },
        { enableHighAccuracy: true, timeout: 8000 });
    })));
    // Recherche d'adresse (accepte arabe, français et translittérations).
    const inp = document.getElementById('corrSearch');
    const resBox = document.getElementById('corrResults');
    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 3) { resBox.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const { results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`);
          resBox.innerHTML = '';
          for (const r of results) {
            const b = document.createElement('button');
            b.textContent = r.label;
            b.addEventListener('click', () => {
              resBox.hidden = true;
              inp.value = r.label.split(',').slice(0, 2).join(',');
              correctMap.setView([r.lat, r.lng], 16);
              setPos(r.lat, r.lng, r.label);
            });
            resBox.appendChild(b);
          }
          resBox.hidden = results.length === 0;
        } catch { resBox.hidden = true; }
      }, 350);
    });
  }, 60);
  document.getElementById('corrSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const r = await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/location-correction`, {
        deviceId: getDeviceId(), lat: state.lat, lng: state.lng, address: state.address,
      });
      window.track?.('location_correction_proposed', { incident_type: i.type });
      zone.innerHTML = `<p class="notice ok">${esc(r.message)}</p>`;
    } catch (ex) { document.getElementById('corrError').textContent = ex.message; }
  }));
}

function renderConfirmForm(i) {
  const zone = document.getElementById('confirmZone');
  zone.innerHTML = `
    <div class="card">
      <h2>${t('confirm_title')}</h2>
      <p class="muted small">${t('confirm_hint')}</p>
      <div class="seg" role="group" aria-label="${esc(t('confirm_method_aria'))}">
        <button id="cSms" aria-pressed="true">${t('sms')}</button>
        <button id="cEmail" aria-pressed="false">${t('email')}</button>
      </div>
      <div id="cPhoneField"><label for="cPhone">${t('phone_label')}</label>
        <input id="cPhone" type="tel" inputmode="tel" placeholder="${esc(countryProfile().phonePlaceholder)}" autocomplete="tel"></div>
      <div id="cEmailField" hidden><label for="cEmailInput">${t('email_label')}</label>
        <input id="cEmailInput" type="email" inputmode="email" placeholder="${esc(t('email_ph'))}" autocomplete="email"></div>
      <div class="checkbox-row">
        <input type="checkbox" id="cConsent">
        <label for="cConsent">${t('consent_confirm')}</label>
      </div>
      <div class="field-error" id="cError" role="alert"></div>
      <button class="btn" id="cSend">${t('receive_code')}</button>
      <div id="cCodeZone"></div>
    </div>`;
  let method = 'sms';
  const seg = (m) => {
    method = m;
    document.getElementById('cSms').setAttribute('aria-pressed', m === 'sms');
    document.getElementById('cEmail').setAttribute('aria-pressed', m !== 'sms');
    document.getElementById('cPhoneField').hidden = m !== 'sms';
    document.getElementById('cEmailField').hidden = m === 'sms';
  };
  document.getElementById('cSms').addEventListener('click', () => seg('sms'));
  document.getElementById('cEmail').addEventListener('click', () => seg('email'));
  document.getElementById('cSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const err = document.getElementById('cError'); err.textContent = '';
    try {
      const body = {
        publicId: i.public_id, consent: document.getElementById('cConsent').checked,
        method: method === 'sms' ? 'sms' : 'email_code',
        phone: document.getElementById('cPhone').value.trim(),
        email: document.getElementById('cEmailInput').value.trim(),
      };
      const { verificationId } = await API.post('/api/public/confirm/start', body);
      renderConfirmCode(i, verificationId);
    } catch (ex) { err.textContent = ex.message; }
  }));
}

function renderConfirmCode(i, verificationId) {
  const zone = document.getElementById('cCodeZone');
  zone.innerHTML = `
    <label for="cCode">${t('code_label')}</label>
    <input id="cCode" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
    <div class="field-error" id="cCodeError" role="alert"></div>
    <button class="btn" id="cVerify" style="margin-top:.5rem">${t('validate_confirm')}</button>`;
  document.getElementById('cVerify').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const err = document.getElementById('cCodeError'); err.textContent = '';
    try {
      const r = await API.post('/api/public/confirm/verify', {
        verificationId, code: document.getElementById('cCode').value.trim(),
        approxLat: userPos?.lat, approxLng: userPos?.lng,
      });
      markDone('confirmed', i.public_id);
      document.getElementById('confirmZone').innerHTML =
        `<p class="notice ok">${t('you_confirmed')}<br>${r.confirmations > 1 ? t('affected_n', { n: r.confirmations }) : t('affected_one')}</p>`;
      loadIncidents();
    } catch (ex) { err.textContent = ex.message; }
  }));
}

// Invitation discrète aux alertes de zone — uniquement si pertinent : push
// pris en charge, pas déjà abonné, permission pas déjà refusée. Une ligne,
// jamais bloquante, jamais répétée dans la même fiche.
async function offerZoneAlerts(zone, lat, lng) {
  try {
    if (!pushSupported() || Notification.permission === 'denied' || !pushKey) return;
    if (await currentPushSubscription()) return;
    if (zone.querySelector('.alerts-offer')) return;
    const p = document.createElement('p');
    p.className = 'notice alerts-offer';
    p.innerHTML = `${esc(t('alerts_offer'))}<br><button class="btn secondary small-btn" style="margin-top:.4rem">${esc(t('alerts_offer_btn'))}</button>`;
    p.querySelector('button').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
      try {
        await kifehSubscribePush({ lat, lng, radiusKm: 10, key: pushKey, country: currentCountry() });
        window.track?.('zone_alerts_enabled', { radius_km: 10, source: 'after_confirm' });
        alertsBtnState(true);
        p.innerHTML = `<span>${esc(t('alerts_on_done', { km: 10 }))}</span>`;
      } catch (ex) {
        p.innerHTML = `<span>${esc(t(ex.message === 'denied' ? 'alerts_denied' : 'search_error'))}</span>`;
      }
    }));
    zone.appendChild(p);
  } catch { /* invitation facultative : jamais d'erreur visible */ }
}

// Lien profond depuis le parcours de déclaration : ?confirm=INC-XXXXXX,
// ?incident=INC-XXXXXX (partage, notification), ?satellite=<id> (notification).
(function deepLinks() {
  const p = new URLSearchParams(location.search);
  const confirmId = p.get('confirm');
  const viewId = p.get('incident');
  const satId = p.get('satellite');
  if (p.get('src') === 'push') window.track?.('push_notification_opened', {});
  if (confirmId) openDetail(confirmId).then(() => document.getElementById('btnConfirm')?.click());
  else if (viewId) openDetail(viewId);
  else if (satId) openSatDetail(satId);
})();

function renderReportForm(i) {
  const zone = document.getElementById('reportZone');
  zone.innerHTML = `
    <div class="card">
      <label for="rReason">${t('report_reason')}</label>
      <select id="rReason">
        <option value="wrong_location">${t('reason_wrong_location')}</option>
        <option value="not_real">${t('reason_not_real')}</option>
        <option value="resolved">${t('reason_resolved')}</option>
        <option value="inappropriate">${t('reason_inappropriate')}</option>
        <option value="other">${t('reason_other')}</option>
      </select>
      <label for="rDetail">${t('report_detail')}</label>
      <textarea id="rDetail" maxlength="500"></textarea>
      <div class="field-error" id="rError" role="alert"></div>
      <button class="btn secondary" id="rSend">${t('report_send')}</button>
    </div>`;
  document.getElementById('rSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const r = await API.post('/api/public/report', {
        publicId: i.public_id,
        reason: document.getElementById('rReason').value,
        detail: document.getElementById('rDetail').value,
      });
      zone.innerHTML = `<p class="notice ok">${esc(r.message)}</p>`;
    } catch (ex) { document.getElementById('rError').textContent = ex.message; }
  }));
}
