// Kifeh — couches de carte de l'accueil (scindé de home.js, dette technique) :
// voile météo + flèches de vent, zones brûlées Copernicus EFFIS, entraves
// routières Bison Futé. Scripts CLASSIQUES ordonnés (aucun bundler) : ce
// fichier se charge APRÈS home.js et partage sa portée globale — il n'utilise
// que des fonctions déjà déclarées (t, esc, fmtDate, openSheet, map, API…).
// ═════════════════════════════════════════════════════════════════════════════
// Météo SUR LA CARTE (France) : un voile de couleur (température) + des
// flèches orientées par le vrai vent. Activable d'un geste (bouton 🌡️),
// désactivé par défaut (légèreté), redessiné au déplacement — jamais pendant.
// Les couleurs de température ne sont JAMAIS le rouge « danger » des feux ;
// les marqueurs d'incident restent toujours AU-DESSUS du voile météo.
// ═════════════════════════════════════════════════════════════════════════════
const weatherLayer = L.layerGroup();
let weatherOn = false;
let weatherTimer = null;

function tempFill(c) {
  if (c >= 34) return '#C4622D';
  if (c >= 28) return '#E8A34D';
  if (c >= 20) return '#F7D774';
  return '#7FB3D5';
}

async function drawWeatherLayer() {
  if (!weatherOn || currentCountry() !== 'FR') return;
  const b = map.getBounds();
  let r;
  try {
    r = await API.get(`/api/fire-situation/weather-grid?${new URLSearchParams({
      minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
      minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
    })}`);
  } catch { r = null; }
  weatherLayer.clearLayers();
  if (!r?.enabled || !r.grid?.cells?.length) {
    if (weatherOn) transientBanner(t('wx_layer_unavailable'));
    return;
  }
  const g = r.grid;
  window._lastWxAt = g.updatedAt || window._lastWxAt;
  // Panne amont : la DERNIÈRE grille connue s'affiche avec son heure réelle
  // (« météo de HH:MM ») — informative, jamais présentée comme fraîche.
  if (g.stale && g.updatedAt) {
    const hm = new Date(g.updatedAt).toLocaleTimeString(LANG === 'ar' ? 'ar-TN' : 'fr-FR',
      { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    transientBanner(t('wx_layer_stale', { t: hm }));
  }
  for (const c of g.cells) {
    // Voile de température : cercles LARGES qui se chevauchent et se fondent —
    // un vrai nuage de couleur, sans coutures ni damier (les rectangles à
    // bords durs créaient des croix blanches entre cellules).
    const radiusM = map.distance([c.lat, c.lng],
      [c.lat + g.stepLat / 2, c.lng + g.stepLng / 2]) * 1.45;
    L.circle([c.lat, c.lng], {
      radius: radiusM, stroke: false, fillColor: tempFill(c.tempC),
      fillOpacity: 0.16, interactive: false,
    }).addTo(weatherLayer);
    // Flèche de vent au centre de la cellule (16 max — jamais une forêt de
    // flèches) : orientée VERS où souffle le vent, taille selon la force.
    if (c.windToDeg != null && c.windKmh != null) {
      const size = c.windKmh >= 30 ? 1.25 : c.windKmh >= 15 ? 1.05 : 0.85;
      L.marker([c.lat, c.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: '',
          html: `<div class="wx-arrow" style="transform:rotate(${(c.windToDeg - 90 + 360) % 360}deg);font-size:${size}rem">➤</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        }),
      }).addTo(weatherLayer);
    }
  }
  // Légende contextuelle compacte (repliable d'un tap sur le bouton).
  const legend = document.getElementById('wxLegend');
  if (legend) {
    legend.hidden = false;
    legend.innerHTML = `
      <span class="wx-leg-scale" aria-hidden="true"></span>
      <span class="small">${esc(t('wx_legend_temp'))}</span>
      <span class="small">➤ ${esc(t('wx_legend_wind'))}</span>
      <span class="muted small">${esc(t('wx_legend_at', { t: fmtDate(g.updatedAt) }))}</span>`;
  }
  window.track?.('weather_layer_drawn', { cells: g.cells.length });
}

function toggleWeatherLayer() {
  weatherOn = !weatherOn;
  const cb = document.getElementById('fWxLayer');
  if (cb) cb.checked = weatherOn;
  if (weatherOn) {
    weatherLayer.addTo(map);
    drawWeatherLayer();
    window.track?.('weather_layer_on', {});
  } else {
    weatherLayer.clearLayers();
    map.removeLayer(weatherLayer);
    const legend = document.getElementById('wxLegend');
    if (legend) legend.hidden = true;
  }
  try { localStorage.setItem('kifeh_weather_layer', weatherOn ? '1' : '0'); } catch {}
}

// Couche météo (France uniquement) + redessin après déplacement.
(function initWeatherLayer() {
  if (currentCountry() !== 'FR') return;
  const row = document.getElementById('wxRow');
  const cb = document.getElementById('fWxLayer');
  if (!row || !cb) return;
  row.hidden = false;
  cb.addEventListener('change', () => {
    window.track?.(cb.checked ? 'layer_enabled' : 'layer_disabled', { layer_name: 'weather' });
    toggleWeatherLayer();
  });
  map.on('moveend', () => {
    if (!weatherOn) return;
    clearTimeout(weatherTimer);
    weatherTimer = setTimeout(drawWeatherLayer, 450); // jamais pendant le geste
  });
  let saved = null;
  try { saved = localStorage.getItem('kifeh_weather_layer'); } catch {}
  // Visible AU PREMIER REGARD : le voile météo est ACTIF par défaut en France
  // (jamais en mode léger) ; le choix de le couper est respecté et mémorisé.
  if (saved !== '0' && !LITE) toggleWeatherLayer();
  document.getElementById('wxStrip')?.addEventListener('click', openVigilanceSheet);
})();

// ═════════════════════════════════════════════════════════════════════════════
// Zones brûlées Copernicus EFFIS (France) : contours APPROXIMATIFS du
// périmètre déjà brûlé, estimés par satellite. Brun assumé (jamais le rouge
// « danger » des feux actifs) ; un tap ouvre la fiche honnête (surface, date,
// source, limites). Visible dès le zoom 7 — au-delà, de simples poussières.
// ═════════════════════════════════════════════════════════════════════════════
const burntLayer = L.layerGroup();
let burntTimer = null;
let burntOn = true; // visible par défaut (rare et signifiant) — désactivable

async function drawBurntAreas() {
  if (currentCountry() !== 'FR' || LITE || !burntOn) {
    if (!burntOn) {
      burntLayer.clearLayers();
      const lg = document.getElementById('burntLegend');
      if (lg) lg.hidden = true;
    }
    return;
  }
  const legend = document.getElementById('burntLegend');
  const b = map.getBounds();
  let r;
  try {
    r = await API.get(`/api/fire-situation/burnt-areas?${new URLSearchParams({
      minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
      minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
    })}`);
  } catch { r = null; }
  burntLayer.clearLayers();
  if (r?.updatedAt) window._lastBurntAt = r.updatedAt;
  const any = Boolean(r?.enabled && r.areas?.length);
  if (legend) {
    legend.hidden = !any;
    if (any) legend.innerHTML = `<span class="burnt-swatch" aria-hidden="true"></span>
      <span class="small">${esc(t('burnt_legend'))}</span>`;
  }
  if (!any) return;
  // Aux petits zooms (vue nationale/régionale), un polygone de 2 km est
  // INVISIBLE : on dessine un point brun tappable à sa place — le contour
  // précis apparaît dès le zoom 8. Retour du 28/07 : « je ne vois pas EFFIS ».
  const detailed = map.getZoom() >= 8;
  for (const a of r.areas) {
    const shape = detailed
      ? L.polygon(a.rings, {
        color: '#6E4A33', weight: 2, fillColor: '#7A5238', fillOpacity: .38,
        dashArray: '5 3',
      })
      : L.circleMarker(a.centroid || a.rings?.[0]?.[0], {
        radius: 5, color: '#6E4A33', weight: 1.5, fillColor: '#7A5238', fillOpacity: .8,
      });
    shape.addTo(burntLayer);
    shape.on('click', (e) => {
      L.DomEvent.stopPropagation(e); // sinon le clic « carte » referme la fiche
      openBurntDetail(a, r.updatedAt);
    });
  }
  if (!map.hasLayer(burntLayer)) burntLayer.addTo(map);
  window.track?.('burnt_areas_drawn', { n: r.areas.length });
}

function openBurntDetail(a, updatedAt) {
  const el = document.getElementById('burntContent');
  el.innerHTML = `
    <h2>▨ ${esc(t('burnt_title'))}${a.commune ? ` — ${esc(a.commune)}` : ''}</h2>
    ${a.province ? `<p class="muted small">${esc(a.province)}</p>` : ''}
    <p>
      ${a.areaHa != null ? `<strong>${esc(t('burnt_area_ha', { n: a.areaHa }))}</strong><br>` : ''}
      ${a.firedate ? `${esc(t('burnt_firedate', { d: fmtDate(a.firedate) }))}<br>` : ''}
      ${updatedAt ? `<span class="muted small">${esc(t('burnt_updated', { d: fmtDate(updatedAt) }))}</span>` : ''}
    </p>
    <p class="notice sat">🛰️ <strong>${esc(t('burnt_source'))}</strong></p>
    <p class="muted small">${esc(t('burnt_honesty'))}</p>`;
  openSheet('burntSheet');
  window.track?.('burnt_detail_opened', {});
}

(function initBurntAreas() {
  if (currentCountry() !== 'FR' || LITE) return;
  map.on('moveend', () => {
    clearTimeout(burntTimer);
    burntTimer = setTimeout(drawBurntAreas, 500); // jamais pendant le geste
  });
  // Bascule dans le panneau Couches — choix mémorisé, ON par défaut.
  const row = document.getElementById('fBurntRow');
  const cb = document.getElementById('fBurntLayer');
  try { burntOn = localStorage.getItem('kifeh_burnt_layer') !== '0'; } catch {}
  if (row && cb) {
    row.hidden = false;
    cb.checked = burntOn;
    cb.addEventListener('change', () => {
      window.track?.(cb.checked ? 'layer_enabled' : 'layer_disabled', { layer_name: 'burned_areas' });
      burntOn = cb.checked;
      try { localStorage.setItem('kifeh_burnt_layer', burntOn ? '1' : '0'); } catch {}
      drawBurntAreas();
    });
  }
  burntLayer.addTo(map);
  drawBurntAreas();
})();

// ═════════════════════════════════════════════════════════════════════════════
// Routes barrées & entraves — Bison Futé (DATEX II, DIR). Couche OPTIONNELLE
// (jamais active par défaut : chaque calque secondaire se choisit), marqueurs
// 🚧 sobres, fiche avec type, route, depuis quand, source et limites.
// ═════════════════════════════════════════════════════════════════════════════
const roadsLayer = L.layerGroup();
let roadsOn = false, roadsTimer = null;
const ROAD_TYPE_KEY = {
  Accident: 'road_accident',
  MaintenanceWorks: 'road_works', ConstructionWorks: 'road_works',
  RoadOrCarriagewayOrLaneManagement: 'road_mgmt', ReroutingManagement: 'road_mgmt',
  VehicleObstruction: 'road_obstruction', GeneralObstruction: 'road_obstruction',
  EnvironmentalObstruction: 'road_obstruction',
};
function roadTypeLabel(e) {
  return e.closed ? t('road_closed') : t(ROAD_TYPE_KEY[e.type] || 'road_mgmt');
}

async function drawRoads() {
  if (!roadsOn || currentCountry() !== 'FR') return;
  const b = map.getBounds();
  let r;
  try {
    r = await API.get(`/api/fire-situation/roads?${new URLSearchParams({
      minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
      minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
    })}`);
  } catch { r = null; }
  roadsLayer.clearLayers();
  if (r?.updatedAt) window._lastRoadsAt = r.updatedAt;
  if (!r?.enabled || !r.events?.length) return;
  for (const e of r.events) {
    const mk = L.marker([e.lat, e.lng], {
      keyboard: false,
      icon: L.divIcon({
        className: '',
        html: `<div class="road-pin${e.closed ? ' road-closed' : ''}">${e.closed ? '⛔' : '🚧'}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    }).addTo(roadsLayer);
    mk.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      openRoadDetail(e, r.updatedAt);
    });
  }
  window.track?.('roads_drawn', { n: r.events.length });
}

function openRoadDetail(e, updatedAt) {
  const el = document.getElementById('roadContent');
  el.innerHTML = `
    <h2>${e.closed ? '⛔' : '🚧'} ${esc(roadTypeLabel(e))}${e.road ? ` — ${esc(e.road)}` : ''}</h2>
    <p>
      ${e.start ? `${esc(t('road_since', { t: fmtDate(e.start) }))}<br>` : ''}
      ${e.end ? `${esc(t('road_until', { t: fmtDate(e.end) }))}<br>` : ''}
      ${updatedAt ? `<span class="muted small">${esc(t('burnt_updated', { d: fmtDate(updatedAt) }))}</span>` : ''}
    </p>
    <p class="notice sat">🛣️ <strong>${esc(t('road_source'))}</strong></p>
    <p class="muted small">${esc(t('road_honesty'))}</p>`;
  openSheet('roadSheet');
  window.track?.('road_detail_opened', {});
}

(function initRoadsLayer() {
  if (currentCountry() !== 'FR' || LITE) return;
  const row = document.getElementById('fRoadsRow');
  const cb = document.getElementById('fRoadsLayer');
  if (!row || !cb) return;
  row.hidden = false;
  let saved = null;
  try { saved = localStorage.getItem('kifeh_roads_layer'); } catch {}
  const apply = (on) => {
    roadsOn = on;
    cb.checked = on;
    window.track?.(on ? 'layer_enabled' : 'layer_disabled', { layer_name: 'roads' });
    if (on) { roadsLayer.addTo(map); drawRoads(); }
    else { roadsLayer.clearLayers(); map.removeLayer(roadsLayer); }
    try { localStorage.setItem('kifeh_roads_layer', on ? '1' : '0'); } catch {}
  };
  cb.addEventListener('change', () => apply(cb.checked));
  map.on('moveend', () => {
    if (!roadsOn) return;
    clearTimeout(roadsTimer);
    roadsTimer = setTimeout(drawRoads, 500);
  });
  if (saved === '1') apply(true); // choix mémorisé — jamais actif d'office
})();
