// Utilitaires carte Leaflet : fond OSM, marqueurs par type, clustering léger.
'use strict';

function createMap(el, opts = {}) {
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    ...opts,
  }).setView(opts.center || [34.2, 9.6], opts.zoom || 6); // Tunisie par défaut
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
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
    const m = L.marker([it.lat, it.lng], {
      icon: typeIcon(it.type, it.status), keyboard: true,
      title: `${TYPE_LABELS[it.type]} — ${STATUS_LABELS[it.status] || it.status}`,
    });
    m.on('click', () => this.onMarkerClick?.(it));
    this.layer.addLayer(m);
  }
}
