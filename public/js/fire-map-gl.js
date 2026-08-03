// Kifeh — moteur cartographique MapLibre GL du MODE FEUX (chantier #103).
// DERRIÈRE DRAPEAU SERVEUR (`fire_maplibre_enabled`, ÉTEINT par défaut) :
// tant que le drapeau est éteint, ce fichier ne charge RIEN (ni la librairie
// vendorisée ~800 Ko, ni un seul octet réseau) et ne crée AUCUN élément.
// Règle du plan validé : aucun changement d'écran sans maquette approuvée —
// ce moteur ne REMPLACE l'affichage Leaflet qu'après captures validées.
//
// Principes :
//   · fallback Leaflet OBLIGATOIRE : WebGL absent, échec d'init, erreurs en
//     rafale → la carte Leaflet, toujours vivante en dessous, reprend seule ;
//   · chargement par CELLULES (grille fixe 1°/0,5°), cache LRU (48 cellules,
//     TTL 150 s), ANNULATION des requêtes des cellules sorties de l'écran —
//     et respect du rate-limit serveur (max 4 requêtes en vol) ;
//   · 5 classes d'ANCIENNETÉ (<3 h, 3-6, 6-12, 12-24, ≥24 h) portées par la
//     COULEUR + opacité ; la FRP n'est qu'une taille SECONDAIRE (jamais une
//     surface, jamais le canal principal) ;
//   · même langage visuel que Leaflet : signalements citoyens = les MÊMES
//     pins DOM (.marker-pin), zones brûlées = même brun assumé.
// Script CLASSIQUE ordonné (après home-layers.js) : partage la portée globale
// (t, esc, fmtDate, map, LITE, currentCountry, TILE_PROVIDERS, openDetail…).
'use strict';

(function kifehFireMapGL() {
  const S = {
    armed: false,      // drapeau serveur reçu et positif
    wanted: false,     // le mode feux est actif côté filtres
    active: false,     // le rendu GL est visible
    failed: false,     // échec définitif pour CETTE session → Leaflet seul
    gl: null,          // instance maplibregl.Map
    wrap: null,        // conteneur #glMap (enfant de #map)
    lib: null,         // promesse de chargement de la librairie
    errBurst: [],      // horodatages des erreurs GL (rafale → fallback)
    syncing: false,    // garde anti-boucle de synchronisation GL ↔ Leaflet
    markers: new Map(),// publicId → maplibregl.Marker (signalements citoyens)
  };

  // ── 5 classes d'ancienneté FIRMS (couleur = canal principal) ───────────────
  const AGE_HOURS = [3, 6, 12, 24];
  const AGE_COLORS = ['#E8432E', '#E06A2B', '#C97B37', '#A9836B', '#948A7E'];
  const AGE_OPACITY = [0.95, 0.85, 0.72, 0.58, 0.42];
  function ageClass(observedAt, now) {
    const h = (now - Date.parse(observedAt)) / 3600_000;
    for (let i = 0; i < AGE_HOURS.length; i++) if (h < AGE_HOURS[i]) return i;
    return 4;
  }

  // ── Grille de cellules (clé stable, indépendante du viewport) ──────────────
  const cellStep = (z) => (z >= 8 ? 0.5 : 1);
  function cellKeys(b, z) {
    const s = cellStep(z);
    const keys = [];
    const y0 = Math.floor(b.minLat / s), y1 = Math.floor(b.maxLat / s);
    const x0 = Math.floor(b.minLng / s), x1 = Math.floor(b.maxLng / s);
    if ((y1 - y0 + 1) * (x1 - x0 + 1) > 12) {
      // Vue trop large (échelle nationale) : UNE requête englobante plutôt
      // qu'une tempête de cellules — le serveur borne déjà à 500 détections.
      const r = (v) => Math.round(v * 2) / 2;
      return [{ key: `w:${r(b.minLat)}:${r(b.minLng)}:${r(b.maxLat)}:${r(b.maxLng)}`, bbox: b }];
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        keys.push({
          key: `c:${s}:${y}:${x}`,
          bbox: { minLat: y * s, maxLat: (y + 1) * s, minLng: x * s, maxLng: (x + 1) * s },
        });
      }
    }
    return keys;
  }

  // ── Cache LRU + annulation ─────────────────────────────────────────────────
  const LRU_MAX = 48, LRU_TTL = 150_000, MAX_INFLIGHT = 4;
  const lru = new Map();      // key → { data, at }
  const inflight = new Map(); // key → AbortController
  let pending = [];           // file d'attente au-delà de MAX_INFLIGHT
  function lruGet(key) {
    const e = lru.get(key);
    if (!e) return null;
    if (Date.now() - e.at > LRU_TTL) { lru.delete(key); return null; }
    lru.delete(key); lru.set(key, e); // rafraîchit la position LRU
    return e.data;
  }
  function lruSet(key, data) {
    lru.set(key, { data, at: Date.now() });
    while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value);
  }

  async function fetchCell(entry) {
    const ctl = new AbortController();
    inflight.set(entry.key, ctl);
    const q = new URLSearchParams({
      minLat: entry.bbox.minLat.toFixed(3), maxLat: entry.bbox.maxLat.toFixed(3),
      minLng: entry.bbox.minLng.toFixed(3), maxLng: entry.bbox.maxLng.toFixed(3),
      country: currentCountry(),
    });
    try {
      const r = await fetch(`/api/fire/map?${q}`, { signal: ctl.signal });
      if (r.ok) lruSet(entry.key, await r.json());
    } catch { /* annulée ou réseau : la cellule restera simplement absente */ }
    inflight.delete(entry.key);
    const next = pending.shift();
    if (next) fetchCell(next).then(rebuild);
  }

  let moveTimer = null;
  function scheduleLoad() {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(loadVisible, 350); // jamais pendant le geste
  }
  function loadVisible() {
    if (!S.active || !S.gl) return;
    const gb = S.gl.getBounds();
    const b = { minLat: gb.getSouth(), maxLat: gb.getNorth(), minLng: gb.getWest(), maxLng: gb.getEast() };
    const wanted = cellKeys(b, S.gl.getZoom());
    const wantedSet = new Set(wanted.map((w) => w.key));
    // Annule les requêtes des cellules sorties de l'écran (jamais de travail mort).
    for (const [key, ctl] of inflight) if (!wantedSet.has(key)) { ctl.abort(); inflight.delete(key); }
    pending = pending.filter((p) => wantedSet.has(p.key));
    const missing = wanted.filter((w) => !lruGet(w.key) && !inflight.has(w.key)
      && !pending.some((p) => p.key === w.key));
    for (const m of missing) {
      if (inflight.size < MAX_INFLIGHT) fetchCell(m).then(rebuild);
      else pending.push(m);
    }
    rebuild();
  }

  // ── Reconstruction des sources GL depuis les cellules en cache ─────────────
  function visibleData() {
    if (!S.gl) return { detections: [], burned: [], citizen: [] };
    const gb = S.gl.getBounds();
    const b = { minLat: gb.getSouth(), maxLat: gb.getNorth(), minLng: gb.getWest(), maxLng: gb.getEast() };
    const det = new Map(), burn = new Map(), cit = new Map();
    for (const w of cellKeys(b, S.gl.getZoom())) {
      const d = lruGet(w.key);
      if (!d?.enabled) continue;
      for (const x of d.detections || []) det.set(`${x.lat}|${x.lng}|${x.observedAt}`, x);
      for (const a of d.burnedAreas || []) {
        const prev = burn.get(a.featureId);
        if (!prev || a.publishedAt > prev.publishedAt) burn.set(a.featureId, a);
      }
      for (const c of d.citizenReports || []) cit.set(c.publicId, c);
    }
    return { detections: [...det.values()], burned: [...burn.values()], citizen: [...cit.values()] };
  }

  function rebuild() {
    if (!S.active || !S.gl || !S.gl.getSource('kifeh-detections')) return;
    const { detections, burned, citizen } = visibleData();
    const now = Date.now();
    S.gl.getSource('kifeh-detections').setData({
      type: 'FeatureCollection',
      features: detections.map((d) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        properties: {
          age: ageClass(d.observedAt, now), frp: d.frp || 0,
          observedAt: d.observedAt, satellite: d.satellite || '',
          instrument: d.instrument || '', confidence: d.confidence || '',
        },
      })),
    });
    S.gl.getSource('kifeh-burned').setData({
      type: 'FeatureCollection',
      features: burned.map((a) => ({
        type: 'Feature',
        // rings serveur = [ [ [lat,lng]… ] ] → GeoJSON attend [lng,lat].
        geometry: { type: 'Polygon', coordinates: a.rings.map((ring) => ring.map(([la, ln]) => [ln, la])) },
        properties: { areaHa: a.areaHa, commune: a.commune || '', fireDate: a.fireDate || '' },
      })),
    });
    // Signalements citoyens : les MÊMES pins DOM que Leaflet (identité visuelle).
    const keep = new Set();
    for (const c of citizen) {
      keep.add(c.publicId);
      if (S.markers.has(c.publicId)) continue;
      const el = document.createElement('div');
      el.className = 'gl-citizen';
      el.innerHTML = `<div class="marker-pin ${esc(c.type)}"><span>${TYPE_ICONS[c.type] || '•'}</span></div>`;
      el.addEventListener('click', () => { if (typeof openDetail === 'function') openDetail(c.publicId); });
      S.markers.set(c.publicId, new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([c.lng, c.lat]).addTo(S.gl));
    }
    for (const [id, mk] of S.markers) if (!keep.has(id)) { mk.remove(); S.markers.delete(id); }
    window.__glPerf = { ...(window.__glPerf || {}), cells: lru.size, detections: detections.length };
  }

  // ── Librairie vendorisée : chargée UNIQUEMENT à la première activation ─────
  function ensureLib() {
    if (S.lib) return S.lib;
    S.lib = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'vendor/maplibre/maplibre-gl.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'vendor/maplibre/maplibre-gl.js';
      js.onload = () => resolve();
      js.onerror = () => reject(new Error('lib'));
      document.head.appendChild(js);
    });
    return S.lib;
  }
  function webglOK() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }

  function markFailed(reason) {
    S.failed = true;
    S.failReason = reason;
    deactivate();
    window.track?.('fire_gl_fallback', { reason }); // Leaflet reprend, sans drame
  }

  // ── Activation / désactivation (Leaflet reste TOUJOURS vivant dessous) ─────
  async function activate() {
    if (S.active || S.failed || !S.armed || LITE) return;
    if (!webglOK()) return markFailed('no_webgl');
    const t0 = performance.now();
    try { await ensureLib(); } catch { return markFailed('lib_load'); }
    if (!S.wanted) return; // le mode feux a été quitté pendant le chargement
    try {
      if (!S.wrap) {
        S.wrap = document.createElement('div');
        S.wrap.id = 'glMap';
        document.getElementById('map').appendChild(S.wrap);
        const p = TILE_PROVIDERS[map._tileState?.index || 0] || TILE_PROVIDERS[0];
        S.gl = new maplibregl.Map({
          container: S.wrap, attributionControl: { compact: true },
          // ?glshot=1 : capture d'écran du canvas (validation visuelle) —
          // coût mémoire accepté UNIQUEMENT en mode capture, jamais par défaut.
          preserveDrawingBuffer: new URLSearchParams(location.search).has('glshot'),
          style: {
            version: 8,
            sources: { base: { type: 'raster', tiles: [p.url], tileSize: 256, attribution: p.attribution } },
            layers: [{ id: 'base', type: 'raster', source: 'base' }],
          },
          center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() - 1,
          dragRotate: false, pitchWithRotate: false, touchPitch: false,
        });
        S.gl.touchZoomRotate?.disableRotation();
        S.gl.on('error', (e) => {
          // Les échecs de TUILES ne tuent JAMAIS le moteur (philosophie
          // Leaflet : fond neutre, les données restent visibles) — seuls les
          // vrais maux du moteur comptent dans la rafale.
          const emsg = e?.error?.message || '';
          const isTile = e?.sourceId === 'base' || /tile|fetch|network|abort/i.test(emsg);
          if (e?.error?.message?.includes('WebGL')) return markFailed('webgl_lost');
          if (isTile) return;
          // Rafale d'erreurs (≥5 en 10 s) = moteur malade → fallback définitif.
          const now = Date.now();
          S.errBurst = S.errBurst.filter((x) => now - x < 10_000);
          S.errBurst.push(now);
          if (S.errBurst.length >= 5) markFailed('errors');
        });
        S.gl.on('load', () => {
          S.gl.addSource('kifeh-detections', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          S.gl.addSource('kifeh-burned', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          // Zones brûlées : même brun assumé que Leaflet, jamais le rouge feu.
          S.gl.addLayer({ id: 'burned-fill', type: 'fill', source: 'kifeh-burned',
            paint: { 'fill-color': '#7A5238', 'fill-opacity': 0.32 } });
          S.gl.addLayer({ id: 'burned-line', type: 'line', source: 'kifeh-burned',
            paint: { 'line-color': '#6E4A33', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
          // Détections : halo doux puis cœur — l'ÂGE est la couleur (5 classes),
          // la FRP n'ajoute qu'un rayon SECONDAIRE borné (jamais une surface).
          const ageExpr = (arr) => ['at', ['get', 'age'], ['literal', arr]];
          const frpRadius = ['*', 0.35, ['sqrt', ['min', ['coalesce', ['get', 'frp'], 0], 300]]];
          S.gl.addLayer({ id: 'det-halo', type: 'circle', source: 'kifeh-detections',
            paint: {
              'circle-color': ageExpr(AGE_COLORS), 'circle-blur': 0.8,
              'circle-opacity': ['*', 0.35, ageExpr(AGE_OPACITY)],
              'circle-radius': ['+', ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 10, 12, 16], frpRadius],
            } });
          S.gl.addLayer({ id: 'det-core', type: 'circle', source: 'kifeh-detections',
            paint: {
              'circle-color': ageExpr(AGE_COLORS), 'circle-opacity': ageExpr(AGE_OPACITY),
              'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 0.8,
              'circle-radius': ['+', ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 4, 12, 6], frpRadius],
            } });
          S.gl.on('click', 'det-core', (e) => {
            const f = e.features?.[0]; if (!f) return;
            const pr = f.properties;
            const conf = pr.confidence ? (t(`sat_conf_${pr.confidence}`) || pr.confidence) : '';
            new maplibregl.Popup({ closeButton: true, maxWidth: '260px', className: 'gl-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`<strong>🛰️ ${esc(t('sat_detection'))}</strong><br>
                ${esc(fmtDate(pr.observedAt))}${conf ? `<br>${esc(t('filter_sat_conf'))} : ${esc(conf)}` : ''}
                ${pr.frp > 0 ? `<br><span class="muted">${esc(t('gl_frp', { n: Math.round(pr.frp) }))}</span>` : ''}`)
              .addTo(S.gl);
          });
          S.gl.on('mouseenter', 'det-core', () => { S.gl.getCanvas().style.cursor = 'pointer'; });
          S.gl.on('mouseleave', 'det-core', () => { S.gl.getCanvas().style.cursor = ''; });
          S.gl.on('moveend', () => {
            scheduleLoad();
            // Miroir vers Leaflet : la vue mémorisée et la reprise Leaflet
            // restent justes (garde anti-boucle, jamais d'animation).
            if (S.syncing) return;
            S.syncing = true;
            const c = S.gl.getCenter();
            map.setView([c.lat, c.lng], Math.round(S.gl.getZoom()) + 1, { animate: false });
            S.syncing = false;
          });
          S.gl.once('render', () => {
            window.__glPerf = { ...(window.__glPerf || {}), firstRenderMs: Math.round(performance.now() - t0) };
          });
          S.gl.once('idle', () => {
            window.__glPerf = { ...(window.__glPerf || {}), firstIdleMs: Math.round(performance.now() - t0) };
          });
          loadVisible();
        });
      } else {
        S.wrap.style.display = '';
        S.syncing = true;
        S.gl.jumpTo({ center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() - 1 });
        S.syncing = false;
        S.gl.resize();
        loadVisible();
      }
      S.active = true;
      window.__glPerf = { ...(window.__glPerf || {}), initMs: Math.round(performance.now() - t0) };
      window.track?.('fire_gl_activated', {});
    } catch { markFailed('init'); }
  }

  function deactivate() {
    if (S.wrap) S.wrap.style.display = 'none';
    for (const ctl of inflight.values()) ctl.abort();
    inflight.clear(); pending = [];
    if (S.active) window.track?.('fire_gl_deactivated', {});
    S.active = false;
  }

  // ── Branchements : drapeau serveur + entrée/sortie du mode feux ────────────
  window.kifehGLBoot = (cfg) => {
    if (cfg?.fireMapLibre !== true || LITE) return; // éteint = strictement rien
    S.armed = true;
    if (S.wanted) activate();
  };
  document.addEventListener('kifeh:fire-mode', (e) => {
    S.wanted = Boolean(e.detail?.on);
    if (S.wanted) activate(); else deactivate();
  });
  // Leaflet bouge pendant que le GL est actif (navigation programmée) : miroir.
  map.on('moveend', () => {
    if (!S.active || S.syncing) return;
    S.syncing = true;
    S.gl.jumpTo({ center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() - 1 });
    S.syncing = false;
  });
  // Sondes de test (lecture seule + activation forcée pour la mesure de perf).
  window.kifehGLState = () => ({ armed: S.armed, wanted: S.wanted, active: S.active, failed: S.failed, reason: S.failReason || null, cells: lru.size });
  window.kifehGLHelpers = { ageClass, cellKeys, cellStep };
})();
