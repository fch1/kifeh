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

const map = createMap('map', { deferTiles: LITE, zoomless: true, ...initialView() });
window.kifehMapZoom = () => map.getZoom(); // sonde de test (lecture seule)
window.kifehSetView = (lat, lng, z) => map.setView([lat, lng], z); // sonde de test
// Lien profond de zone (pages départementales #83) : ?lat&lng&z centre la
// carte à l'arrivée puis s'efface de l'URL. SANS paramètre : strictement rien.
try {
  const qp = new URLSearchParams(location.search);
  const dlLat = parseFloat(qp.get('lat')), dlLng = parseFloat(qp.get('lng'));
  if (Number.isFinite(dlLat) && Number.isFinite(dlLng)
    && dlLat >= -90 && dlLat <= 90 && dlLng >= -180 && dlLng <= 180) {
    const dlZ = parseInt(qp.get('z'), 10);
    map.setView([dlLat, dlLng], Number.isFinite(dlZ) ? Math.min(Math.max(dlZ, 3), 18) : 10);
    qp.delete('lat'); qp.delete('lng'); qp.delete('z');
    history.replaceState(null, '', location.pathname + (qp.toString() ? `?${qp}` : '') + location.hash);
  }
} catch { /* URL illisible : la vue par défaut s'applique */ }
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
  // Refonte PR 2 : composition desktop (≥1200 px) derrière drapeau serveur.
  if (c.desktopRail !== false) {
    document.body.classList.add('rail-ok');
    document.getElementById('situChip')?.removeAttribute('hidden'); // visible ≥1200 px via CSS
  }
  if (c.sandbox) showSandboxBanner();
  pushKey = c.pushKey || null; // clé publique VAPID (alertes de zone)
  // Fond de carte configuré côté serveur (fournisseur principal + secours).
  setTileProviders(c.tileProviders, c.tileFailThreshold);
  // Moteur MapLibre du mode feux (#103, drapeau OFF par défaut) : on ARME
  // seulement — rien ne se charge tant que le mode feux n'est pas actif.
  window.kifehGLBoot?.(c);
  // Replay 72 h (#110) : actif par défaut, coupure à chaud serveur.
  window.kifehReplayBoot?.(c);
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
  // Le bouton du bas est désormais « Suivis » (⭐) : l'état des notifications
  // n'écrase plus son libellé — il vit dans les fiches de suivi elles-mêmes.
  document.getElementById('btnAlerts')?.setAttribute('aria-pressed', String(on));
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
// ═════════════════════════════════════════════════════════════════════════════
// « Suivre cette zone » — UN parcours continu : je choisis une zone → je
// comprends ce que je recevrai (AVANT toute permission navigateur) → je suis
// la zone → je peux tester la livraison. Le bouton du bas devient « Suivis ».
// ═════════════════════════════════════════════════════════════════════════════
let followRadius = 20;

let followPickedPlace = null; // adresse choisie DANS la feuille de suivi
function zonePlaceLabel() {
  if (followPickedPlace) return followPickedPlace.split(',')[0].slice(0, 30);
  const q = document.getElementById('search').value.trim();
  return (q ? q.split(',')[0] : '').slice(0, 30) || t('follow_here_place');
}
// Zone suivie couvrant le centre actuel (même pays, < 3 km).
function currentFollowedZone() {
  const c = map.getCenter();
  return zoneStore().find((z) => z.country === currentCountry()
    && map.distance([z.lat, z.lng], [c.lat, c.lng]) < 3000) || null;
}
// Crée ou met à jour la zone suivie au centre actuel.
function saveFollowZoneAtCenter(extra = {}) {
  const zones = zoneStore();
  const c = map.getCenter();
  let z = zones.find((s) => s.country === currentCountry()
    && map.distance([s.lat, s.lng], [c.lat, c.lng]) < 3000);
  if (!z) {
    if (zones.length >= 5) { transientBanner(t('follow_zone_limit')); return null; }
    z = { label: zonePlaceLabel(), lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3),
      zoom: map.getZoom(), country: currentCountry(), at: Date.now() };
    zones.push(z);
  }
  Object.assign(z, { radiusKm: followRadius, ...extra });
  try { localStorage.setItem('kifeh_zones', JSON.stringify(zones)); } catch {}
  try { localStorage.setItem('kifeh_pwa_eligible', '1'); } catch {} // installer devient utile
  renderSummary(false);
  return z;
}

function openFollowSheet() {
  followPickedPlace = null; // repartir de la zone affichée, pas d'un ancien choix
  openSheet('alertSheet');
  renderFollowSheet();
  window.track?.('follow_sheet_opened', {});
}

function renderFollowSheet() {
  const body = document.getElementById('followBody');
  const existing = currentFollowedZone();
  if (existing) return renderFollowSuccess(existing);
  followRadius = 20;
  const place = zonePlaceLabel();
  body.innerHTML = `
    <h2>☆ ${esc(t('follow_sheet_title', { place }))}</h2>
    <p class="muted small">${esc(t('follow_sheet_intro'))}</p>
    <p class="small" style="margin-bottom:.25rem"><strong>${esc(t('follow_will_title'))}</strong></p>
    <ul class="small follow-list">
      <li>${esc(t('follow_will_1'))}</li>
      <li>${esc(t('follow_will_2'))}</li>
      <li>${esc(t('follow_will_3'))}</li>
    </ul>
    <p class="muted small">${esc(t('follow_wont'))}</p>
    <label class="small" for="followAddr" style="margin-top:.5rem">${esc(t('follow_addr_label'))}</label>
    <div class="row" style="gap:.5rem">
      <input type="text" id="followAddr" inputmode="search" autocomplete="off"
             placeholder="${esc(t('search_ph'))}" style="flex:1;min-height:44px">
      <button class="btn secondary small-btn" id="followAddrBtn" type="button" style="flex:0 0 auto">🔍</button>
    </div>
    <div id="followAddrRes" class="follow-list" role="listbox"></div>
    <label class="small" style="margin-top:.5rem">${esc(t('follow_radius'))}</label>
    <div class="chips" id="radiusChips" role="group">
      ${[5, 10, 20, 30].map((r) => `<button class="chip" type="button" data-r="${r}" aria-pressed="${r === 20}">${r} km</button>`).join('')}
    </div>
    ${pushSupported()
    ? `<button class="btn" id="followPushBtn" type="button" style="margin-top:.75rem">🔔 ${esc(t('follow_enable_push'))}</button>`
    : `<p class="muted small">${esc(t('alerts_unsupported'))}</p>`}
    <div class="row" style="gap:.5rem;margin-top:.5rem">
      <input type="email" id="followEmail" inputmode="email" autocomplete="email"
             placeholder="${esc(t('email_alerts_ph'))}" style="flex:1;min-height:44px" aria-label="${esc(t('alerts_email_title'))}">
      <button class="btn secondary small-btn" id="followEmailBtn" type="button" style="flex:0 0 auto">✉️ ${esc(t('email_alerts_btn'))}</button>
    </div>
    <label class="checkbox-row small"><input type="checkbox" id="followDigest">
      ${esc(t('email_digest_optin'))}</label>
    <p class="muted small" id="followMsg" role="status" aria-live="polite"></p>
    <button class="btn ghost small-btn" id="followLater" type="button">${esc(t('follow_later'))}</button>
    <p class="muted small" style="margin-top:.25rem">${esc(t('follow_can_change'))}</p>
    <button class="btn ghost small-btn" id="followSeeSuivis" type="button">★ ${esc(t('follow_see_suivis'))}</button>`;
  // Suivre une AUTRE zone que celle affichée : saisir une adresse — la carte
  // s'y déplace, l'explication et le rayon s'appliquent au nouvel endroit.
  const addrSearch = async () => {
    const q = document.getElementById('followAddr').value.trim();
    const res = document.getElementById('followAddrRes');
    if (q.length < 3) { res.innerHTML = ''; return; }
    res.innerHTML = `<p class="muted small">…</p>`;
    let results = [];
    try {
      ({ results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`));
    } catch { /* réseau : liste vide, message ci-dessous */ }
    res.innerHTML = (results || []).slice(0, 4).map((r, k) => `
      <button class="btn secondary small-btn" type="button" role="option"
              data-k="${k}" data-lat="${r.lat}" data-lng="${r.lng}">📍 ${esc(String(r.label || '').slice(0, 60))}</button>`).join('')
      || `<p class="muted small">${esc(t('follow_addr_none'))}</p>`;
    res.querySelectorAll('button[data-k]').forEach((b, k) => b.addEventListener('click', () => {
      followPickedPlace = String(results[k].label || '');
      map.setView([Number(b.dataset.lat), Number(b.dataset.lng)], 12);
      renderFollowSheet(); // ré-explique pour LE nouvel endroit (rayon par défaut)
      window.track?.('follow_addr_picked', {});
    }));
  };
  document.getElementById('followAddrBtn')?.addEventListener('click', addrSearch);
  document.getElementById('followAddr')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addrSearch(); }
  });
  document.getElementById('followSeeSuivis')?.addEventListener('click', openSuivis);
  document.querySelectorAll('#radiusChips .chip').forEach((chip) => chip.addEventListener('click', () => {
    followRadius = Number(chip.dataset.r);
    document.querySelectorAll('#radiusChips .chip').forEach((c) =>
      c.setAttribute('aria-pressed', String(c === chip)));
  }));
  // La permission navigateur n'est demandée QU'ICI, après l'explication.
  document.getElementById('followPushBtn')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const c = map.getCenter();
      await kifehSubscribePush({ lat: c.lat, lng: c.lng, radiusKm: followRadius, key: pushKey, country: currentCountry() });
      alertsBtnState(true);
      const z = saveFollowZoneAtCenter({ push: true });
      window.track?.('zone_alerts_enabled', { radius_km: followRadius });
      if (z) renderFollowSuccess(z, true);
    } catch (ex) {
      document.getElementById('followMsg').textContent =
        t(ex.message === 'denied' ? 'follow_push_denied' : 'search_error');
    }
  }));
  document.getElementById('followEmailBtn')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const email = document.getElementById('followEmail').value.trim();
    const msgEl = document.getElementById('followMsg');
    if (!email || !email.includes('@')) { msgEl.textContent = t('email_alerts_invalid'); return; }
    try {
      const c = map.getCenter();
      const r = await API.post('/api/public/email-alerts/subscribe', {
        email, lat: c.lat, lng: c.lng, radiusKm: followRadius, country: currentCountry(), lang: LANG,
        digest: Boolean(document.getElementById('followDigest')?.checked),
      });
      saveFollowZoneAtCenter({ email: true });
      msgEl.textContent = r.message;
      window.track?.('email_alerts_subscribed', {});
    } catch (ex) { msgEl.textContent = ex.message; }
  }));
  document.getElementById('followLater')?.addEventListener('click', () => {
    const z = saveFollowZoneAtCenter({});
    window.track?.('zone_followed', { notif: 'none' });
    if (z) renderFollowSuccess(z, true);
  });
}

// État de réussite : statut réel de livraison + notification de test.
function renderFollowSuccess(z, justSaved) {
  const body = document.getElementById('followBody');
  body.innerHTML = `
    ${justSaved ? `<p class="notice ok">${esc(t('follow_done_banner', { place: z.label }))}</p>` : ''}
    <h2>★ ${esc(z.label)}</h2>
    <p class="small">${esc(t('follow_done_body', { km: z.radiusKm || 20 }))}</p>
    <p class="small">${z.push ? `🔔 ${esc(t('follow_push_on'))}` : `🔕 ${esc(t('follow_push_off'))}`}${z.email ? ` · ✉️ ${esc(t('follow_email_on'))}` : ''}</p>
    ${z.push
    ? `<button class="btn secondary" id="followTestBtn" type="button">${esc(t('follow_test_btn'))}</button>`
    : (pushSupported() ? `<button class="btn" id="followPushBtn2" type="button">🔔 ${esc(t('follow_enable_push'))}</button>` : '')}
    <p class="muted small" id="followMsg" role="status" aria-live="polite"></p>
    <label class="small" for="zoneNameInput" style="margin-top:.5rem">${esc(t('zone_name_label'))}</label>
    <div class="chips" id="zoneNameChips">
      ${['zone_name_home', 'zone_name_family', 'zone_name_work'].map((k) =>
    `<button class="chip" type="button" data-name="${esc(t(k))}">${esc(t(k))}</button>`).join('')}
    </div>
    <div class="row" style="gap:.5rem">
      <input type="text" id="zoneNameInput" maxlength="30" value="${esc(z.label || '')}"
             style="flex:1;min-height:44px" aria-label="${esc(t('zone_name_label'))}">
      <button class="btn secondary small-btn" id="zoneNameSave" type="button" style="flex:0 0 auto">✓</button>
    </div>
    <div class="row" style="gap:.5rem;margin-top:.5rem">
      <button class="btn ghost small-btn" id="followSee" type="button">${esc(t('suivis_see'))}</button>
      <button class="btn ghost small-btn" id="followRemove" type="button">${esc(t('follow_remove'))}</button>
    </div>`;
  // Nommer sa zone (« Chez moi », « Parents »…) : le suivi devient personnel.
  const saveZoneName = (name) => {
    const clean = String(name || '').trim().slice(0, 30);
    if (!clean) return;
    const zones = zoneStore();
    const zz = zones.find((s) => s.at === z.at);
    if (zz) {
      zz.label = clean;
      try { localStorage.setItem('kifeh_zones', JSON.stringify(zones)); } catch {}
      z.label = clean;
      document.getElementById('followMsg').textContent = t('zone_name_saved');
      renderSummary(false);
      window.track?.('zone_named', {});
      renderFollowSuccess(z);
    }
  };
  document.querySelectorAll('#zoneNameChips .chip').forEach((c) =>
    c.addEventListener('click', () => saveZoneName(c.dataset.name)));
  document.getElementById('zoneNameSave')?.addEventListener('click', () =>
    saveZoneName(document.getElementById('zoneNameInput').value));
  document.getElementById('followTestBtn')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const msgEl = document.getElementById('followMsg');
    try {
      const sub = await currentPushSubscription();
      if (!sub) { msgEl.textContent = t('follow_test_nosub'); return; }
      const r = await API.post('/api/public/push/test', { endpoint: sub.endpoint, lang: LANG });
      msgEl.textContent = r.ok ? t('follow_test_sent') : t('follow_test_failed');
      window.track?.('push_test', { ok: Boolean(r.ok) });
    } catch { msgEl.textContent = t('follow_test_failed'); }
  }));
  document.getElementById('followPushBtn2')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      await kifehSubscribePush({ lat: z.lat, lng: z.lng, radiusKm: z.radiusKm || 20, key: pushKey, country: z.country });
      alertsBtnState(true);
      renderFollowSuccess(saveFollowZoneAtCenter({ push: true }) || z);
    } catch (ex) {
      document.getElementById('followMsg').textContent =
        t(ex.message === 'denied' ? 'follow_push_denied' : 'search_error');
    }
  }));
  document.getElementById('followSee')?.addEventListener('click', () => {
    closeSheets(); map.setView([z.lat, z.lng], z.zoom || 12);
  });
  document.getElementById('followRemove')?.addEventListener('click', () => {
    const zones = zoneStore().filter((s) => s.at !== z.at);
    try { localStorage.setItem('kifeh_zones', JSON.stringify(zones)); } catch {}
    renderSummary(false);
    renderFollowSheet();
    window.track?.('zone_unfollowed', {});
  });
}

// ── « Suivis » : destination de premier rang (zones + incidents suivis) ──────
function openSuivis() {
  openSheet('suivisSheet');
  renderSuivis();
  window.track?.('suivis_opened', {});
}
function renderSuivis() {
  const body = document.getElementById('suivisBody');
  const zones = zoneStore();
  const follows = Object.entries(followStore());
  body.innerHTML = `
    <button class="btn" id="suivisFollowHere" type="button">☆ ${esc(t('follow_zone_btn'))}</button>
    ${zones.length ? `<p class="small" style="margin:.75rem 0 .25rem"><strong>${esc(t('suivis_zones'))}</strong></p>`
      + zones.map((z, i) => `
      <div class="card" style="margin:.4rem 0">
        <strong>📍 ${esc(z.label)}</strong>
        <span class="muted small"> · ${esc(String(z.radiusKm || 20))} km</span><br>
        <span class="small">${z.push ? `🔔 ${esc(t('follow_push_on'))}` : `🔕 ${esc(t('follow_push_off'))}`}${z.email ? ` · ✉️ ${esc(t('follow_email_on'))}` : ''}</span><br>
        <span class="small muted zone-activity" data-zlat="${z.lat}" data-zlng="${z.lng}" data-zr="${z.radiusKm || 20}">…</span>
        <div class="row" style="gap:.4rem;margin-top:.5rem">
          <button class="btn secondary small-btn" data-see="${i}" type="button">${esc(t('suivis_see'))}</button>
          <button class="btn ghost small-btn" data-manage="${i}" type="button">${esc(t('suivis_manage'))}</button>
          <button class="btn ghost small-btn" data-del="${i}" type="button">${esc(t('follow_remove'))}</button>
        </div>
      </div>`).join('') : ''}
    ${follows.length ? `<p class="small" style="margin:.75rem 0 .25rem"><strong>${esc(t('suivis_incidents'))}</strong></p>
      <div class="chips">${follows.map(([pid, f]) => `<button class="chip" type="button" data-pid="${esc(pid)}">★ ${TYPE_ICONS[f.type] || ''} ${esc(f.area || pid)}</button>`).join('')}</div>` : ''}
    ${!zones.length && !follows.length ? `<p class="muted small" style="margin-top:.75rem">${esc(t('suivis_empty'))}</p>` : ''}`;
  document.getElementById('suivisFollowHere')?.addEventListener('click', openFollowSheet);
  body.querySelectorAll('[data-see]').forEach((b) => b.addEventListener('click', () => {
    const z = zones[+b.dataset.see];
    closeSheets(); map.setView([z.lat, z.lng], z.zoom || 12);
  }));
  body.querySelectorAll('[data-manage]').forEach((b) => b.addEventListener('click', () => {
    const z = zones[+b.dataset.manage];
    map.setView([z.lat, z.lng], z.zoom || 12);
    openSheet('alertSheet');
    renderFollowSuccess(z);
  }));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const z = zones[+b.dataset.del];
    try { localStorage.setItem('kifeh_zones', JSON.stringify(zoneStore().filter((s) => s.at !== z.at))); } catch {}
    renderSummary(false);
    renderSuivis();
  }));
  body.querySelectorAll('[data-pid]').forEach((chip) => chip.addEventListener('click', () => {
    openDetail(chip.dataset.pid);
  }));
  // Activité RÉELLE de chaque zone suivie (« centre d'alertes » honnête) :
  // le compte d'incidents en cours dans le rayon, depuis les données publiques
  // — jamais un historique fabriqué. Chargement après rendu, jamais bloquant.
  body.querySelectorAll('.zone-activity').forEach(async (elz) => {
    try {
      const lat = +elz.dataset.zlat, lng = +elz.dataset.zlng, rKm = +elz.dataset.zr;
      const dLat = rKm / 111, dLng = rKm / (111 * Math.max(.2, Math.cos((lat * Math.PI) / 180)));
      const d = await API.get(`/api/public/incidents?${new URLSearchParams({
        minLat: (lat - dLat).toFixed(4), maxLat: (lat + dLat).toFixed(4),
        minLng: (lng - dLng).toFixed(4), maxLng: (lng + dLng).toFixed(4), status: 'active',
      })}`);
      const n = (d.incidents || []).filter((i) =>
        map.distance([lat, lng], [i.lat, i.lng]) <= rKm * 1000).length;
      elz.textContent = n ? `⚠️ ${t('suivis_active_n', { n })}` : `🟢 ${t('suivis_active_none')}`;
    } catch { elz.textContent = ''; }
  });
}
document.getElementById('btnAlerts').addEventListener('click', openSuivis);
// État initial du bouton (abonnement déjà actif ?) — sans demander de permission.
if (pushSupported()) {
  currentPushSubscription().then((s) => alertsBtnState(Boolean(s))).catch(() => {});
}

// ── Choix du pays : première visite (aucun pays mémorisé) + bouton d'en-tête ──
function renderCountryButton() {
  const btn = document.getElementById('countrySwitch');
  const p = countryProfile();
  btn.textContent = `${p.flag} ${p.name[LANG] || p.name.fr} ▾`; // territoire explicite, dépliable
  // Marque selon le pays consulté : bilingue en Tunisie (« Kifeh كيفاه »),
  // française en France (« Kifeh »). Indépendant de la langue de l'interface.
  const ar = document.getElementById('brandArabic');
  if (ar) ar.hidden = currentCountry() === 'FR';
  // Titre descriptif (référencement) — marque bilingue seulement côté Tunisie.
  document.title = currentCountry() === 'FR'
    ? 'Kifeh — incidents en quasi temps réel : électricité, eau, incendie, internet'
    : 'Kifeh كيفاه — incidents en quasi temps réel : électricité, eau, incendie, internet';
}
renderCountryButton();
document.getElementById('countrySwitch').addEventListener('click', () => openSheet('countrySheet'));
// Choisir le pays déjà actif referme simplement la feuille (sans rechargement).
function pickCountry(code) {
  if (code === currentCountry() && COUNTRY !== null) { closeSheets(); return; }
  window.track?.('country_selected', { selected_country: code });
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
// Première visite : DEUX écrans maximum — 1) ce que Kifeh montre (jamais
// bloquant, passable d'un geste, jamais re-montré) ; 2) le choix du pays
// (la feuille existante). Aucun écran sur les liens profonds.
if (typeof COUNTRY !== 'undefined' && COUNTRY === null
    && !location.search.includes('incident=') && !location.search.includes('confirm=')) {
  let seen = false;
  try { seen = localStorage.getItem('kifeh_onboarded') === '1'; } catch {}
  if (seen) {
    setTimeout(() => openSheet('countrySheet'), 400);
  } else {
    const ob = document.createElement('div');
    ob.className = 'onboard';
    ob.setAttribute('role', 'dialog');
    ob.setAttribute('aria-modal', 'true');
    ob.innerHTML = `
      <div class="onboard-card">
        <p class="onboard-brand">🔥 <strong>Kifeh</strong> <bdi>كيفاه</bdi></p>
        <p class="onboard-tagline">${esc(t('brand_tagline'))}</p>
        <div class="onboard-item"><span aria-hidden="true">🗺️</span>
          <span><strong>${esc(t('ob_map_title'))}</strong><br><span class="muted small">${esc(t('ob_map_body'))}</span></span></div>
        <div class="onboard-item"><span aria-hidden="true">⭐</span>
          <span><strong>${esc(t('ob_follow_title'))}</strong><br><span class="muted small">${esc(t('ob_follow_body'))}</span></span></div>
        <p class="muted small">${esc(t('ob_sources'))}</p>
        <button class="btn" id="obGo" type="button">${esc(t('ob_start'))}</button>
        <button class="btn ghost small-btn" id="obSkip" type="button">${esc(t('ob_skip'))}</button>
      </div>`;
    document.body.appendChild(ob);
    const done = (openCountry) => {
      try { localStorage.setItem('kifeh_onboarded', '1'); } catch {}
      ob.remove();
      if (openCountry) openSheet('countrySheet'); // écran 2 : le pays
    };
    ob.querySelector('#obGo').addEventListener('click', () => { done(true); window.track?.('onboard_go', {}); });
    ob.querySelector('#obSkip').addEventListener('click', () => { done(false); window.track?.('onboard_skip', {}); });
    window.track?.('onboard_shown', {});
  }
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
  // UNE SEULE donnée feu : un événement satellite déjà rattaché à un
  // signalement citoyen corroboré (< 2 km) n'affiche pas de second marqueur —
  // le signalement principal porte les deux sources.
  const corrobFires = incidents.filter((i) => i.type === 'fire'
    && i.status === 'active' && i.satellite_last_seen);
  return satEvents.filter((e) => Date.parse(e.last_detected_at) >= cutoff)
    .filter((e) => !corrobFires.some((i) =>
      map.distance([i.lat, i.lng], [e.lat, e.lng]) < 2000));
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
    // « Depuis votre dernière visite » : une seule vérification par session.
    if (!sinceChecked) { sinceChecked = true; sinceLastVisit().catch(() => {}); }
    // Bannière de proximité feu (< 10 km et < 3 h) — refermable, jamais répétée.
    try {
      maybeShowFireProximityBanner(
        citizenVisible() ? incidents.filter((i) => i.status === 'active') : [], visibleSats());
    } catch { /* jamais bloquant */ }
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
  if (!window.__lsdSent && !degraded) {
    window.__lsdSent = true;
    window.track?.('local_situation_displayed', {});
  }
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
  // Feux = UNE donnée : signalements citoyens + événements satellite réunis
  // dans le même compte (dédupliqués), la part satellite précisée à part.
  if (satsShown.length) byType.fire = (byType.fire || 0) + satsShown.length;
  const typeParts = Object.entries(byType).map(([ty, n]) => `${TYPE_ICONS[ty]} ${n}`);
  // Incidents terminés récents affichés (grisés) : comptés à part, jamais
  // mélangés au chiffre principal « en cours ».
  const ended = citizenVisible() ? incidents.filter((i) => i.status !== 'active').length : 0;
  let mainLine;
  // Mode Feux : l'absence de détection ne prouve JAMAIS l'absence de feu —
  // formulation honnête + rappel des limites satellite.
  const fireEmptyMode = fireFilterActive() && active.length === 0 && satsShown.length === 0;
  // Le titre parle toujours en INCIDENTS (la notion que les gens cherchent) ;
  // les détections satellite sont une ligne secondaire, jamais le titre.
  if (fireEmptyMode) mainLine = t('fire_none');
  else if (active.length > 0) mainLine = active.length === 1 ? t('counter_one') : t('counter_n', { n: active.length });
  else mainLine = t('counter_none');

  const fz = currentFollowedZone?.() || null;
  // ── Carte « campagne » : pastille + titre + flèche, puis détails, puis la
  // rangée Vent · Température · Humidité (le langage exact du marketing).
  const nearest = currentCountry() === 'FR' ? nearestFire(active, satsShown) : null;
  const heroFire = nearest && nearest.d < 50_000 ? nearest : null;
  const heroTitle = heroFire
    ? t(heroFire.d < 10_000 ? 'hero_fire_near' : 'hero_fire_nearest')
    : mainLine;
  const heroSub = heroFire
    ? t('hero_km_dir', { km: Math.max(1, Math.round(heroFire.d / 1000)), dir: heroFire.dir })
    : `📍 ${where}`;
  // Pastille d'état « l'icône qu'il faut » : flamme rouge (feu proche),
  // alerte marine (incidents en cours), coche verte (rien à signaler).
  const flameSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3-1 4.5-2.2 6C8.4 10.8 8 12.2 8 13.5a4.5 4.5 0 0 0 9 0c0-1.1-.3-2.1-1-3.2-.5 1-1.2 1.6-2 1.9.6-2.4-.2-5.6-2-9.2Z" fill="currentColor"/></svg>';
  const alertSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 20h18.4L12 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M12 10.2v4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor"/></svg>';
  const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="m8 12.3 2.7 2.7L16 9.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
  const heroBadgeClass = heroFire ? ' hero-badge-fire' : (active.length ? ' hero-badge-alert' : ' hero-badge-ok');
  const heroSvg = heroFire ? flameSvg : (active.length ? alertSvg : checkSvg);
  // Statistiques locales (France) : mêmes données que la fiche conditions.
  const h = fireSit?.heat, w = fireSit?.wind && !fireSit.wind.stale ? fireSit.wind : null;
  const stats = [];
  if (w) stats.push({ l: t('stat_wind'), v: `${w.speedKmh} km/h` });
  if (h) stats.push({ l: t('stat_temp'), v: `${h.tempC} °C` });
  if (h?.humidityPct != null) stats.push({ l: t('stat_hum'), v: `${h.humidityPct} %` });
  // Puce compacte desktop (le héro permanent disparaît en mode rail ≥1200 px).
  const chip = document.getElementById('situChip');
  if (chip) {
    const chipState = heroFire ? '🔥' : (active.length ? `⚠ ${active.length}` : '✓');
    chip.innerHTML = `<strong>${esc(t('nav_situation'))}</strong> · ${chipState}${satsShown.length ? ` · 🛰️ ${satsShown.length}` : ''}${snapshotAt ? ` · <span class="muted">${esc(timeAgo(new Date(snapshotAt).toISOString()))}</span>` : ''}`;
  }
  let heroCollapsed = false;
  try { heroCollapsed = localStorage.getItem('kifeh_hero_collapsed') === '1'; } catch {}
  counter.classList.toggle('hero-collapsed', heroCollapsed);
  const heroToggle = `<button type="button" class="hero-toggle" id="heroToggle"
      aria-expanded="${heroCollapsed ? 'false' : 'true'}"
      aria-label="${esc(t(heroCollapsed ? 'hero_expand' : 'hero_collapse'))}">
      <svg viewBox="0 0 24 24" aria-hidden="true" style="${heroCollapsed ? 'transform:scaleY(-1)' : ''}"><path d="m6 9.5 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>`;
  counter.innerHTML = `
    <span class="hero-head" id="heroHead">
      <span class="hero-open" id="heroOpen" role="button" tabindex="0" aria-haspopup="dialog">
        <span class="hero-badge${heroBadgeClass}" aria-hidden="true">${heroSvg}</span>
        <span class="hero-txt">
          <strong>${heroTitle}</strong>
          <span class="muted small">${esc(heroSub)}</span>
        </span>
        <span class="hero-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h13m-5.5-5.5L18 12l-5.5 5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>
      </span>
      ${heroToggle}
    </span>
    ${heroFire ? `<span class="summary-where muted small">📍 ${esc(where)}</span>` : ''}
    ${satsShown.length && !active.some((i) => i.type === 'fire') ? `<span class="summary-types">🛰️ ${t('summary_sat_n', { n: satsShown.length })}</span>` : ''}
    ${active.length > 0 && typeParts.length ? `<span class="summary-types">${typeParts.join(' · ')}</span>` : ''}
    ${ended > 0 ? `<span class="summary-types">✓ ${ended === 1 ? t('summary_ended_one') : t('summary_ended_n', { n: ended })}</span>` : ''}
    ${satsShown.length && active.some((i) => i.type === 'fire') ? `<span class="summary-sat muted small">${t('fire_sat_part', { n: satsShown.length })}</span>` : ''}
    ${fireSit?.latestOfficialAt && fireSit.safetyActive ? `<span class="summary-types summary-official-active">🏛️ ${esc(t('fs_latest_official', { t: timeAgo(fireSit.latestOfficialAt) }))}</span>` : ''}
    ${fireEmptyMode ? `<span class="summary-types muted">${esc(t('fire_none_note'))}</span>` : ''}
    <span class="summary-actions">${condLineHtml()}<span id="followZoneCta" class="summary-types vig-line${fz ? ' followed' : ''}" role="button" tabindex="0" aria-haspopup="dialog">${fz ? `★ ${esc(t('zone_followed_short'))}` : `☆ ${esc(t('follow_zone_btn'))}`} ›</span></span>
    ${stats.length >= 2 ? `<span class="hero-stats" id="heroStats" role="button" tabindex="0">${stats.map((s) =>
    `<span class="stat"><span class="stat-l">${esc(s.l)}</span><span class="stat-v">${esc(s.v)}</span></span>`).join('')}</span>` : ''}
    ${degraded ? `<span class="summary-degraded">${t('api_degraded')}<br>${t('offline_snapshot', { t: timeAgo(new Date(snapshotAt).toISOString()) })}</span>` : ''}`;
  // Repli/dépli : mémorisé, sans jamais voler le clic d'ouverture de Situation.
  document.getElementById('heroToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !heroCollapsed;
    try { localStorage.setItem('kifeh_hero_collapsed', on ? '1' : '0'); } catch {}
    window.track?.('hero_card_toggled', { collapsed: on });
    renderSummary(false, snapshotAt);
  });
}
// « Plus proche : ~N km » — distance du feu le plus proche (signalement citoyen
// actif ou événement satellite) depuis la position de la personne si connue,
// sinon depuis le centre de la vue. Réponse immédiate à LA question B2C :
// « à quelle distance ? ». Jamais de fausse précision (~, arrondi).
function clientBearingDeg(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
// Événement feu le plus proche (réponse à « où et à quelle distance ? »).
// Distance à vol d'oiseau, jamais présentée comme un trajet. Renvoie aussi
// l'élément pour la bannière de proximité.
function nearestFire(active, satsShown) {
  const from = userPos ? L.latLng(userPos.lat, userPos.lng) : map.getCenter();
  let best = null;
  for (const i of active) {
    if (i.type !== 'fire') continue;
    const d = map.distance(from, L.latLng(i.lat, i.lng));
    if (!best || d < best.d) best = { d, item: i, lat: i.lat, lng: i.lng, sat: false };
  }
  for (const s of satsShown) {
    const lat = s.centroid_lat ?? s.lat, lng = s.centroid_lng ?? s.lng;
    const d = map.distance(from, L.latLng(lat, lng));
    if (!best || d < best.d) best = { d, item: s, lat, lng, sat: true };
  }
  if (best) best.dir = windDirName(clientBearingDeg({ lat: from.lat, lng: from.lng }, best));
  return best;
}
function nearestFireLineHtml(active, satsShown) {
  if (currentCountry() !== 'FR') return '';
  const n = nearestFire(active, satsShown);
  if (!n) return '';
  const km = n.d / 1000;
  const label = km < 1 ? t('nearest_fire_close')
    : t('nearest_fire_km_dir', { km: Math.round(km), dir: n.dir });
  return `<span class="summary-types">📍 ${esc(label)}</span>`;
}

// Bannière de proximité « Situation incendie » : UNIQUEMENT quand un feu
// récent est vraiment proche (< 10 km) — jamais d'interface anxiogène pour un
// événement lointain ou ancien. Refermable, une seule fois par événement.
function maybeShowFireProximityBanner(active, satsShown) {
  if (currentCountry() !== 'FR') return;
  const n = nearestFire(active, satsShown);
  if (!n || n.d > 10_000) return;
  const freshAt = n.sat ? n.item.last_detected_at : n.item.updated_at || n.item.started_at;
  if (!freshAt || Date.now() - Date.parse(freshAt) > 3 * 3600_000) return; // > 3 h : pas d'urgence affichée
  const key = `kifeh_fireban_${n.sat ? n.item.id : n.item.public_id}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch {}
  const km = Math.max(1, Math.round(n.d / 1000));
  const b = document.createElement('div');
  b.className = 'since-banner fire-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `
    <button class="since-close" aria-label="✕">✕</button>
    <strong>🔥 ${esc(n.sat ? t('fireban_sat_title') : t('fireban_title'))}</strong>
    <div class="since-line">${esc(t('nearest_fire_km_dir', { km, dir: n.dir }))} · ${esc(timeAgo(freshAt))}</div>
    <div class="since-line"><u>${esc(t('fireban_see'))}</u></div>`;
  document.body.appendChild(b);
  b.addEventListener('click', (e) => {
    if (e.target.closest('.since-close')) { b.remove(); return; }
    b.remove();
    if (n.sat) openSatDetail(n.item.id); else openDetail(n.item.public_id);
  });
  setTimeout(() => b.remove(), 45_000);
  window.track?.('fire_proximity_banner', { sat: n.sat });
}

// Ligne « conditions » COMPACTE (France) : chaleur + vent + vigilance réunis
// sur une seule ligne tappable — les détails vivent dans la fiche dédiée,
// jamais empilés dans la bulle de résumé (lisibilité mobile d'abord).
function condLineHtml() {
  // La météo vit dans la carte-résumé et la fiche Conditions —
  // la bulle ne garde que l'état Vigilance (pas de doublon).
  if (!fireSit?.vigilance) return '';
  const alert = fireSit.vigilance.activeDepartments > 0;
  const label = alert ? `🟠 ${esc(t('fs_vigilance_active', { n: fireSit.vigilance.activeDepartments }))}`
    : `🟢 ${esc(t('fs_vigilance_none'))}`;
  return `<span id="condLine" class="summary-types vig-line${alert ? ' summary-official-active vig-active' : ''}"
    role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(t('cond_title'))}">${label} ›</span>`;
}

// Le résumé ouvre la liste correspondante (même jeu de données) ; la ligne
// « conditions » ouvre sa fiche dédiée (clavier : Entrée ou Espace).
document.getElementById('counter').addEventListener('click', (e) => {
  if (e.target.closest('#condLine') || e.target.closest('#heroStats')) { openVigilanceSheet(); return; }
  if (e.target.closest('#followZoneCta')) { openFollowSheet(); return; }
  if (e.target.closest('#heroOpen')) {
    // La flèche de la carte « campagne » ouvre le panneau Situation.
    // (a11y 4.1.2 : #heroOpen porte seul le rôle bouton — le chevron de repli
    // est un bouton FRÈRE, plus jamais imbriqué dans un élément focusable.)
    renderSituationHub(); openSheet('situationSheet'); setNavCurrent('navSituation');
    return;
  }
  renderList(); openSheet('listSheet');
});
document.getElementById('counter').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('#condLine') || e.target.closest('#heroStats')) { e.preventDefault(); openVigilanceSheet(); }
  else if (e.target.closest('#followZoneCta')) { e.preventDefault(); openFollowSheet(); }
  else if (e.target.closest('#heroOpen')) {
    e.preventDefault();
    renderSituationHub(); openSheet('situationSheet'); setNavCurrent('navSituation');
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Navigation principale FIXE : Carte · Situation · Signaler · Suivis · Aide.
// Cinq destinations toujours visibles (fini la rangée défilante qui cachait
// des fonctions) ; « Ma position » et « Couches » deviennent des boutons
// flottants SUR la carte — des actions de carte, pas des destinations.
// ═════════════════════════════════════════════════════════════════════════════
function setNavCurrent(id) {
  ['navMap', 'navSituation', 'navAide'].forEach((b) => {
    const el = document.getElementById(b);
    if (el) {
      if (b === id) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
  });
}
document.getElementById('navMap')?.addEventListener('click', () => {
  closeSheets(); setNavCurrent('navMap'); window.track?.('nav_map', {});
});
document.getElementById('navSituation')?.addEventListener('click', () => {
  renderSituationHub(); openSheet('situationSheet'); setNavCurrent('navSituation');
  window.track?.('nav_situation', {});
});
document.getElementById('navAide')?.addEventListener('click', () => {
  renderAide(); openSheet('aideSheet'); setNavCurrent('navAide'); window.track?.('nav_aide', {});
});
document.getElementById('btnLayers')?.addEventListener('click', () => {
  renderLayerSources();
  openSheet('layersSheet'); window.track?.('layers_opened', {});
});

// Calques v2 (maquette A) : chaque couche affiche SA source, l'heure de SA
// dernière mise à jour ET un voyant de fraîcheur typé (seuils par source,
// alignés sur sourceFreshness côté serveur). Une donnée sans source ni
// horodatage n'a pas sa place sur la carte.
const LAYER_FRESH_H = { sat: [3, 8], burnt: [26, 50], wx: [1.5, 3], roads: [2, 6] };
function freshClass(kind, iso) {
  if (!iso) return '';
  const ageH = (Date.now() - Date.parse(iso)) / 3600_000;
  const [f, d] = LAYER_FRESH_H[kind] || [3, 8];
  return ageH < f ? 'fresh' : ageH < d ? 'delayed' : 'stale';
}
function renderLayerSources() {
  const set = (id, kind, source, iso) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!source) { el.hidden = true; return; }
    el.hidden = false;
    const cls = freshClass(kind, iso);
    const label = cls ? (t(`lay_${cls}`) || cls) : '';
    el.innerHTML = `<span class="fresh-dot ${cls}" title="${esc(label)}" aria-hidden="true"></span>`
      + `${esc(source)}${iso ? ` · ${esc(fmtDate(iso))}` : ''}`
      + (cls && cls !== 'fresh' ? ` <span class="muted">(${esc(label)})</span>` : '');
  };
  set('srcSat', 'sat', 'NASA FIRMS', satLastSync || null);
  set('srcWx', 'wx', document.getElementById('wxRow')?.hidden ? '' : 'Météo-France · Open-Meteo', window._lastWxAt || null);
  set('srcRoads', 'roads', document.getElementById('fRoadsRow')?.hidden ? '' : 'Bison Futé — DIR', window._lastRoadsAt || null);
  set('srcBurnt', 'burnt', document.getElementById('fBurntRow')?.hidden ? '' : 'Copernicus EFFIS', window._lastBurntAt || null);
  // Titres de groupes : visibles seulement si le territoire possède la couche.
  for (const [grp, row] of [['grpBurnt', 'fBurntRow'], ['grpWx', 'wxRow'], ['grpRoads', 'fRoadsRow']]) {
    const g = document.getElementById(grp);
    if (g) g.hidden = document.getElementById(row)?.hidden !== false;
  }
}
// Zoom dans la pile flottante : une seule grappe de commandes de carte,
// miroitée automatiquement en arabe (inset-inline-end).
document.getElementById('fabZoomIn')?.addEventListener('click', () => map.zoomIn());
document.getElementById('fabZoomOut')?.addEventListener('click', () => map.zoomOut());
// ── PWA : enregistrement du service worker (cache du shell + push) et
// proposition d'installation DISCRÈTE — jamais à la première visite.
(function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  let visits = 0;
  try {
    visits = Number(localStorage.getItem('kifeh_visits') || 0) + 1;
    localStorage.setItem('kifeh_visits', String(visits));
  } catch {}
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    let dismissed = false, eligible = visits >= 2;
    try {
      dismissed = localStorage.getItem('kifeh_install_dismissed') === '1';
      // Contextuelle (addendum growth) : 2e visite OU zone suivie OU arrivée
      // depuis une alerte — jamais une invite à froid dès la première visite.
      eligible = eligible || localStorage.getItem('kifeh_pwa_eligible') === '1';
    } catch {}
    if (!eligible || dismissed || window.matchMedia('(display-mode: standalone)').matches) return;
    const b = document.createElement('div');
    b.className = 'since-banner install-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = `
      <button class="since-close" aria-label="✕">✕</button>
      <strong>📲 ${esc(t('install_title'))}</strong>
      <div class="since-line">${esc(t('install_body'))}</div>
      <div class="row" style="gap:.4rem;margin-top:.4rem">
        <button class="btn small-btn" id="installGo" type="button">${esc(t('install_btn'))}</button>
      </div>`;
    document.body.appendChild(b);
    const dismiss = () => {
      b.remove();
      try { localStorage.setItem('kifeh_install_dismissed', '1'); } catch {}
    };
    b.querySelector('.since-close').addEventListener('click', dismiss);
    b.querySelector('#installGo').addEventListener('click', async () => {
      b.remove();
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        window.track?.('pwa_install_choice', { outcome });
        if (outcome === 'accepted') window.track?.('pwa_installed', { via: 'banner' });
        if (outcome !== 'accepted') localStorage.setItem('kifeh_install_dismissed', '1');
      } catch {}
    });
    setTimeout(() => { if (b.isConnected) dismiss(); }, 30_000);
    window.track?.('pwa_install_banner', {});
  });
})();

// La marque ramène à la vue d'ensemble du pays (repère universel « accueil »).
document.getElementById('brandHome')?.addEventListener('click', () => {
  const p = countryProfile();
  closeSheets();
  map.setView(p.map.defaultCenter, p.map.defaultZoom);
  window.track?.('brand_home', {});
});

// « Situation autour de vous » — le hub qui répond, dans l'ordre, à : que se
// passe-t-il ? suis-je concerné(e) ? que puis-je faire ? Données déjà
// chargées uniquement (aucun appel réseau bloquant). La version panneau
// enrichie arrive avec la refonte dédiée.
// « Depuis votre dernière visite » — une raison HONNÊTE de revenir : le
// delta RÉEL de signalements publiés depuis (API publishedSince), jamais un
// compteur gonflé ni une urgence fabriquée. Silencieux en cas d'échec.
let slv = null; // { sinceH, count } — calculé une fois par chargement
(async function initSinceLastVisit() {
  let last = null;
  try { last = localStorage.getItem('kifeh_last_visit_at'); } catch {}
  try { localStorage.setItem('kifeh_last_visit_at', new Date().toISOString()); } catch {}
  // Consultation d'une alerte (lien push/e-mail) → l'invite d'installation
  // devient pertinente (jamais à la première arrivée à froid).
  try {
    const sp = new URLSearchParams(location.search);
    if (['push', 'email', 'digest'].includes(sp.get('src'))) {
      localStorage.setItem('kifeh_pwa_eligible', '1');
    }
  } catch {}
  if (!last) return;
  const ageH = (Date.now() - Date.parse(last)) / 3600_000;
  if (!(ageH >= 3 && ageH <= 45 * 24)) return; // ni bruit, ni archéologie
  try {
    const r = await API.get(`/api/public/incidents?publishedSince=${encodeURIComponent(last)}&country=${currentCountry()}`);
    slv = { sinceH: Math.round(ageH), count: Number(r.count) || 0 };
    window.track?.('since_last_visit_displayed', { has_news: slv.count > 0 });
    renderSituationHub();
  } catch { /* le panneau vit très bien sans ce bloc */ }
})();

function renderSituationHub() {
  const el = document.getElementById('situationBody');
  if (!el) return;
  const active = citizenVisible() ? incidents.filter((i) => i.status === 'active') : [];
  const sats = visibleSats();
  let snapAt = null;
  try { snapAt = JSON.parse(localStorage.getItem('kifeh_snapshot') || 'null')?.at || null; } catch {}
  const calm = !active.length && !sats.length;
  const fz = currentFollowedZone?.() || null;
  let mainLine = '';
  if (active.length) mainLine = active.length === 1 ? t('counter_one') : t('counter_n', { n: active.length });
  if (sats.length) mainLine += `${mainLine ? ' · ' : ''}🛰️ ${t('summary_sat_n', { n: sats.length })}`;
  // Vigilance : même information que la bulle, identifiant DISTINCT (jamais
  // deux fois le même id dans le document).
  let vigLine = '';
  if (fireSit?.vigilance) {
    const alert = fireSit.vigilance.activeDepartments > 0;
    vigLine = `<button class="btn secondary small-btn" id="situCond">${alert
      ? `🟠 ${esc(t('fs_vigilance_active', { n: fireSit.vigilance.activeDepartments }))}`
      : `🟢 ${esc(t('fs_vigilance_none'))}`} ›</button>`;
  }
  // Météo locale (France) : mêmes données que le bandeau, avec source + heure.
  let wxLine = '';
  if (fireSit?.heat || fireSit?.wind) {
    const h = fireSit.heat, w = fireSit.wind && !fireSit.wind.stale ? fireSit.wind : null;
    const air = fireSit.air;
    wxLine = `<p class="small" id="situWx" role="button" tabindex="0">
      ${h ? `🌡️ <strong>${esc(String(h.tempC))}°</strong>` : ''}
      ${h?.humidityPct != null ? ` · 💧 ${esc(String(h.humidityPct))} %` : ''}
      ${w ? ` · <span class="wx-s-arrow" style="display:inline-block;transform:rotate(${((Number(w.directionToDeg) || 0) - 90 + 360) % 360}deg)">➤</span> ${esc(String(w.speedKmh))} km/h${w.gustsKmh ? ` (${esc(String(w.gustsKmh))})` : ''}` : ''}
      ${air ? ` · 🫁 ${esc(t('air_pm25', { n: air.pm25 }))}${air.eaqi != null ? ` (${esc(airQualityLabel(air.eaqi))})` : ''}` : ''} ›
      <br><span class="muted">${esc(t('wx_legend_at', { t: fmtDate((h || w).observedAt || new Date().toISOString()) }))}</span></p>`;
  }
  // « En bref — situation feu » : réuni quand le filtre 🔥 est actif ou qu'un
  // feu récent est proche (< 15 km). Que se passe-t-il, à quelle distance,
  // quelle origine, quel vent, quelle information officielle — SANS jamais
  // de prévision de propagation ni d'heure d'arrivée estimée.
  let fireBrief = '';
  const nearest = nearestFire(active, sats);
  let fireModeOn = false;
  try { fireModeOn = fireFilterActive() || (nearest && nearest.d < 15_000); } catch {}
  if (currentCountry() === 'FR' && fireModeOn && nearest) {
    const freshAt = nearest.sat ? nearest.item.last_detected_at
      : (nearest.item.updated_at || nearest.item.started_at);
    const origin = nearest.sat ? t('origin_sat')
      : (nearest.item.satellite_last_seen ? t('origin_corr') : t('origin_cit'));
    const km = Math.max(1, Math.round(nearest.d / 1000));
    fireBrief = `
    <div class="card fire-brief">
      <p class="small" style="margin:0 0 .25rem"><strong>🔥 ${esc(t('fire_brief_title'))}</strong></p>
      <p class="small" style="margin:.1rem 0">📍 ${esc(t('nearest_fire_km_dir', { km, dir: nearest.dir }))}</p>
      ${freshAt ? `<p class="small muted" style="margin:.1rem 0">${esc(t('fire_brief_seen', { t: timeAgo(freshAt) }))} · ${esc(origin)}</p>` : ''}
      ${fireSit?.official?.length
      ? `<p class="small" style="margin:.1rem 0">${esc(t('fire_brief_official_yes'))}</p>`
      : `<p class="small muted" style="margin:.1rem 0">${esc(t('fire_brief_official_no'))}</p>`}
      <div class="row" style="gap:.4rem;margin-top:.4rem">
        <button class="btn secondary small-btn" id="fireBriefSee" type="button">${esc(t('suivis_see'))}</button>
        <a class="btn secondary small-btn" href="declare.html?type=fire">${esc(t('fire_brief_declare'))}</a>
      </div>
    </div>`;
  }
  // Bloc « Depuis votre dernière visite » (delta réel, état vide honnête).
  const zonesCount = (() => { try { return (JSON.parse(localStorage.getItem('kifeh_zones') || '[]') || []).length; } catch { return 0; } })();
  const slvHtml = !slv ? '' : `
    <div class="card" id="slvBlock">
      <p class="small" style="margin:0 0 .25rem"><strong>🕐 ${esc(t('slv_title'))}</strong></p>
      <p class="small" style="margin:.1rem 0">${slv.count === 0 ? esc(t('slv_none'))
    : esc(slv.count === 1 ? t('slv_inc_one') : t('slv_inc_n', { n: slv.count }))}</p>
      ${zonesCount ? `<button class="btn ghost small-btn" id="slvZones">★ ${esc(t('slv_see_zones'))} ›</button>` : ''}
    </div>`;
  el.innerHTML = `
    ${slvHtml}
    ${calm
    ? `<p><strong>${esc(t('situation_calm'))}</strong></p>
       <p class="muted small">${esc(t('situation_calm_note'))}</p>
       <a class="btn secondary small-btn" href="declare.html">${esc(t('declare_btn'))}</a>`
    : `<p><strong>${mainLine}</strong></p>${nearestFireLineHtml(active, sats)}`}
    ${fireBrief}
    ${wxLine}
    <div class="detail-links">
      ${vigLine}
      <button class="btn secondary small-btn" id="situFollow">${fz
    ? `★ ${esc(t('zone_followed_short'))}` : `☆ ${esc(t('follow_zone_btn'))}`} ›</button>
    </div>
    <div id="fcBlock"></div>
    ${snapAt ? `<p class="muted small">${esc(t('situation_updated', { t: timeAgo(new Date(snapAt).toISOString()) }))}</p>` : ''}`;
  el.querySelector('#slvZones')?.addEventListener('click', () => { renderSuivis(); openSheet('suivisSheet'); setNavCurrent('navSuivis'); });
  fillForecastBlock(el);
  el.querySelector('#situCond')?.addEventListener('click', openVigilanceSheet);
  el.querySelector('#situWx')?.addEventListener('click', openVigilanceSheet);
  el.querySelector('#situFollow')?.addEventListener('click', openFollowSheet);
  el.querySelector('#fireBriefSee')?.addEventListener('click', () => {
    closeSheets();
    map.setView([nearest.lat, nearest.lng], Math.max(map.getZoom(), 11));
    if (nearest.sat) openSatDetail(nearest.item.id); else openDetail(nearest.item.public_id);
  });
}

// « Conditions favorisant les feux » — 3 jours dans la Situation (master
// prévisions §4) : facteurs + synthèse déterministe + disclaimer — JAMAIS un
// niveau inventé ni un feu prédit. Silencieux quand la capacité est éteinte.
async function fillForecastBlock(root) {
  const host = root.querySelector('#fcBlock');
  if (!host) return;
  const now = Date.now();
  if (!window.__fc || now - window.__fc.at > 5 * 60_000) {
    try {
      const c = map.getCenter();
      window.__fc = { at: now, data: await API.get(
        `/api/fire/forecast?lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}&country=${currentCountry()}`) };
    } catch { window.__fc = { at: now, data: null }; }
  }
  const d = window.__fc.data;
  if (!d?.enabled || !d.available || !d.days?.length) return; // jamais un contrôle cassé
  if (!window.__fcTracked) { window.__fcTracked = true; window.track?.('fire_forecast_opened', {}); }
  const dayFmt = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-TN' : 'fr-FR', { weekday: 'short' });
  const dn = (day, i) => (i === 0 ? t('fc_today') : dayFmt.format(new Date(`${day.date}T12:00:00Z`)));
  const strip = d.days.slice(0, 3).map((day, i) => `
    <span class="fc-day">
      <span class="fc-d">${esc(dn(day, i))}</span>
      <span class="fc-v">${day.tMaxC != null ? `${Math.round(day.tMaxC)}°` : '—'}</span>
      <span class="fc-m">${day.gustsMaxKmh != null ? `${esc(t('fc_gusts'))} <span dir="ltr">${Math.round(day.gustsMaxKmh)}</span>` : ''}</span>
      <span class="fc-m">${day.rhMinPct != null ? `${esc(t('fc_hum'))} <span dir="ltr">${Math.round(day.rhMinPct)}%</span>` : ''}</span>
    </span>`).join('');
  const rows7 = d.days.map((day, i) => `
    <p class="small" style="margin:.15rem 0;display:flex;justify-content:space-between;gap:.5rem">
      <span>${esc(dn(day, i))}${day.confidence === 'trend' ? ` <span class="muted">(${esc(t('fc_trend'))})</span>` : ''}</span>
      <span dir="ltr">${day.tMaxC != null ? `${Math.round(day.tMaxC)}°` : '—'} · ${day.gustsMaxKmh != null ? `${Math.round(day.gustsMaxKmh)} km/h` : '—'} · ${day.rhMinPct != null ? `${Math.round(day.rhMinPct)}%` : '—'}${day.precipMm ? ` · ${day.precipMm} mm` : ''}</span>
    </p>`).join('');
  host.innerHTML = `
    <div class="card fc-card">
      <p class="small" style="margin:0 0 .35rem"><strong>🌡️ ${esc(t('fc_title'))}</strong></p>
      <div class="fc-strip">${strip}</div>
      ${d.summary ? `<p class="small" style="margin:.5rem 0 .25rem">${esc(d.summary)}</p>` : ''}
      <details>
        <summary class="small" style="cursor:pointer">${esc(t('fc_7d'))}</summary>
        ${rows7}
      </details>
      <p class="muted small" style="margin:.4rem 0 0">${esc(d.disclaimer || '')}<br>
      ${esc(t('fc_src', { s: d.modelLabel || d.provider }))}${d.stale ? ' · ⏳' : ''}</p>
    </div>`;
  host.querySelector('details')?.addEventListener('toggle', (e) => {
    if (e.currentTarget.open) window.track?.('fire_forecast_7d_opened', {});
  });
}

// « Aide » — urgences d'abord (avec l'honnêteté habituelle : Kifeh n'appelle
// jamais les secours à votre place), puis comprendre, régler, légal.
function renderAide() {
  const el = document.getElementById('aideBody');
  if (!el) return;
  el.innerHTML = `
    <div class="follow-list">
      <button class="btn safety-btn" id="aideEmergency">🚨 ${esc(t('aide_emergency'))}</button>
      <p class="muted small">${esc(t('aide_emergency_note'))}</p>
      <a class="btn secondary" href="a-propos.html">💡 ${esc(t('aide_how'))}</a>
      <a class="btn secondary" href="faq.html">❓ ${esc(t('aide_faq'))}</a>
      <button class="btn secondary" id="aideCountry">${esc(countryProfile().flag)} ${esc(t('aide_country'))}</button>
      <button class="btn secondary" id="aideLang">🌐 ${esc(t('aide_lang'))} <bdi>(${LANG === 'ar' ? 'Français' : 'العربية'})</bdi></button>
      <button class="btn secondary" id="aideLite">🌿 ${esc(t('aide_lite'))}</button>
      <a class="btn secondary" href="legal.html">ⓘ ${esc(t('aide_legal'))}</a>
    </div>`;
  el.querySelector('#aideEmergency')?.addEventListener('click', () => {
    const ctx = { active: true, show: true };
    document.getElementById('detailContent').innerHTML = '';
    document.getElementById('safetySheetBody').innerHTML = '<div id="safetyZone"></div>';
    document.getElementById('safetyCtxLine').textContent = t('safety_ctx_zone');
    openSheet('safetySheet');
    renderSafetyCard(ctx);
    renderSafetyHelp(ctx);
  });
  el.querySelector('#aideCountry')?.addEventListener('click', () => openSheet('countrySheet'));
  el.querySelector('#aideLang')?.addEventListener('click', () => setLang(LANG === 'ar' ? 'fr' : 'ar'));
  // Kifeh Léger vit avec les couches/performances (feuille des couches).
  el.querySelector('#aideLite')?.addEventListener('click', () => openSheet('filterSheet'));
}

// Heure locale (fuseau du pays consulté) d'un horodatage — ex. « 16 h ».
function heatHourLabel(iso) {
  if (!iso) return '';
  try {
    const p = COUNTRY_PROFILES[currentCountry()];
    const h = new Date(iso).toLocaleTimeString(LANG === 'ar' ? 'ar-TN' : 'fr-FR',
      { hour: 'numeric', timeZone: p.timezone });
    return h.replace(':00', '').trim();
  } catch { return ''; }
}

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
  // Chaque source dégrade INDÉPENDAMMENT : chaleur et vent restent affichés
  // même si la veille Vigilance n'est pas disponible (et réciproquement).
  const monitored = Boolean(v?.enabled && v.monitored);
  const alerts = monitored ? v.alerts : [];
  window.track?.('vigilance_sheet_opened', { alerts: alerts.length, monitored });
  const h = fireSit?.heat;
  const w = fireSit?.wind && !fireSit.wind.stale ? fireSit.wind : null;
  const local = (h || w) ? `
    ${weatherTilesHtml(h, w)}
    <hr style="border:none;border-top:1px solid var(--border,#e5e0d8);margin:.75rem 0">` : '';
  const head = `<h2>${alerts.length ? '🟠' : '🟢'} ${esc(t('cond_title'))}</h2>${local}`
    + (!monitored ? `<p class="muted small">${esc(t('vig_unavailable'))}</p>`
      : alerts.length
        ? `<p><strong>${esc(t('fs_vigilance_active', { n: alerts.length }))}</strong></p>`
        : `<p><strong>${esc(t('fs_vigilance_none'))}</strong></p>
           <p class="muted">${esc(t('vig_explainer'))}</p>`);
  // §10 master UX : la zone CONSULTÉE d'abord — jamais les 22 départements
  // imposés. Local = ≤ 150 km du centre de la carte ; le reste du pays se
  // déplie à la demande (élément natif, accessible).
  const center = map.getCenter();
  const isLocal = (a) => a.lat != null && a.lng != null
    && map.distance([center.lat, center.lng], [a.lat, a.lng]) / 1000 <= 150;
  const localAlerts = alerts.filter(isLocal);
  const restAlerts = alerts.filter((a) => !isLocal(a));
  const card = (a) => {
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
  };
  const cards = !alerts.length ? '' : `
    ${localAlerts.length
    ? `<p class="small muted" style="margin:.5rem 0 .25rem"><strong>${esc(t('vig_local_title'))}</strong></p>${localAlerts.map(card).join('')}`
    : `<p class="muted small">${esc(t('vig_none_local'))}</p>`}
    ${restAlerts.length ? `
    <details style="margin:.5rem 0">
      <summary class="small" style="cursor:pointer">${esc(t('vig_rest_toggle', { n: restAlerts.length }))}</summary>
      ${restAlerts.map(card).join('')}
    </details>` : ''}`;
  el.innerHTML = `${head}${cards}
    ${alerts.length ? `<p class="muted small">${esc(t('fs_fr_alert_note'))}</p>` : ''}
    <p><a href="https://vigilance.meteofrance.fr" target="_blank" rel="noopener">${esc(t('vig_official_map'))} ↗</a></p>
    ${monitored && v.checkedAt ? `<p class="muted small">${esc(t('vig_checked_at', { t: fmtDate(v.checkedAt) }))}</p>` : ''}
    <button class="btn secondary" id="vigAlertsBtn" type="button">🔔 ${esc(t('vig_enable_alerts'))}</button>
    <button class="btn ghost small-btn" id="vigFollowZone" type="button">☆ ${esc(t('follow_zone_btn'))}</button>`;
  document.getElementById('vigAlertsBtn')?.addEventListener('click', () => openFollowSheet());
  document.getElementById('vigFollowZone')?.addEventListener('click', () => openFollowSheet());
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
  const deepLink = location.search.includes('incident=') || location.search.includes('confirm=');
  // Mode léger : l'information d'abord — la liste s'ouvre avant la carte.
  if (LITE && !deepLink) {
    renderList();
    openSheet('listSheet');
    return;
  }
  // Vue mémorisée : qui quitte Kifeh en mode liste retrouve la liste.
  let savedView = null;
  try { savedView = localStorage.getItem('kifeh_view'); } catch {}
  if (savedView === 'list' && !deepLink) { renderList(); openSheet('listSheet'); }
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
// « Suivi en direct » : la fiche OUVERTE se rafraîchit d'elle-même quand
// l'incident change (confirmation, fin, réouverture…) — sans rechargement
// manuel, uniquement sur changement réel (jamais de polling).
let openIncidentId = null;
try {
  const es = new EventSource(`${API_BASE}/api/events`);
  es.addEventListener('incident', (ev) => {
    scheduleRefresh(500);
    try {
      const d = JSON.parse(ev.data || '{}');
      if (d.publicId && d.publicId === openIncidentId
          && document.getElementById('detailSheet').classList.contains('open')) {
        openDetail(d.publicId);
      }
    } catch { /* données d'événement absentes : simple rafraîchissement carte */ }
  });
} catch { /* repli : rechargement au déplacement de carte */ }

// --- Géolocalisation (consentement explicite : uniquement sur action) -------
// Bannière non bloquante (jamais d'alert() qui gèle la page) ; précision
// standard suffisante pour centrer la carte — la haute précision GPS
// consomme inutilement la batterie. Accessible depuis le bouton « Ma
// position » ET le pin 📍 de la barre de recherche.
function locateMe() {
  if (!navigator.geolocation) return transientBanner(t('geo_unavailable'));
  window.track?.('location_requested', {});
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userPos.lat, userPos.lng], 14);
      L.circleMarker([userPos.lat, userPos.lng], { radius: 8, color: '#17557E', fillOpacity: .9 })
        .addTo(map).bindPopup(esc(t('you_are_here')));
      window.track?.('location_resolved', {});
    },
    () => { window.track?.('location_failed', {}); transientBanner(t('geo_not_found')); },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}
document.getElementById('btnLocate').addEventListener('click', locateMe);
document.getElementById('situChip')?.addEventListener('click', () => document.getElementById('navSituation')?.click());
document.getElementById('searchLocate')?.addEventListener('click', locateMe);

// « Mon statut de sécurité » depuis l'ACCUEIL : plus besoin d'ouvrir un
// incident — le statut se rattache au feu le plus proche (< 30 km) sinon à
// la zone consultée. Produit : la fonctionnalité vit là où sont les gens.
document.getElementById('btnSafety')?.addEventListener('click', () => {
  const active = citizenVisible() ? incidents.filter((i) => i.status === 'active') : [];
  const n = nearestFire(active, visibleSats());
  const ctx = { active: true, show: true };
  if (n && n.d < 30_000) {
    if (n.sat) ctx.satelliteEventId = n.item.id; else ctx.incidentId = n.item.public_id;
  }
  // Un seul conteneur #safetyZone dans le document à la fois.
  document.getElementById('detailContent').innerHTML = '';
  const body = document.getElementById('safetySheetBody');
  body.innerHTML = '<div id="safetyZone"></div>';
  document.getElementById('safetyCtxLine').textContent = (n && n.d < 30_000)
    ? t('safety_ctx_fire', { km: Math.max(1, Math.round(n.d / 1000)) })
    : t('safety_ctx_zone');
  openSheet('safetySheet');
  renderSafetyCard(ctx);
  window.track?.('safety_shortcut_opened', { linked: Boolean(n && n.d < 30_000) });
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
        b.addEventListener('click', () => selectPlace(r, true));
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

// Sélection d'un lieu (résultat ou lieu récent) : centrer, marquer, mémoriser.
// Les lieux récents restent LOCAUX à l'appareil — jamais envoyés en mesure.
function selectPlace(r, remember) {
  searchResults.hidden = true;
  const short = r.label.split(',').slice(0, 2).join(',');
  searchInput.value = short;
  searchInput.blur(); // referme le clavier mobile pour voir la carte
  map.setView([r.lat, r.lng], 15);
  if (window._searchMarker) map.removeLayer(window._searchMarker);
  window._searchMarker = L.circleMarker([r.lat, r.lng], { radius: 9, color: '#C4622D', fillOpacity: .7 })
    .addTo(map).bindPopup(esc(short));
  if (remember) {
    try {
      const rec = JSON.parse(localStorage.getItem('kifeh_recent_places') || '[]')
        .filter((p) => p.label !== r.label);
      rec.unshift({ label: r.label, lat: r.lat, lng: r.lng });
      localStorage.setItem('kifeh_recent_places', JSON.stringify(rec.slice(0, 5)));
    } catch { /* stockage indisponible : sans conséquence */ }
  }
}
// Champ vide + focus → lieux récents (recherche plus rapide au retour).
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 3) return;
  let rec = [];
  try { rec = JSON.parse(localStorage.getItem('kifeh_recent_places') || '[]'); } catch {}
  if (!rec.length) return;
  searchResults.innerHTML = '';
  for (const r of rec) {
    const b = document.createElement('button');
    b.setAttribute('role', 'option');
    b.textContent = `🕘 ${r.label.split(',').slice(0, 2).join(',')}`;
    b.addEventListener('click', () => selectPlace(r, false));
    searchResults.appendChild(b);
  }
  searchResults.hidden = false;
});

// --- Filtres ----------------------------------------------------------------
// Les puces rapides (types) et la feuille « Plus de filtres » (types, statut,
// période) agissent sur le MÊME jeu de filtres : carte, liste et compteur
// restent toujours cohérents.
function syncTypeControls() {
  document.querySelectorAll('.chip[data-type]').forEach((c) =>
    c.setAttribute('aria-pressed', filters.types.has(c.dataset.type)));
  document.querySelectorAll('.fType').forEach((c) => { c.checked = filters.types.has(c.value); });
  // Le satellite est une COUCHE D'INFORMATION (jamais un type d'incident) :
  // case dédiée dans « Plus de filtres », confiance visible seulement si active.
  const satBox = document.getElementById('fSatLayer');
  if (satBox) satBox.checked = filters.types.has('satellite');
  const confWrap = document.getElementById('fSatConfWrap');
  if (confWrap) confWrap.hidden = !filters.types.has('satellite') && !filters.satConf;
  document.getElementById('fSource').value = filters.source;
  updateFilterBadge();
  // La bande mode feux suit l'état du filtre feu QUEL QUE SOIT le chemin
  // (puce rapide ou panneau de filtres) — elle dispatch aussi l'événement
  // kifeh:fire-mode consommé par le moteur GL (#103) et le replay (#110).
  syncFireModeBar();
}
document.getElementById('fSatLayer')?.addEventListener('change', (e) => {
  window.track?.(e.currentTarget.checked ? 'layer_enabled' : 'layer_disabled', { layer_name: 'satellite' });
  if (e.currentTarget.checked) filters.types.add('satellite');
  else { filters.types.delete('satellite'); filters.satConf = ''; document.getElementById('fSatConf').value = ''; }
  syncTypeControls();
});
syncTypeControls(); // état initial (confiance satellite masquée par défaut)

// ── Les feux d'abord, en une seule donnée ────────────────────────────────────
// « Incendie » est la première catégorie et RÉUNIT signalements citoyens et
// observations satellite (dédupliqués quand un signalement est corroboré).
// Le filtre feu actif seul déclenche l'état vide honnête (limites satellite).
// Progression du mode feux (master §7) : Niveau 1 Comprendre → Situation,
// Niveau 2 Explorer → Calques. Discrète, fermable (mémorisé), jamais une
// nouvelle interface. Le niveau Analyser rejoindra la bande AVEC le replay.
function syncFireModeBar() {
  let bar = document.getElementById('fireModeBar');
  const wanted = fireFilterActive();
  // Signal d'entrée/sortie du mode feux (consommé par fire-map-gl.js #103 —
  // inerte tant que le drapeau serveur est éteint).
  document.dispatchEvent(new CustomEvent('kifeh:fire-mode', { detail: { on: wanted } }));
  let hidden = false;
  try { hidden = localStorage.getItem('kifeh_firemode_bar_hidden') === '1'; } catch {}
  if (!wanted || hidden) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'fireModeBar';
  bar.className = 'firemode-bar';
  bar.setAttribute('role', 'group');
  bar.innerHTML = `<strong>🔥 ${esc(t('firemode_title'))}</strong>
    <button type="button" class="btn secondary small-btn" id="fmUnderstand">${esc(t('firemode_understand'))}</button>
    <button type="button" class="btn secondary small-btn" id="fmExplore">${esc(t('firemode_explore'))}</button>
    ${window.kifehReplayEnabled?.() ? `<button type="button" class="btn secondary small-btn" id="fmReplay">⏱ ${esc(t('replay_btn'))}</button>` : ''}
    <button type="button" class="fm-close" aria-label="×">×</button>`;
  document.querySelector('.chips')?.insertAdjacentElement('afterend', bar);
  bar.querySelector('#fmUnderstand').addEventListener('click', () => document.getElementById('navSituation')?.click());
  bar.querySelector('#fmExplore').addEventListener('click', () => document.getElementById('btnLayers')?.click());
  // Niveau « Analyser » (master §7) : la relecture des 72 dernières heures.
  bar.querySelector('#fmReplay')?.addEventListener('click', () => window.kifehReplayEnter?.());
  bar.querySelector('.fm-close').addEventListener('click', () => {
    try { localStorage.setItem('kifeh_firemode_bar_hidden', '1'); } catch {}
    bar.remove();
  });
}

function fireFilterActive() {
  return filters.types.size === 1 && filters.types.has('fire');
}
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
  if (filters.types.has('fire')) window.track?.('fire_map_opened', {});
  syncFireModeBar();
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

// Garde le point sélectionné VISIBLE au-dessus de la feuille de détail :
// si le marqueur serait recouvert, la carte glisse doucement pour le placer
// dans le tiers supérieur de l'écran (le contexte n'est jamais perdu).
function ensureMarkerVisibleAboveSheet(lat, lng) {
  try {
    if (lat == null || lng == null) return;
    const pt = map.latLngToContainerPoint([lat, lng]);
    const target = map.getSize().y * 0.30;
    if (pt.y > target) map.panBy([0, pt.y - target], { animate: true, duration: 0.3 });
  } catch { /* jamais bloquant */ }
}

// --- Feuilles (bottom sheets) ----------------------------------------------
// Gestion du focus (accessibilité) : à l'ouverture, le focus entre dans la
// feuille ; à la fermeture, il revient à l'élément qui l'a ouverte.
let sheetOpener = null;
function openSheet(id) {
  closeSheets(false);
  const ae = document.activeElement;
  // Ne mémoriser que les déclencheurs HORS feuille (jamais un élément d'une
  // feuille refermée, qui n'est plus visible).
  if (ae && ae !== document.body && !ae.closest('.sheet')) sheetOpener = ae;
  const s = document.getElementById(id);
  s.classList.remove('pos-half');
  s.classList.add('open');
  s.setAttribute('tabindex', '-1');
  s.focus({ preventScroll: true });
  // La vue « liste » est un premier rang : son état survit à la visite.
  if (id === 'listSheet') { try { localStorage.setItem('kifeh_view', 'list'); } catch {} }
}
function closeSheets(restoreFocus = true) {
  const wasOpen = document.querySelector('.sheet.open');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open'));
  if (restoreFocus && wasOpen && sheetOpener?.isConnected) {
    try { sheetOpener.focus({ preventScroll: true }); } catch { /* élément disparu */ }
    sheetOpener = null;
  }
  // Feuilles fermées = on est « sur la carte » (état de la navigation).
  try { setNavCurrent('navMap'); } catch { /* page sans navigation */ }
  if (wasOpen?.id === 'listSheet') { try { localStorage.setItem('kifeh_view', 'map'); } catch {} }
}
// Fermeture visible et cohérente sur TOUTES les feuilles (accessibilité :
// la poignée seule n'est pas une affordance suffisante).
document.querySelectorAll('.sheet').forEach((s) => {
  if (s.querySelector('.sheet-close')) return;
  const b = document.createElement('button');
  b.className = 'sheet-close'; b.type = 'button'; b.textContent = '✕';
  b.setAttribute('aria-label', t('sheet_close'));
  b.addEventListener('click', closeSheets);
  s.prepend(b);
});
document.querySelectorAll('.sheet .handle').forEach((h) =>
  h.parentElement.addEventListener('click', (e) => { if (e.target === h) closeSheets(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

// Feuilles mobiles à TROIS positions (master UX §9) : glisser la poignée —
// vers le haut = pleine hauteur, cran vers le bas = mi-hauteur, grand
// glissement depuis la mi-hauteur = fermeture. Desktop (≥1100 px, panneau
// latéral) non concerné. Échap et boutons de fermeture inchangés.
(function initSheetPositions() {
  const desktop = window.matchMedia('(min-width: 1100px)');
  document.querySelectorAll('.sheet').forEach((sheet) => {
    const handle = sheet.querySelector('.handle');
    if (!handle) return;
    handle.style.touchAction = 'none';
    let startY = null, startH = 0, wasHalf = false;
    handle.addEventListener('pointerdown', (e) => {
      if (desktop.matches) return;
      startY = e.clientY;
      startH = sheet.getBoundingClientRect().height;
      wasHalf = sheet.classList.contains('pos-half');
      try { handle.setPointerCapture(e.pointerId); } catch {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (startY == null || desktop.matches) return;
      const h = Math.max(90, Math.min(window.innerHeight * .88, startH - (e.clientY - startY)));
      sheet.style.maxHeight = `${h}px`; // suivi direct sous le doigt
    });
    const release = (e) => {
      if (startY == null) return;
      const dy = e.clientY - startY;
      startY = null;
      sheet.style.maxHeight = '';
      if (dy < -40) sheet.classList.remove('pos-half');       // vers le haut → plein
      else if (dy > 60 && (wasHalf || startH < window.innerHeight * .45)) closeSheets(); // encore un cran → fermer
      else if (dy > 60) sheet.classList.add('pos-half');      // un cran → mi-hauteur
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', () => { startY = null; sheet.style.maxHeight = ''; });
  });
})();
map.on('click', closeSheets);

// --- Liste ------------------------------------------------------------------
document.getElementById('btnList').addEventListener('click', () => { renderList(); openSheet('listSheet'); });
// Tri mémorisé : proximité/récence/gravité — le choix survit aux visites.
try {
  const savedSort = localStorage.getItem('kifeh_sort');
  if (savedSort) document.getElementById('sortSelect').value = savedSort;
} catch {}
document.getElementById('sortSelect').addEventListener('change', () => {
  try { localStorage.setItem('kifeh_sort', document.getElementById('sortSelect').value); } catch {}
  renderList();
});

function renderList() {
  renderSavedZoneChips(); // zones suivies : accès en un geste depuis la liste
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
  // État vide UTILE : jamais un cul-de-sac — suivre la zone ou contribuer.
  if (!rows.length && !(showSat && visibleSats().length)) {
    el.innerHTML = `
      <p class="muted">${t('list_empty')}</p>
      <div class="empty-actions">
        <button class="btn secondary small-btn" id="emptyFollowZone">☆ ${esc(t('follow_zone_btn'))}</button>
        <a class="btn secondary small-btn" href="declare.html">${esc(t('declare_btn'))}</a>
      </div>`;
    document.getElementById('emptyFollowZone')?.addEventListener('click', () => openFollowSheet());
    return;
  }
  el.innerHTML = '';
  // Cartes d'incident : hiérarchie stricte — type + statut, lieu, fraîcheur,
  // UN signal de confiance. La gravité et les détails techniques restent dans
  // la fiche (une carte se lit en une seconde).
  const follows = followStore();
  for (const i of rows) {
    const btn = document.createElement('button');
    btn.className = `list-item${i.status !== 'active' ? ' list-ended' : ''}`;
    const freshness = i.status === 'active'
      ? `${t('started_ago')} ${timeAgo(i.started_at)}`
      : `${t('ended')} ${timeAgo(i.resolved_at || i.updated_at)}`;
    const trust = i.satellite_last_seen
      ? `🛰️ ${t('sat_corroborated')}`
      : i.confirmations_count > 0
        ? (i.confirmations_count > 1 ? t('list_confirmed_n', { n: i.confirmations_count }) : t('list_confirmed_one'))
        : '';
    btn.innerHTML = `
      <div class="type-dot ${esc(i.type)}">${TYPE_ICONS[i.type] || '•'}</div>
      <div style="flex:1">
        <strong>${esc(TYPE_LABELS[i.type])}</strong>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span>
        ${follows[i.public_id] ? '<span class="follow-star" title="' + esc(t('follow_on')) + '">★</span>' : ''}<br>
        <span class="list-place">${esc(i.area || t('area_approx'))}</span><br>
        <span class="muted small">${esc(freshness)}${trust ? ` · ${esc(trust)}` : ''}</span>
      </div>
      <span class="list-chevron" aria-hidden="true">›</span>`;
    btn.addEventListener('click', () => openDetail(i.public_id));
    el.appendChild(btn);
  }
  // Feux observés par satellite : MÊME apparence que les feux signalés
  // (une seule donnée feu), seule la SOURCE change — badge 🛰️ explicite,
  // jamais d'amalgame avec un signalement citoyen.
  if (showSat) {
    for (const ev of visibleSats()) {
      const btn = document.createElement('button');
      btn.className = 'list-item';
      btn.innerHTML = `
        <div class="type-dot fire">${TYPE_ICONS.fire}</div>
        <div style="flex:1">
          <strong>${esc(TYPE_LABELS.fire)}</strong>
          <span class="badge sat">🛰️ ${t('sat_source_badge')}</span><br>
          <span class="list-place">${t('area_approx')}</span><br>
          <span class="muted small">${t('sat_last_seen')} ${timeAgo(ev.last_detected_at)} · NASA FIRMS</span>
        </div>
        <span class="list-chevron" aria-hidden="true">›</span>`;
      btn.addEventListener('click', () => openSatDetail(ev.id));
      el.appendChild(btn);
    }
  }
}

// ── Visuels météo : le vent SE VOIT (boussole orientée), la chaleur SE LIT
// (échelle colorée) — jamais de rouge « danger » pour une simple température.
function windVisualHtml(w) {
  if (!w) return '';
  return `
  <div class="wind-visual">
    <span class="wind-compass" aria-hidden="true">
      <span class="wind-north">N</span>
      <span class="wind-needle" style="transform:rotate(${((Number(w.directionToDeg) || 0) - 90 + 360) % 360}deg)">➤</span>
    </span>
    <span class="wind-data">
      <strong>💨 ${esc(String(w.speedKmh))} km/h → ${esc(windDirName(w.directionToDeg))}</strong>
      ${w.gustsKmh ? `<span class="small">${esc(t('fs_wind_gusts', { g: w.gustsKmh }))}</span>` : ''}
    </span>
  </div>`;
}
// Qualité de l'air : mot QUALITATIF de l'échelle européenne EAQI — une
// information de contexte, jamais un avis médical.
function airQualityLabel(eaqi) {
  if (eaqi <= 20) return t('air_q_good');
  if (eaqi <= 50) return t('air_q_medium');
  return t('air_q_bad');
}

// Timeline des moments clés d'un incident — UNIQUEMENT à partir des
// horodatages réellement stockés (jamais d'événement reconstitué).
function timelineHtml(i) {
  const ev = [];
  if (i.started_at) ev.push({ at: i.started_at, label: t('tl_started') });
  if (i.satellite_last_seen) ev.push({ at: i.satellite_last_seen, label: t('tl_sat'), icon: '🛰️' });
  if (i.ended_at || i.resolved_at) {
    ev.push({ at: i.ended_at || i.resolved_at, label: t('tl_resolved'), icon: '✓' });
  } else if (i.updated_at && i.updated_at !== i.started_at) {
    ev.push({ at: i.updated_at, label: t('tl_updated') });
  }
  if (ev.length < 2) return ''; // une timeline d'un seul point n'apprend rien
  ev.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return `
  <div class="timeline" aria-label="${esc(t('timeline_title'))}">
    <p class="small" style="margin:0 0 .25rem"><strong>${esc(t('timeline_title'))}</strong></p>
    ${ev.map((e) => `<div class="tl-item"><span class="tl-dot" aria-hidden="true">${e.icon || ''}</span>
      <span class="small">${esc(e.label)}</span>
      <span class="muted small">${esc(fmtDate(e.at))}</span></div>`).join('')}
  </div>`;
}

function heatVisualHtml(h) {
  if (!h) return '';
  const pct = Math.max(2, Math.min(98, ((h.tempC + 5) / 50) * 100)); // échelle −5…45 °C
  return `
  <div class="heat-visual">
    <span class="wind-data">
      <strong>🌡️ ${esc(t('heat_now', { c: h.tempC }))}</strong>
      ${h.feelsC != null && h.feelsC !== h.tempC ? `<span class="small">${esc(t('heat_feels', { c: h.feelsC }))}</span>` : ''}
      ${h.humidityPct != null ? `<span class="small">💧 ${esc(t('heat_humidity', { p: h.humidityPct }))}</span>` : ''}
      ${h.maxC != null && h.maxC > h.tempC ? `<span class="small muted">${esc(t('heat_max', { c: h.maxC, h: heatHourLabel(h.maxAt) }))}</span>` : ''}
    </span>
    <span class="heat-scale" aria-hidden="true"><span class="heat-dot" style="inset-inline-start:${pct}%"></span></span>
  </div>`;
}

// ── Grille météo « comme une app météo » : tuiles colorées lisibles en un
// coup d'œil — température (fond nuancé par la chaleur), vent (boussole),
// ciel (nuages) et visibilité. Jamais de rouge « danger » pour de la météo.
function tempTone(c) {
  if (c == null) return '';
  if (c >= 35) return ' wx-hot'; if (c >= 28) return ' wx-warm';
  if (c >= 18) return ' wx-mild'; return ' wx-cool';
}
function skyInfo(pct) {
  if (pct == null) return null;
  if (pct < 20) return { icon: '☀️', label: t('wx_sky_clear') };
  if (pct < 55) return { icon: '🌤️', label: t('wx_sky_partly') };
  if (pct < 85) return { icon: '☁️', label: t('wx_sky_cloudy') };
  return { icon: '☁️', label: t('wx_sky_overcast') };
}
function weatherTilesHtml(h, w) {
  if (!h && !w) return '';
  const sky = skyInfo(h?.cloudPct);
  const visLow = h?.visibilityKm != null && h.visibilityKm < 5;
  return `
  <div class="wx-grid">
    ${h ? `<div class="wx-tile${tempTone(h.tempC)}">
      <span class="wx-big">${esc(String(h.tempC))}°</span>
      <span class="wx-label">${h.feelsC != null ? esc(t('heat_feels', { c: h.feelsC })) : '🌡️'}</span>
      ${h.maxC != null && h.maxC > h.tempC ? `<span class="wx-sub">${esc(t('heat_max', { c: h.maxC, h: heatHourLabel(h.maxAt) }))}</span>` : ''}
    </div>` : ''}
    ${w ? `<div class="wx-tile">
      <span class="wx-compass"><span class="wx-needle" style="transform:rotate(${((Number(w.directionToDeg) || 0) - 90 + 360) % 360}deg)">➤</span></span>
      <span class="wx-label"><strong>${esc(String(w.speedKmh))} km/h</strong> → ${esc(windDirName(w.directionToDeg))}</span>
      ${w.gustsKmh ? `<span class="wx-sub">${esc(t('fs_wind_gusts', { g: w.gustsKmh }))}</span>` : ''}
    </div>` : ''}
    ${sky ? `<div class="wx-tile">
      <span class="wx-big">${sky.icon}</span>
      <span class="wx-label">${esc(sky.label)}</span>
      <span class="wx-sub">${esc(t('wx_cloud_pct', { p: h.cloudPct }))}</span>
    </div>` : ''}
    ${h?.visibilityKm != null ? `<div class="wx-tile${visLow ? ' wx-vis-low' : ''}">
      <span class="wx-big">👁️</span>
      <span class="wx-label">${esc(t('wx_visibility'))}</span>
      <span class="wx-sub">${esc(t('wx_vis_km', { km: h.visibilityKm >= 10 ? Math.round(h.visibilityKm) : h.visibilityKm }))}${visLow ? ` · ${esc(t('wx_vis_reduced'))}` : ''}</span>
    </div>` : ''}
  </div>`;
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
  window.track?.('incident_detail_opened', {});
  document.getElementById('safetySheetBody')?.replaceChildren(); // un seul #safetyZone
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('detailSheet');
  let i;
  try { i = await API.get(`/api/public/incidents/${encodeURIComponent(publicId)}`); }
  catch (e) { el.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }

  openIncidentId = i.public_id; // suivi en direct de la fiche ouverte (SSE)
  const confirmed = isDone('confirmed', i.public_id);
  const endedReported = isDone('ended', i.public_id);
  const isFire = i.type === 'fire';
  const confirmLabel = isFire ? t('confirm_fire_btn') : t('im_affected');

  el.innerHTML = `
    <h2><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
    <p class="muted">${esc(i.area || t('area_approx'))} · ${t('ref')} ${esc(i.public_id)}</p>
    ${userPos ? `<p class="muted small">📍 ${esc(t('detail_distance', { km: Math.max(1, Math.round(map.distance([userPos.lat, userPos.lng], [i.lat, i.lng]) / 1000)) }))}</p>` : ''}
    ${i.dfci?.code ? `<div class="dfci-block">
      <span class="small"><strong>${esc(t('dfci_label'))}</strong> · ${esc(t('dfci_precision'))}${i.dfci.indicative ? ` · ${esc(t('dfci_indicative'))}` : ''}</span>
      <span class="dfci-code" dir="ltr">${esc(i.dfci.code)}</span>
      <button class="btn ghost small-btn" id="dfciCopy" type="button">${esc(t('dfci_copy'))}</button>
      <span class="muted small">${esc(t('dfci_help'))}</span>
    </div>` : ''}
    ${i.status === 'active' ? `<p class="muted small">⟳ ${esc(t('live_note'))}</p>` : ''}
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
    ${timelineHtml(i)}
    ${i.confirmations_count > 0 ? `<p class="notice ok" id="affectedCount">${i.confirmations_count > 1 ? t('affected_n', { n: i.confirmations_count }) : t('affected_one')}</p>` : '<p hidden id="affectedCount"></p>'}
    ${i.resolutionReports > 0 && i.status === 'active' ? `<p class="notice warn" id="endedCount"><strong>${t('ended_pending')}</strong><br>${i.resolutionReports > 1 ? t('ended_reports_n', { n: i.resolutionReports }) : t('ended_reports_one')}</p>` : ''}
    ${isFire ? '<div id="fsSections"></div>' : ''}
    <div id="safetyZone"></div>
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
    <div class="detail-links">
      <button class="btn ghost small-btn" id="btnShare">${t('share_btn')}</button>
      <button class="btn ghost small-btn" id="btnFollow" aria-pressed="${isFollowed(i.public_id)}">${isFollowed(i.public_id) ? `★ ${t('follow_on')}` : `☆ ${t('follow_btn')}`}</button>
      <button class="btn ghost small-btn" id="btnLocCorrect">${t('loc_correct_title')}</button>
      <button class="btn ghost small-btn" id="btnReport">${t('report_content')}</button>
    </div>
    <div id="locCorrectZone"></div>
    <div id="reportZone"></div>`;

  document.getElementById('dfciCopy')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(i.dfci.code);
      e.currentTarget.textContent = t('dfci_copied');
      window.track?.('dfci_copied', {});
    } catch { /* presse-papiers indisponible : le code reste sélectionnable */ }
  });
  ensureMarkerVisibleAboveSheet(i.lat, i.lng);
  // « Situation incendie » (France) : vent + consignes officielles sur les feux.
  if (i.type === 'fire') renderFireSituationSections(el, i.lat, i.lng);
  // « Comment allez-vous ? » : statut PERSONNEL (feux et incidents graves) —
  // jamais mêlé aux actions sur l'incident lui-même.
  renderSafetyCard({ incidentId: i.public_id, active: i.status === 'active',
    show: isFire || i.severity === 'critical' });

  document.getElementById('btnConfirm')?.addEventListener('click', (e) => {
    if (!verificationRequired) return withButton(e.currentTarget, () => directConfirm(i));
    renderConfirmForm(i);
  });
  document.getElementById('btnEnded')?.addEventListener('click', () => renderEndedForm(i));
  // Partage : lien direct vers la fiche (Web Share natif, repli copie).
  document.getElementById('btnShare').addEventListener('click', async (e) => {
    const url = `${location.origin}${API_BASE}/i/${encodeURIComponent(i.public_id)}`
      + '?from=share&utm_source=share&utm_medium=referral&utm_campaign=user_share';
    const text = `${TYPE_ICONS[i.type]} ${TYPE_LABELS[i.type]} — ${i.area || t('area_approx')}`;
    window.track?.('incident_shared', { incident_type: i.type });
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Kifeh', text, url });
        window.track?.('share_channel_selected', { share_channel: 'native' });
      } else {
        await navigator.clipboard.writeText(url); e.target.textContent = t('link_copied');
        window.track?.('share_channel_selected', { share_channel: 'copy_link' });
      }
    } catch { /* partage annulé par l'utilisateur : sans conséquence */ }
  });
  document.getElementById('btnLocCorrect').addEventListener('click', () => renderCorrectionForm(i));
  document.getElementById('btnReport').addEventListener('click', () => renderReportForm(i));
  // « Suivre cet incident » : mémorisé localement, sans compte — permet d'y
  // revenir et alimente « Depuis votre dernière visite » (fin, réouverture…).
  document.getElementById('btnFollow').addEventListener('click', (e) => {
    const on = toggleFollow(i);
    e.currentTarget.textContent = on ? `★ ${t('follow_on')}` : `☆ ${t('follow_btn')}`;
    e.currentTarget.setAttribute('aria-pressed', String(on));
    window.track?.(on ? 'incident_followed' : 'incident_unfollowed', { incident_type: i.type });
  });

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
  // Hiérarchie de la fiche : les consignes officielles s'affichent AVANT la
  // carte « Comment allez-vous ? » et les actions communautaires quand un
  // emplacement dédié existe (sinon, comportement historique : à la fin).
  const zone = document.getElementById('fsSections')
    || (() => { const d = document.createElement('div'); host.appendChild(d); return d; })();
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
        const ctx = w.downwind === 'downwind' ? t('fs_downwind')
          : (w.downwind === 'crosswind' || w.downwind === 'upwind') ? t('fs_not_downwind')
          : w.downwind === 'unknown' ? t('fs_downwind_unknown') : '';
        inner = `
          ${weatherTilesHtml(w.heat || fireSit?.heat, w.wind)}
          ${(w.wind.forecast || []).length ? `<p class="small">🕒 ${w.wind.forecast.map((f) =>
            esc(t('wind_fc_line', { h: f.inHours, v: f.speedKmh, dir: windDirName(f.directionToDeg) }))).join(' · ')}</p>` : ''}
          ${ctx ? `<p>${esc(ctx)}</p>` : ''}
          <p class="muted small">${esc(t('fs_wind_note'))}<br>${esc(t('fs_wind_at', { t: fmtDate(w.wind.observedAt) }))}</p>`;
      }
      zone.insertAdjacentHTML('beforeend', `<h2 style="margin-top:1rem">${esc(t('fs_wind_head'))}</h2>${inner}`);
    }
  } catch { /* le vent tombe en panne sans bloquer la fiche */ }
  // B. Consignes officielles (source la plus spécifique d'abord).
  // AUCUNE consigne → la section n'apparaît pas du tout : une rubrique vide
  // n'informe personne et alourdit la fiche.
  try {
    const o = await API.get(`/api/fire-situation/official?lat=${fireLat.toFixed(3)}&lng=${fireLng.toFixed(3)}`);
    if (o.enabled && o.updates.length) {
      let inner;
      {
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
  document.getElementById('safetySheetBody')?.replaceChildren(); // un seul #safetyZone
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
    ${ev.lastSyncAt ? `<br><span class="muted small">${t('sat_last_sync', { t: fmtDate(ev.lastSyncAt) })}
      · ${t('sat_next_sync', { t: fmtDate(new Date(Date.parse(ev.lastSyncAt) + 15 * 60_000).toISOString()) })}</span>` : ''}</p>
    ${ev.confirmations_count > 0 ? `<p class="notice ok">${ev.confirmations_count > 1 ? t('affected_n', { n: ev.confirmations_count }) : t('affected_one')}</p>` : ''}
    <p class="notice warn small">${t('sat_disclaimer')}</p>
    <p class="notice danger small">${t(currentCountry() === 'FR' ? 'sat_danger_fr' : 'sat_danger')}</p>
    <div id="fsSections"></div>
    <div id="safetyZone"></div>
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
  ensureMarkerVisibleAboveSheet(ev.lat, ev.lng);
  renderFireSituationSections(el, ev.lat, ev.lng);
  renderSafetyCard({ satelliteEventId: ev.id, active: ev.status !== 'ended', show: true });

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

// ═════════════════════════════════════════════════════════════════════════════
// « Mon statut de sécurité » / « حالتي الآن » — statut PERSONNEL et temporaire.
// Règles produit : jamais confondu avec l'état de l'incident (ne confirme
// rien, ne clôt rien, ne compte dans aucun compteur) ; rien de public ;
// « J'ai besoin d'aide » affiche IMMÉDIATEMENT les numéros d'urgence du bon
// pays, sans formulaire ; le partage vers un proche est facultatif.
// ═════════════════════════════════════════════════════════════════════════════
function safetyCtxKey(ctx) {
  return ctx.incidentId || (ctx.satelliteEventId ? `sat:${ctx.satelliteEventId}` : `zone:${currentCountry()}`);
}
function safetyStore() {
  try { return JSON.parse(localStorage.getItem('kifeh_safety') || '{}'); } catch { return {}; }
}
function safetySave(ctx, entry) {
  try {
    const s = safetyStore();
    if (entry) s[safetyCtxKey(ctx)] = entry; else delete s[safetyCtxKey(ctx)];
    localStorage.setItem('kifeh_safety', JSON.stringify(s));
  } catch { /* stockage indisponible : le statut serveur reste valable */ }
}

function renderSafetyCard(ctx) {
  const zone = document.getElementById('safetyZone');
  if (!zone || !ctx.show || !ctx.active) return;
  zone.innerHTML = `
    <div class="card safety-card">
      <h2 id="safetyTitle">${esc(t('safety_q'))}</h2>
      <p class="muted small">${esc(t('safety_intro'))}</p>
      <div id="safetyBody"></div>
    </div>`;
  window.track?.('safety_card_displayed', {});
  const saved = safetyStore()[safetyCtxKey(ctx)];
  if (saved && Date.parse(saved.expiresAt) > Date.now()) renderSafetyDone(ctx, saved);
  else if (saved) renderSafetyExpired(ctx, saved);
  else renderSafetyChoices(ctx);
}

// État 1 — choix initial : trois actions distinctes, grandes et claires.
function renderSafetyChoices(ctx) {
  const body = document.getElementById('safetyBody');
  body.innerHTML = `
    <button class="btn safety-btn" id="sfSafe">🤍 ${esc(t('safety_safe_btn'))}</button>
    <button class="btn secondary safety-btn" id="sfLeft">🚶 ${esc(t('safety_left_btn'))}</button>
    <button class="btn safety-btn safety-help" id="sfHelp">🆘 ${esc(t('safety_help_btn'))}</button>
    <div id="safetyErr" class="field-error" role="alert"></div>`;
  document.getElementById('sfSafe').addEventListener('click', (e) =>
    withButton(e.currentTarget, () => submitSafety(ctx, 'safe')));
  document.getElementById('sfLeft').addEventListener('click', (e) =>
    withButton(e.currentTarget, () => submitSafety(ctx, 'left_area')));
  document.getElementById('sfHelp').addEventListener('click', () => renderSafetyHelp(ctx));
}

async function submitSafety(ctx, status) {
  try {
    const r = await API.post('/api/safety/checkins', {
      status, deviceId: getDeviceId(), country: currentCountry(),
      incidentId: ctx.incidentId || undefined,
      satelliteEventId: ctx.satelliteEventId || undefined, // ni l'un ni l'autre = statut de zone
    });
    const prev = safetyStore()[safetyCtxKey(ctx)];
    const entry = {
      token: r.managementToken || prev?.token || null,
      status: r.status, expiresAt: r.expiresAt, areaLabel: r.areaLabel || null,
    };
    safetySave(ctx, entry);
    window.track?.(status === 'safe' ? 'safety_safe_selected' : 'safety_left_selected', {});
    renderSafetyDone(ctx, entry, true);
  } catch (ex) {
    const el = document.getElementById('safetyErr');
    if (el) el.textContent = ex.message;
  }
}

// État 2 — statut enregistré : partage facultatif, modification, suppression.
function renderSafetyDone(ctx, entry, justSaved) {
  const body = document.getElementById('safetyBody');
  if (!body) return;
  const label = entry.status === 'left_area' ? t('safety_status_left') : t('safety_status_safe');
  body.innerHTML = `
    ${justSaved ? `<p class="notice ok">${esc(t('safety_saved'))}</p>` : ''}
    <p><strong>${entry.status === 'left_area' ? '🚶' : '🤍'} ${esc(label)}</strong><br>
    <span class="muted small">${esc(t('safety_valid_until', { t: fmtDate(entry.expiresAt) }))}</span></p>
    <p class="muted small">${esc(t('safety_keep_following'))}</p>
    <button class="btn secondary safety-btn" id="sfShare">📤 ${esc(t('safety_share_btn'))}</button>
    <button class="btn ghost small-btn" id="sfEdit">${esc(t('safety_update_btn'))}</button>
    <button class="btn ghost small-btn" id="sfDelete">${esc(t('safety_delete_btn'))}</button>
    <button class="btn ghost small-btn" id="sfHelp2">🆘 ${esc(t('safety_help_btn'))}</button>
    <div id="safetyErr" class="field-error" role="alert"></div>`;
  document.getElementById('sfShare').addEventListener('click', (e) =>
    withButton(e.currentTarget, () => shareSafety(ctx, entry, e.currentTarget)));
  document.getElementById('sfEdit').addEventListener('click', () => renderSafetyChoices(ctx));
  document.getElementById('sfHelp2').addEventListener('click', () => renderSafetyHelp(ctx));
  document.getElementById('sfDelete').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      if (entry.token) await API.post('/api/safety/checkins/delete', { managementToken: entry.token });
      safetySave(ctx, null);
      window.track?.('safety_removed', {});
      document.getElementById('safetyBody').innerHTML = `<p class="notice ok">${esc(t('safety_deleted'))}</p>`;
      setTimeout(() => renderSafetyChoices(ctx), 1500);
    } catch (ex) { document.getElementById('safetyErr').textContent = ex.message; }
  }));
}

// État 2b — statut expiré : proposer une mise à jour, jamais « en danger ».
function renderSafetyExpired(ctx, entry) {
  const body = document.getElementById('safetyBody');
  if (!body) return;
  renderSafetyChoices(ctx); // les trois choix, puis la question au-dessus
  body.insertAdjacentHTML('afterbegin',
    `<p class="notice warn small">${esc(t('safety_expired_q'))}</p>`);
}

// Partage « Prévenir un proche » : message + lien sécurisé, temporaire et
// révocable. Web Share natif si disponible, sinon copie dans le presse-papiers.
async function shareSafety(ctx, entry, btn) {
  try {
    if (!entry.token) throw new Error(t('search_error'));
    const r = await API.post('/api/safety/checkins/share', { managementToken: entry.token });
    const url = `${location.origin}${API_BASE}/safety.html?s=${encodeURIComponent(r.shareToken)}`;
    const at = fmtDate(new Date().toISOString());
    const msgKey = entry.status === 'left_area' ? 'safety_share_msg_left' : 'safety_share_msg_safe';
    const text = `${t(msgKey, { t: at })}\n${url}`;
    window.track?.('safety_share_opened', {});
    if (navigator.share) await navigator.share({ title: t('safety_title'), text });
    else { await navigator.clipboard.writeText(text); if (btn) btn.textContent = t('safety_link_copied'); }
  } catch (ex) {
    if (ex?.name === 'AbortError') return; // partage annulé : sans conséquence
    const el = document.getElementById('safetyErr');
    if (el) el.textContent = ex.message || t('search_error');
  }
}

// État 3 — « J'ai besoin d'aide » : numéros d'urgence IMMÉDIATS du bon pays.
// Aucun enregistrement, aucun formulaire. Kifeh ne contacte jamais les secours.
async function renderSafetyHelp(ctx) {
  const body = document.getElementById('safetyBody');
  body.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
  window.track?.('safety_help_opened', {});
  let contacts = [];
  try {
    ({ contacts } = await API.get(`/api/public/contacts?type=fire&country=${currentCountry()}`));
  } catch { /* les numéros de secours nationaux restent affichés via i18n */ }
  const tel = (c) => (c.phone_tel || '').startsWith('sms:') ? c.phone_tel : `tel:${c.phone_tel}`;
  const list = (contacts || []).map((c) => `
    <a class="btn safety-btn safety-tel" href="${esc(tel(c))}">
      📞 ${esc(LANG === 'ar' ? c.name_ar : c.name_fr)} — <strong>${esc(c.phone_display)}</strong>
    </a>`).join('');
  body.innerHTML = `
    <p class="notice danger"><strong>${esc(t('safety_help_title'))}</strong><br>
    <span class="small">${esc(t('safety_disclaimer'))}</span></p>
    ${list || `<p class="muted small">${esc(t('contacts_unavailable'))}</p>`}
    <button class="btn ghost small-btn" id="sfBack">${esc(t('back'))}</button>`;
  document.getElementById('sfBack').addEventListener('click', () => renderSafetyCard(ctx));
}

// ═════════════════════════════════════════════════════════════════════════════
// Suivi et retour utile — « Suivre cet incident », « Suivre cette zone » et
// « Depuis votre dernière visite ». Tout est LOCAL au navigateur (aucun
// compte), et le retour n'est jamais fabriqué : si rien d'important n'a
// changé, rien n'est affiché. Mécanique de retour éthique, pas d'engagement
// artificiel.
// ═════════════════════════════════════════════════════════════════════════════

// --- Incidents suivis (max 10, les plus récents) ----------------------------
function followStore() {
  try { return JSON.parse(localStorage.getItem('kifeh_follows') || '{}'); } catch { return {}; }
}
function isFollowed(publicId) { return Boolean(followStore()[publicId]); }
function toggleFollow(i) {
  const s = followStore();
  const on = !s[i.public_id];
  if (on) {
    s[i.public_id] = { area: i.area || '', type: i.type, lastStatus: i.status, at: Date.now() };
    const keys = Object.keys(s);
    if (keys.length > 10) delete s[keys.sort((a, b) => s[a].at - s[b].at)[0]];
  } else delete s[i.public_id];
  try { localStorage.setItem('kifeh_follows', JSON.stringify(s)); } catch {}
  return on;
}

// --- Zones suivies (max 3, approximatives : centre + zoom, jamais d'adresse) -
function zoneStore() {
  try { return JSON.parse(localStorage.getItem('kifeh_zones') || '[]'); } catch { return []; }
}
function saveCurrentZone(btn) {
  const zones = zoneStore();
  if (zones.length >= 3) return transientBanner(t('follow_zone_limit'));
  const c = map.getCenter();
  const q = document.getElementById('search').value.trim();
  const label = (q ? q.split(',')[0] : '').slice(0, 30) || `${t('follow_zone_default')} ${zones.length + 1}`;
  zones.push({ label, lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3),
    zoom: map.getZoom(), country: currentCountry(), at: Date.now() });
  try { localStorage.setItem('kifeh_zones', JSON.stringify(zones)); } catch {}
  window.track?.('zone_followed', {});
  if (btn) btn.textContent = `★ ${t('follow_zone_done')}`;
  transientBanner(t('follow_zone_saved', { name: label }));
}
function removeZone(idx) {
  const zones = zoneStore(); zones.splice(idx, 1);
  try { localStorage.setItem('kifeh_zones', JSON.stringify(zones)); } catch {}
  renderSavedZoneChips();
}
// Puces « suivis » en tête de liste : zones ET incidents suivis, en un geste.
function renderSavedZoneChips() {
  const host = document.getElementById('savedZonesRow');
  if (!host) return;
  const zones = zoneStore().filter((z) => z.country === currentCountry());
  const follows = Object.entries(followStore()).slice(0, 5);
  if (!zones.length && !follows.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="chips" style="margin:.25rem 0 .5rem">
    ${zones.map((z, i) => `<button class="chip zone-chip" data-zi="${i}">📍 ${esc(z.label)}
      <span class="zone-del" data-zdel="${i}" role="button" aria-label="${esc(t('follow_zone_remove'))}">✕</span></button>`).join('')}
    ${follows.map(([pid, f]) => `<button class="chip follow-chip" data-pid="${esc(pid)}">★ ${TYPE_ICONS[f.type] || ''} ${esc(f.area || pid)}</button>`).join('')}
  </div>`;
  host.querySelectorAll('.follow-chip').forEach((chip) => chip.addEventListener('click', () => {
    openDetail(chip.dataset.pid);
    window.track?.('followed_incident_opened', {});
  }));
  host.querySelectorAll('.zone-chip').forEach((chip) => chip.addEventListener('click', (e) => {
    if (e.target.closest('.zone-del')) return;
    const z = zones[+chip.dataset.zi];
    closeSheets();
    map.setView([z.lat, z.lng], z.zoom);
    window.track?.('zone_chip_opened', {});
  }));
  host.querySelectorAll('.zone-del').forEach((x) => x.addEventListener('click', (e) => {
    e.stopPropagation();
    const z = zones[+x.dataset.zdel];
    removeZone(zoneStore().findIndex((s) => s.at === z.at));
  }));
}

// --- « Depuis votre dernière visite » ---------------------------------------
// Comparé au dernier instantané local (par pays) : nouveaux incidents dans la
// zone, incidents suivis terminés/rouverts, changement de vigilance. Montré
// UNIQUEMENT après une vraie absence (6 h+) et seulement si quelque chose
// d'important a changé — jamais de bannière fabriquée.
const VISIT_GAP_MS = 6 * 3600_000;
let sinceChecked = false;
function readVisitSnap() {
  try { return JSON.parse(localStorage.getItem('kifeh_visit') || 'null'); } catch { return null; }
}
async function sinceLastVisit() {
  const prev = readVisitSnap();
  const changes = [];
  // Incidents suivis : détection des fins et réouvertures (toujours vérifié).
  const follows = followStore();
  let followsDirty = false;
  for (const [pid, f] of Object.entries(follows).slice(0, 10)) {
    try {
      const cur = await API.get(`/api/public/incidents/${encodeURIComponent(pid)}`);
      if (cur.status !== f.lastStatus) {
        changes.push(cur.status === 'active'
          ? t('since_followed_reopened', { area: f.area || pid })
          : t('since_followed_ended', { area: f.area || pid }));
        f.lastStatus = cur.status; followsDirty = true;
      }
    } catch { /* incident purgé ou hors ligne : silencieux */ }
  }
  if (followsDirty) { try { localStorage.setItem('kifeh_follows', JSON.stringify(follows)); } catch {} }
  // Zone visible : nouveaux incidents et vigilance, après une vraie absence.
  const activeIds = incidents.filter((i) => i.status === 'active').map((i) => i.public_id);
  const vigN = fireSit?.vigilance?.activeDepartments ?? null;
  if (prev && prev.country === currentCountry() && Date.now() - prev.at > VISIT_GAP_MS) {
    const fresh = activeIds.filter((id) => !(prev.activeIds || []).includes(id)).length;
    if (fresh > 0) changes.push(fresh === 1 ? t('since_new_one') : t('since_new_n', { n: fresh }));
    if (prev.vigN != null && vigN != null && vigN !== prev.vigN) changes.push(t('since_vig_changed'));
  }
  try {
    localStorage.setItem('kifeh_visit', JSON.stringify({
      at: Date.now(), country: currentCountry(), activeIds: activeIds.slice(0, 200), vigN,
    }));
  } catch {}
  if (changes.length) showSinceBanner(changes);
}
function showSinceBanner(changes) {
  const b = document.createElement('div');
  b.className = 'since-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `
    <button class="since-close" aria-label="✕">✕</button>
    <strong>${esc(t('since_title'))}</strong>
    ${changes.slice(0, 4).map((c) => `<div class="since-line">${esc(c)}</div>`).join('')}`;
  document.body.appendChild(b);
  b.addEventListener('click', (e) => {
    if (e.target.closest('.since-close')) { b.remove(); return; }
    b.remove(); renderList(); openSheet('listSheet');
  });
  setTimeout(() => b.remove(), 45_000);
  window.track?.('since_last_visit_shown', { changes: changes.length });
}

