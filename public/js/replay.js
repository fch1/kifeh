// Replay 72 h (#110, master PR 5) — « Voir l'évolution » en mode feux.
// OPTIONNEL et jamais intrusif : une entrée dans la bande mode feux, une
// frise en bas, une bannière claire « Vous regardez le passé », un retour
// au direct en un geste. HONNÊTETÉ : le replay ne montre que ce qui était
// CONNU à l'instant T (détections satellite observées avant T, contours déjà
// publiés à T — l'API s'en charge) ; les signalements citoyens et la météo,
// non rejouables, sont masqués pendant le replay — jamais montrés « au
// présent » dans une vue du passé.
// Script CLASSIQUE ordonné (après home-layers.js) : partage la portée globale
// (map, t, esc, fmtDate, API, cluster, weatherLayer, burntLayer, roadsLayer…).
'use strict';

(function kifehReplay() {
  const HOURS = 72;
  const PLAY_STEP_H = 3;      // pas de lecture (24 images par balayage — respect du rate-limit)
  const SPEEDS = [1, 4, 12];  // ×1 = 1 s/image, ×4 = 250 ms, ×12 = ~83 ms (borné par le réseau)
  const R = {
    enabled: true,            // actif par défaut — la config serveur peut couper (fireReplay:false)
    active: false,
    offsetH: 0,               // 0 = maintenant, 72 = il y a 72 h (curseur inversé)
    speedIdx: 1,
    playing: false,
    timer: null,
    inflight: false,
    cache: new Map(),         // hourKey → payload (LRU 80)
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
    R.offsetH = Math.min(HOURS, Math.max(0, offsetH));
    const slider = document.getElementById('rpSlider');
    if (slider && Number(slider.value) !== HOURS - R.offsetH) slider.value = HOURS - R.offsetH;
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
      const ok = await showFrame(R.offsetH - PLAY_STEP_H);
      if (!ok) { schedule(); return; } // image pas prête : on retentera
      schedule();
    }, 1000 / SPEEDS[R.speedIdx]);
  }
  function play() {
    if (R.offsetH <= 0) R.offsetH = HOURS; // relire depuis le début
    R.playing = true;
    const b = document.getElementById('rpPlay');
    if (b) { b.textContent = '⏸'; b.setAttribute('aria-label', t('replay_pause')); }
    window.track?.('replay_played', {});
    showFrame(R.offsetH).then(() => schedule());
  }

  function enter() {
    if (R.active || !R.enabled) return;
    R.active = true;
    R.openedAt = Date.now();
    closeSheets?.();
    // Le direct s'efface : ni signalements « du présent », ni météo, dans une
    // vue du passé — on retire, on se souvient, on restaurera.
    R.hidden = [];
    for (const ly of [cluster?.layer, typeof weatherLayer !== 'undefined' ? weatherLayer : null,
      typeof burntLayer !== 'undefined' ? burntLayer : null,
      typeof roadsLayer !== 'undefined' ? roadsLayer : null]) {
      if (ly && map.hasLayer(ly)) { R.hidden.push(ly); map.removeLayer(ly); }
    }
    R.layer = L.layerGroup().addTo(map);
    document.getElementById('replayBar')?.removeAttribute('hidden');
    document.getElementById('replayBanner')?.removeAttribute('hidden');
    document.getElementById('rpSlider')?.setAttribute('max', String(HOURS));
    window.track?.('replay_opened', {});
    R.offsetH = HOURS;
    showFrame(HOURS).then(() => play());
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
    window.track?.('replay_exited', { seconds_used: Math.round((Date.now() - R.openedAt) / 1000) });
  }

  // ── Branchements ───────────────────────────────────────────────────────────
  window.kifehReplayBoot = (cfg) => { R.enabled = cfg?.fireReplay !== false; };
  window.kifehReplayEnabled = () => R.enabled;
  window.kifehReplayEnter = enter;   // appelé par la bande mode feux
  window.kifehReplayState = () => ({ active: R.active, offsetH: R.offsetH, playing: R.playing, cached: R.cache.size });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#rpExit') || e.target.closest('#replayBanner')) { exit(); return; }
    if (e.target.closest('#rpPlay')) { R.playing ? stopPlaying() : play(); return; }
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
    R._scrub = setTimeout(() => showFrame(HOURS - v), 250);
  });
  // Sortie du mode feux (filtres) pendant un replay → retour au direct propre.
  document.addEventListener('kifeh:fire-mode', (e) => { if (!e.detail?.on) exit(); });
  map.on('moveend', () => { if (R.active && !R.playing) showFrame(R.offsetH); });
})();
