// Utilitaires carte Leaflet : fond OSM, marqueurs par type, clustering léger.
'use strict';

// Fournisseurs de fond de carte : AUCUNE URL en dur dans le composant carte.
// Liste par défaut (remplacée par la configuration serveur dès qu'elle arrive) ;
// bascule automatique en cas d'échecs répétés (403, 429, 5xx, timeout, blocage
// navigateur) en conservant zoom, centre, marqueurs et incident sélectionné.
let TILE_PROVIDERS = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' },
];
let TILE_FAIL_THRESHOLD = 6;
function setTileProviders(providers, threshold) {
  if (Array.isArray(providers) && providers.length) TILE_PROVIDERS = providers;
  if (threshold > 0) TILE_FAIL_THRESHOLD = threshold;
}

// Attache le fond de carte avec bascule automatique. deferred = mode léger :
// pas de tuiles tant que l'utilisateur ne les demande pas.
function attachTiles(map, { deferred = false } = {}) {
  const state = { index: 0, errors: 0, layer: null, exhausted: false };
  map._tileState = state;
  function useProvider(i) {
    if (state.layer) { map.removeLayer(state.layer); state.layer = null; }
    if (i >= TILE_PROVIDERS.length) {
      // Tous les fournisseurs indisponibles : fond neutre, l'application reste
      // entièrement utilisable (liste, recherche, filtres, déclaration).
      state.exhausted = true;
      document.dispatchEvent(new CustomEvent('kifeh:tiles-failed'));
      return;
    }
    state.index = i; state.errors = 0;
    const p = TILE_PROVIDERS[i];
    state.layer = L.tileLayer(p.url, { maxZoom: 19, attribution: p.attribution, crossOrigin: 'anonymous' });
    state.layer.on('tileerror', () => {
      state.errors++;
      if (state.errors >= TILE_FAIL_THRESHOLD) {
        // Pas de boucle infinie : on abandonne ce fournisseur définitivement.
        useProvider(state.index + 1);
      }
    });
    state.layer.on('tileload', () => {
      state.errors = 0;
      document.dispatchEvent(new CustomEvent('kifeh:tiles-ok'));
    });
    state.layer.addTo(map); // zoom/centre/marqueurs inchangés : seule la couche de fond change
  }
  map._loadTiles = () => { if (!state.layer && !state.exhausted) useProvider(0); };
  if (!deferred) useProvider(0);
  return map;
}

function createMap(el, opts = {}) {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    ...opts,
  }).setView(opts.center || [34.2, 9.6], opts.zoom || 6); // Tunisie par défaut
  attachTiles(map, { deferred: opts.deferTiles === true });
  // zoomless : la page fournit ses propres boutons (pile flottante de
  // l'accueil) — pas de double commande de zoom.
  if (opts.zoomless !== true) L.control.zoom({ position: 'bottomright' }).addTo(map);
  return map;
}

function typeIcon(type, status) {
  const resolved = status === 'resolved' || status === 'expired' ? ' resolved' : '';
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin ${type}${resolved}"><span>${TYPE_ICONS[type] || '•'}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 30],
  });
}

// Regroupement simple par grille écran (sans dépendance markercluster) :
// robuste en WebView et suffisant pour plusieurs centaines d'incidents.
class GridCluster {
  constructor(map, onMarkerClick) {
    this.map = map;
    this.layer = L.layerGroup().addTo(map);
    this.onMarkerClick = onMarkerClick;
    this.items = [];
    map.on('zoomend moveend', () => this.render());
  }
  setItems(items) { this.items = items; this.render(); }
  render() {
    this.layer.clearLayers();
    const zoom = this.map.getZoom();
    if (zoom >= 15) { // assez zoomé : tous les marqueurs individuellement
      for (const it of this.items) this.addMarker(it);
      return;
    }
    const cell = 60; // pixels
    const buckets = new Map();
    for (const it of this.items) {
      const p = this.map.latLngToContainerPoint([it.lat, it.lng]);
      const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    for (const group of buckets.values()) {
      if (group.length === 1) { this.addMarker(group[0]); continue; }
      const lat = group.reduce((s, i) => s + i.lat, 0) / group.length;
      const lng = group.reduce((s, i) => s + i.lng, 0) / group.length;
      const m = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: `<div class="cluster-badge">${group.length}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
        keyboard: true, title: t('cluster_title', { n: group.length }),
      });
      m.on('click', () => this.map.setView([lat, lng], Math.min(this.map.getZoom() + 2, 18)));
      this.layer.addLayer(m);
    }
  }
  addMarker(it) {
    // Détection satellite : marqueur visuellement distinct des signalements citoyens.
    const m = L.marker([it.lat, it.lng], it.satellite ? {
      icon: satelliteIcon(it.max_confidence, it.last_detected_at), keyboard: true,
      title: `${t('sat_detection')} — NASA FIRMS`,
    } : {
      icon: typeIcon(it.type, it.status), keyboard: true,
      title: `${TYPE_LABELS[it.type]} — ${STATUS_LABELS[it.status] || it.status}`,
    });
    // « Zone d'activité observée par satellite » : cercle doux, VISIBLEMENT
    // approximatif, uniquement à un zoom local — jamais un « périmètre ».
    if (it.satellite && it.activityRadiusM && this.map.getZoom() >= 10) {
      this.layer.addLayer(L.circle([it.lat, it.lng], {
        radius: it.activityRadiusM, color: '#C4622D', weight: 1, dashArray: '4 6',
        fillColor: '#C4622D', fillOpacity: 0.10, interactive: false,
      }));
    }
    m.on('click', () => this.onMarkerClick?.(it));
    this.layer.addLayer(m);
  }
}

// Marqueur « détection satellite » (contour pointillé, icône satellite).
// UNE SEULE donnée feu sur la carte : un feu observé par satellite est un
// FEU (même pin 🔥 que les signalements) — la SOURCE est portée par la
// pastille 🛰️ et le contour pointillé, jamais par une iconographie à part.
function satelliteIcon(confidence, lastDetectedAt) {
  // Classes d'ÂGE (master UX §11 — lisibilité par ancienneté) : une détection
  // récente domine visuellement ; 6-24 h s'estompe ; 24-72 h devient discrète.
  // L'heure exacte reste toujours dans la fiche — l'âge n'est jamais porté
  // par la seule opacité.
  const ageH = lastDetectedAt ? (Date.now() - Date.parse(lastDetectedAt)) / 3600_000 : 0;
  const ageClass = ageH >= 24 ? ' sat-age-old' : (ageH >= 6 ? ' sat-age-mid' : '');
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin fire marker-sat-pin ${confidence === 'high' ? 'high' : ''}${ageClass}">
      <span>🔥</span><em class="sat-dot" aria-hidden="true">🛰️</em></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 30],
  });
}
