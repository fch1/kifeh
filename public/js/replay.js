// Replay (#110 + #123) — « Voir l'évolution » en mode feux.
// OPTIONNEL et jamais intrusif : une entrée dans la bande mode feux, une
// frise en bas, une bannière claire « Vous regardez le passé », un retour
// au direct en un geste. HONNÊTETÉ : le replay ne montre que ce qui était
// CONNU à l'instant T (détections satellite observées avant T, contours déjà
// publiés à T — l'API s'en charge) ; les signalements citoyens et la météo,
// non rejouables, sont masqués pendant le replay — jamais montrés « au
// présent » dans une vue du passé.
// #123 : fenêtres 24 h / 72 h / 10 j, passages satellite marqués sur la
// frise, avance rapide DÉTERMINISTE sur les périodes vides, partage d'un
// instant précis (?replay=1&t=ISO), entrée directe par lien profond.
// Script CLASSIQUE ordonné (après home-layers.js) : partage la portée globale
// (map, t, esc, fmtDate, API, cluster, weatherLayer, burntLayer, roadsLayer…).
'use strict';

(function kifehReplay() {
  const WINDOWS = [24, 72, 240]; // heures — 10 j = borne serveur de la timeline
  const PLAY_STEP_H = 3;      // pas de lecture (respect du rate-limit)
  const SPEEDS = [1, 4, 12];  // ×1 = 1 s/image, ×4 = 250 ms, ×12 = ~83 ms (borné par le réseau)
  const R = {
    enabled: true,            // actif par défaut — la config serveur peut couper (fireReplay:false)
    active: false,
    windowH: 72,              // fenêtre courante (24 / 72 / 240)
    offsetH: 0,               // 0 = maintenant, windowH = début de fenêtre (curseur inversé)
    speedIdx: 1,
    playing: false,
    timer: null,
    inflight: false,
    cache: new Map(),         // hourKey → payload (LRU 80)
    buckets: new Map(),       // hourKey → nombre de détections (passages satellite)
    layer: null,              // L.layerGroup des éléments rejoués
    hidden: [],               // couches du direct retirées pendant le replay
    openedAt: 0,
  };

  const hourISO = (offsetH) => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - offsetH);
    return d.toISOString();
  };
  const windowLabel = (h) => (h === 240 ? t('replay_win_10d') : t('replay_win_h', { n: h }));

  function cacheGet(k) {
    if (!R.cache.has(k)) return null;
    const v = R.cache.get(k);
    R.cache.delete(k); R.cache.set(k, v);
    return v;
  }
  function cacheSet(k, v) {
    R.cache.set(k, v);
    while (R.cache.size > 80) R.cache.delete(R.cache.keys().next().value);
  }

  async function frameData(offsetH) {
    const at = hourISO(offsetH);
    const hit = cacheGet(at);
    if (hit) return hit;
    if (R.inflight) return null; // une seule requête en vol — la lecture attend
    R.inflight = true;
    try {
      const b = map.getBounds();
      const d = await API.get(`/api/fire/map?${new URLSearchParams({
        minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
        minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
        at,
        country: currentCountry(), // explicite : /api/fire/* ne le déduit pas
      })}`);
      cacheSet(at, d);
      return d;
    } catch { return null; } finally { R.inflight = false; }
  }

  // Passages satellite de la fenêtre : la frise porte un repère par heure où
  // au moins une observation existe — et la lecture SAUTE les heures vides
  // (déterministe : mêmes données → même parcours).
  async function loadTicks() {
    R.buckets = new Map();
    try {
      const b = map.getBounds();
      const d = await API.get(`/api/fire/timeline?${new URLSearchParams({
        minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
        minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
        from: hourISO(R.windowH), to: hourISO(0),
        country: currentCountry(),
      })}`);
      for (const row of d?.detections || []) R.buckets.set(row.h, row.n);
    } catch { /* frise sans repères : la lecture reste possible */ }
    renderTicks();
  }
  function renderTicks() {
    const wrap = document.getElementById('rpTicks');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!R.buckets.size) return;
    const max = Math.max(...R.buckets.values());
    for (const [h, n] of R.buckets) {
      const off = Math.round((Date.now() - Date.parse(h)) / 3600_000);
      if (off < 0 || off > R.windowH) continue;
      const dot = document.createElement('span');
      dot.className = 'rp-tick';
      dot.style.insetInlineStart = `${(((R.windowH - off) / R.windowH) * 100).toFixed(2)}%`;
      dot.style.opacity = String(0.35 + 0.65 * (n / max));
      wrap.appendChild(dot);
    }
  }
  // Détections observées dans l'intervalle ]a, b] heures (a > b, en offsets).
  function detectionsBetween(aOffset, bOffset) {
    let n = 0;
    for (const [h, c] of R.buckets) {
      const off = (Date.now() - Date.parse(h)) / 3600_000;
      if (off <= aOffset && off > bOffset) n += c;
    }
    return n;
  }

  // Rendu d'une image : détections (couleur par âge RELATIF À T) + contours.
  function renderFrame(d, offsetH) {
    if (!R.layer) return;
    R.layer.clearLayers();
    const tRef = Date.parse(hourISO(offsetH));
    for (const a of d?.burnedAreas || []) {
      if (!Array.isArray(a.rings?.[0])) continue;
      R.layer.addLayer(L.polygon(a.rings, {
        color: '#6E4A33', weight: 2, fillColor: '#7A5238', fillOpacity: .3,
        dashArray: '5 3', interactive: false,
      }));
    }
    for (const x of d?.detections || []) {
      const ageH = (tRef - Date.parse(x.observedAt)) / 3600_000;
      const op = ageH < 3 ? .95 : ageH < 6 ? .8 : ageH < 12 ? .65 : ageH < 24 ? .5 : .35;
      const rad = 5 + Math.min(3, Math.sqrt(Math.min(x.frp || 0, 300)) * .18);
      R.layer.addLayer(L.circleMarker([x.lat, x.lng], {
        radius: rad, stroke: true, weight: 1, color: '#fff',
        fillColor: '#E8432E', fillOpacity: op, interactive: false,
      }));
    }
    const lbl = document.getElementById('rpTime');
    if (lbl) lbl.textContent = fmtDate(hourISO(offsetH));
    const empty = document.getElementById('rpEmpty');
    if (empty) empty.hidden = Boolean((d?.detections || []).length || (d?.burnedAreas || []).length);
    const banner = document.getElementById('replayBanner');
    if (banner) banner.querySelector('strong').textContent = t('replay_banner', { t: fmtDate(hourISO(offsetH)) });
  }

  async function showFrame(offsetH) {
    R.offsetH = Math.min(R.windowH, Math.max(0, offsetH));
    const slider = document.getElementById('rpSlider');
    if (slider && Number(slider.value) !== R.windowH - R.offsetH) slider.value = R.windowH - R.offsetH;
    const d = await frameData(R.offsetH);
    if (d && R.active) renderFrame(d, R.offsetH);
    return Boolean(d);
  }

  function stopPlaying() {
    R.playing = false;
    clearTimeout(R.timer);
    const b = document.getElementById('rpPlay');
    if (b) { b.textContent = '▶'; b.setAttribute('aria-label', t('replay_play')); }
  }
  function schedule() {
    clearTimeout(R.timer);
    R.timer = setTimeout(async () => {
      if (!R.playing || !R.active) return;
      if (R.offsetH <= 0) { stopPlaying(); return; } // arrivé au présent
      // Avance : un pas — puis SAUT des pas totalement vides (jusqu'à 4,
      // jamais au-delà du présent) : les périodes sans passage défilent vite,
      // les passages ralentissent d'eux-mêmes.
      let next = R.offsetH - PLAY_STEP_H;
      let skips = 0;
      while (next > 0 && skips < 4 && R.buckets.size
        && detectionsBetween(next, Math.max(0, next - PLAY_STEP_H)) === 0) {
        next -= PLAY_STEP_H; skips++;
      }
      const ok = await showFrame(Math.max(0, next));
      if (!ok) { schedule(); return; } // image pas prête : on retentera
      schedule();
    }, 1000 / SPEEDS[R.speedIdx]);
  }
  function play() {
    if (R.offsetH <= 0) R.offsetH = R.windowH; // relire depuis le début
    R.playing = true;
    const b = document.getElementById('rpPlay');
    if (b) { b.textContent = '⏸'; b.setAttribute('aria-label', t('replay_pause')); }
    window.track?.('replay_played', {});
    showFrame(R.offsetH).then(() => schedule());
  }

  function setWindow(h, { keepOffset = false } = {}) {
    if (!WINDOWS.includes(h)) return;
    R.windowH = h;
    const btn = document.getElementById('rpWindow');
    if (btn) btn.textContent = windowLabel(h);
    document.getElementById('rpSlider')?.setAttribute('max', String(h));
    if (!keepOffset) R.offsetH = Math.min(R.offsetH, h);
    if (R.active) { loadTicks(); showFrame(Math.min(R.offsetH, h)); }
  }

  // opts.at : ISO d'un instant partagé → fenêtre adaptée, image FIGÉE à T
  // (jamais d'autolecture sur un lien partagé : on regarde CET instant).
  function enter(opts) {
    if (R.active || !R.enabled) return;
    R.active = true;
    R.openedAt = Date.now();
    closeSheets?.();
    // Le direct s'efface : ni signalements « du présent », ni météo, dans une
    // vue du passé — on retire, on se souvient, on restaurera.
    R.hidden = [];
    for (const ly of [cluster?.layer, typeof weatherLayer !== 'undefined' ? weatherLayer : null,
      typeof burntLayer !== 'undefined' ? burntLayer : null,
      typeof roadsLayer !== 'undefined' ? roadsLayer : null,
      typeof smokeLayer !== 'undefined' ? smokeLayer : null]) {
      if (ly && map.hasLayer(ly)) { R.hidden.push(ly); map.removeLayer(ly); }
    }
    R.layer = L.layerGroup().addTo(map);
    document.getElementById('replayBar')?.removeAttribute('hidden');
    document.getElementById('replayBanner')?.removeAttribute('hidden');
    window.track?.('replay_opened', {});

    let atOffset = null;
    const atMs = Date.parse(opts?.at || '');
    if (Number.isFinite(atMs)) {
      atOffset = Math.round((Date.now() - atMs) / 3600_000);
      atOffset = Math.min(WINDOWS[WINDOWS.length - 1], Math.max(0, atOffset));
    }
    const win = atOffset === null ? R.windowH
      : (WINDOWS.find((w) => w >= atOffset) || WINDOWS[WINDOWS.length - 1]);
    setWindow(win, { keepOffset: true });
    loadTicks();
    if (atOffset !== null) {
      R.offsetH = atOffset;
      showFrame(atOffset); // figé sur l'instant partagé
    } else {
      R.offsetH = R.windowH;
      showFrame(R.windowH).then(() => play());
    }
  }

  function exit() {
    if (!R.active) return;
    stopPlaying();
    R.active = false;
    if (R.layer) { map.removeLayer(R.layer); R.layer = null; }
    for (const ly of R.hidden) ly.addTo(map);
    R.hidden = [];
    document.getElementById('replayBar')?.setAttribute('hidden', '');
    document.getElementById('replayBanner')?.setAttribute('hidden', '');
    // Un lien partagé ne doit pas rouvrir le replay au prochain rechargement
    // APRÈS une sortie volontaire : on nettoie l'URL.
    try {
      const p = new URLSearchParams(location.search);
      if (p.has('replay') || p.has('t')) {
        p.delete('replay'); p.delete('t');
        history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : '') + location.hash);
      }
    } catch { /* URL intouchée : sans conséquence */ }
    window.track?.('replay_exited', { seconds_used: Math.round((Date.now() - R.openedAt) / 1000) });
  }

  async function shareInstant(btn) {
    const c = map.getCenter();
    const url = `${location.origin}/?${new URLSearchParams({
      country: currentCountry(), lang: document.documentElement.lang || 'fr',
      lat: c.lat.toFixed(4), lng: c.lng.toFixed(4), z: String(map.getZoom()),
      types: 'fire', replay: '1', t: hourISO(R.offsetH),
    })}`;
    try {
      await navigator.clipboard.writeText(url);
      const prev = btn.textContent;
      btn.textContent = t('replay_share_copied');
      setTimeout(() => { btn.textContent = prev; }, 1600);
      window.track?.('replay_shared', {});
    } catch {
      // Presse-papiers indisponible (permissions) : le lien reste utilisable.
      window.prompt(t('replay_share'), url);
    }
  }

  // ── Branchements ───────────────────────────────────────────────────────────
  window.kifehReplayBoot = (cfg) => { R.enabled = cfg?.fireReplay !== false; };
  window.kifehReplayEnabled = () => R.enabled;
  window.kifehReplayEnter = enter;   // appelé par la bande mode feux + lien profond
  window.kifehReplayState = () => ({
    active: R.active, offsetH: R.offsetH, playing: R.playing,
    cached: R.cache.size, windowH: R.windowH, ticks: R.buckets.size,
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#rpExit') || e.target.closest('#replayBanner')) { exit(); return; }
    if (e.target.closest('#rpPlay')) { R.playing ? stopPlaying() : play(); return; }
    if (e.target.closest('#rpShare')) { shareInstant(e.target.closest('#rpShare')); return; }
    if (e.target.closest('#rpWindow')) {
      const next = WINDOWS[(WINDOWS.indexOf(R.windowH) + 1) % WINDOWS.length];
      stopPlaying();
      setWindow(next);
      window.track?.('replay_window_changed', { hours: next });
      return;
    }
    if (e.target.closest('#rpSpeed')) {
      R.speedIdx = (R.speedIdx + 1) % SPEEDS.length;
      const b = document.getElementById('rpSpeed');
      if (b) b.textContent = `×${SPEEDS[R.speedIdx]}`;
      if (R.playing) schedule();
    }
  });
  document.getElementById('rpSlider')?.addEventListener('input', (e) => {
    stopPlaying();
    clearTimeout(R._scrub);
    const v = Number(e.target.value);
    R._scrub = setTimeout(() => showFrame(R.windowH - v), 250);
  });
  // Sortie du mode feux (filtres) pendant un replay → retour au direct propre.
  document.addEventListener('kifeh:fire-mode', (e) => { if (!e.detail?.on) exit(); });
  map.on('moveend', () => { if (R.active && !R.playing) { showFrame(R.offsetH); loadTicks(); } });
})();
