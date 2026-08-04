// Replay (#110 → v2 #123) — « Voir l'évolution » en mode feux.
// V2 (référence concurrentielle) : TOUTES les observations de la fenêtre sont
// chargées EN UNE REQUÊTE, puis le temps se parcourt EN LOCAL — le curseur
// répond instantanément, la lecture est continue et fluide, zéro requête par
// image. L'HONNÊTETÉ ne change pas de camp : chaque détection porte son
// observedAt, chaque version EFFIS son publishedAt, et l'écran ne montre à T
// que ce qui était CONNU à T — la même règle que le serveur, exécutée
// localement, déterministe. Signalements citoyens et météo, non rejouables,
// restent masqués pendant le replay.
// Script CLASSIQUE ordonné (après home-layers.js) : portée globale partagée
// (map, t, esc, fmtDate, API, cluster, weatherLayer, burntLayer, roadsLayer,
// smokeLayer…).
'use strict';

(function kifehReplay() {
  const WINDOWS = [24, 72, 240];   // heures — 10 j = borne serveur
  const VISIBLE_H = 72;            // à T, une détection reste visible ≤72 h d'âge
  const SPEED_HPS = [1, 4, 12];    // ×n = n heures d'historique par seconde
  const TICK_MS = 140;             // cadence de lecture (fluide, locale)
  const R = {
    enabled: true,                 // la config serveur peut couper (fireReplay:false)
    active: false,
    windowH: 72,
    offsetH: 0,                    // heures avant maintenant (0 = présent) — flottant
    speedIdx: 1,
    playing: false,
    timer: null,
    data: null,                    // { key, detections, burned, truncated, from, to }
    dataInflight: null,
    markers: [],                   // [{ cm, tMs, bucket, on }]
    burnedShown: new Map(),        // featureId → { pubMs, layer }
    canvas: null,                  // rendu canvas dédié (des centaines de points fluides)
    layer: null,
    hidden: [],
    openedAt: 0,
    shown: 0,
  };
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const hourISO = (offsetH) => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - Math.round(offsetH));
    return d.toISOString();
  };
  const nowMs = () => Date.now();
  const tAt = (offsetH) => nowMs() - offsetH * 3600_000;
  const windowLabel = (h) => (h === 240 ? t('replay_win_10d') : t('replay_win_h', { n: h }));

  // ── Chargement : UNE requête par fenêtre × vue ─────────────────────────────
  const dataKey = () => {
    const b = map.getBounds();
    const r = (v) => Math.round(v * 20) / 20;
    return `${R.windowH}|${currentCountry()}|${r(b.getSouth())},${r(b.getWest())},${r(b.getNorth())},${r(b.getEast())}`;
  };
  async function loadWindowData() {
    const key = dataKey();
    if (R.data?.key === key || R.dataInflight === key) return;
    R.dataInflight = key;
    try {
      const b = map.getBounds();
      const d = await API.get(`/api/fire/replay?${new URLSearchParams({
        minLat: b.getSouth().toFixed(3), maxLat: b.getNorth().toFixed(3),
        minLng: b.getWest().toFixed(3), maxLng: b.getEast().toFixed(3),
        from: new Date(tAt(R.windowH)).toISOString(),
        to: new Date(tAt(0)).toISOString(),
        country: currentCountry(),
      })}`);
      if (!d?.enabled) { R.data = { key, detections: [], burned: new Map(), truncated: false }; return; }
      const burned = new Map();
      for (const v of d.burnedVersions || []) {
        const pubMs = Date.parse(v.publishedAt);
        if (!Number.isFinite(pubMs)) continue;
        if (!burned.has(v.featureId)) burned.set(v.featureId, []);
        burned.get(v.featureId).push({ pubMs, rings: v.rings, areaHa: v.areaHa });
      }
      for (const list of burned.values()) list.sort((a, b2) => b2.pubMs - a.pubMs); // récentes d'abord
      R.data = {
        key,
        detections: (d.detections || [])
          .map((x) => ({ ...x, tMs: Date.parse(x.observedAt) }))
          .filter((x) => Number.isFinite(x.tMs)),
        burned,
        truncated: Boolean(d.meta?.truncated),
      };
    } catch { /* la fenêtre précédente reste affichée — jamais un écran cassé */ }
    finally { if (R.dataInflight === dataKey() || R.dataInflight) R.dataInflight = null; }
    if (R.active && R.data) { buildMarkers(); renderTicks(); renderAxis(); renderFrame(R.offsetH); }
  }

  function buildMarkers() {
    if (!R.layer) return;
    for (const m of R.markers) { if (m.on) R.layer.removeLayer(m.cm); }
    for (const { layer } of R.burnedShown.values()) R.layer.removeLayer(layer);
    R.burnedShown.clear();
    R.markers = (R.data?.detections || []).map((x) => {
      const rad = 5 + Math.min(3, Math.sqrt(Math.min(x.frp || 0, 300)) * .18);
      return {
        tMs: x.tMs,
        bucket: -1,
        on: false,
        cm: L.circleMarker([x.lat, x.lng], {
          renderer: R.canvas, radius: rad, stroke: true, weight: 1, color: '#fff',
          fillColor: '#E8432E', fillOpacity: .9, interactive: false,
        }),
      };
    });
  }

  // ── Repères de passages + axe des jours (dérivés LOCALEMENT des données) ───
  function renderTicks() {
    const wrap = document.getElementById('rpTicks');
    if (!wrap) return;
    wrap.innerHTML = '';
    const buckets = new Map();
    for (const m of R.markers) {
      const off = (nowMs() - m.tMs) / 3600_000;
      if (off < 0 || off > R.windowH) continue;
      const h = Math.floor(off);
      buckets.set(h, (buckets.get(h) || 0) + 1);
    }
    if (!buckets.size) return;
    const max = Math.max(...buckets.values());
    for (const [h, n] of buckets) {
      const dot = document.createElement('span');
      dot.className = 'rp-tick';
      dot.style.insetInlineStart = `${(((R.windowH - h) / R.windowH) * 100).toFixed(2)}%`;
      dot.style.opacity = String(0.35 + 0.65 * (n / max));
      wrap.appendChild(dot);
    }
  }
  function renderAxis() {
    const ax = document.getElementById('rpAxis');
    if (!ax) return;
    ax.innerHTML = '';
    const lang = document.documentElement.lang === 'ar' ? 'ar-TN' : 'fr-FR';
    const fromMs = tAt(R.windowH), toMs = tAt(0);
    const marks = [];
    if (R.windowH <= 24) {
      // Fenêtre courte : un repère toutes les 6 h.
      for (let off = 6; off < R.windowH; off += 6) {
        marks.push({ ms: tAt(off), label: new Date(tAt(off)).toLocaleTimeString(lang, { hour: '2-digit' }) });
      }
    } else {
      // Frontières de JOURS (minuit local) — l'axe se lit comme un calendrier.
      const d = new Date(fromMs);
      d.setHours(24, 0, 0, 0);
      for (let ms = d.getTime(); ms < toMs; ms += 24 * 3600_000) {
        marks.push({ ms, label: new Date(ms).toLocaleDateString(lang, { weekday: 'short', day: 'numeric' }) });
      }
      if (R.windowH === 240 && marks.length > 6) {
        // 10 jours : un label sur deux (jamais une bouillie de texte).
        for (let i = 0; i < marks.length; i++) if (i % 2) marks[i].label = '';
      }
    }
    for (const mk of marks) {
      const pos = ((mk.ms - fromMs) / (toMs - fromMs)) * 100;
      if (pos <= 1 || pos >= 99) continue;
      const el = document.createElement('span');
      el.className = 'rp-ax';
      el.style.insetInlineStart = `${pos.toFixed(2)}%`;
      el.innerHTML = `<i></i>${mk.label ? `<b>${esc(mk.label)}</b>` : ''}`;
      ax.appendChild(el);
    }
  }

  // ── Une image : filtrage LOCAL de « ce qui était connu à T » ───────────────
  const OP_BUCKETS = [[3, .95], [6, .8], [12, .65], [24, .5], [VISIBLE_H, .35]];
  function bucketOf(ageH) {
    for (let i = 0; i < OP_BUCKETS.length; i++) if (ageH < OP_BUCKETS[i][0]) return i;
    return -1; // trop ancien à T → invisible
  }
  let lastLabelMin = null;
  function renderFrame(offsetH) {
    R.offsetH = Math.min(R.windowH, Math.max(0, offsetH));
    const slider = document.getElementById('rpSlider');
    const sv = Math.round(R.windowH - R.offsetH);
    if (slider && Number(slider.value) !== sv) slider.value = sv;
    if (!R.layer) return;
    const TMs = tAt(R.offsetH);
    let shown = 0;
    for (const m of R.markers) {
      const age = (TMs - m.tMs) / 3600_000;
      const b = age < 0 ? -1 : bucketOf(age);
      if (b === -1) {
        if (m.on) { R.layer.removeLayer(m.cm); m.on = false; m.bucket = -1; }
        continue;
      }
      shown++;
      if (!m.on) { m.cm.addTo(R.layer); m.on = true; }
      if (m.bucket !== b) { m.cm.setStyle({ fillOpacity: OP_BUCKETS[b][1] }); m.bucket = b; }
    }
    R.shown = shown;
    // Périmètres : la version de chaque périmètre CONNUE à T (jamais une
    // publication future) — remplacée seulement quand elle change.
    let burnedShown = 0;
    for (const [fid, versions] of (R.data?.burned || new Map())) {
      const v = versions.find((x) => x.pubMs <= TMs) || null;
      const cur = R.burnedShown.get(fid);
      if (!v) {
        if (cur) { R.layer.removeLayer(cur.layer); R.burnedShown.delete(fid); }
        continue;
      }
      burnedShown++;
      if (cur?.pubMs === v.pubMs) continue;
      if (cur) R.layer.removeLayer(cur.layer);
      const poly = L.polygon(v.rings, {
        color: '#6E4A33', weight: 2, fillColor: '#7A5238', fillOpacity: .3,
        dashArray: '5 3', interactive: false,
      }).addTo(R.layer);
      R.burnedShown.set(fid, { pubMs: v.pubMs, layer: poly });
    }
    // Libellés (heure, bannière) : au changement de MINUTE affichée seulement.
    const min = Math.floor(TMs / 60_000);
    if (min !== lastLabelMin) {
      lastLabelMin = min;
      const isoT = new Date(TMs).toISOString();
      const lbl = document.getElementById('rpTime');
      if (lbl) lbl.textContent = fmtDate(isoT);
      const banner = document.getElementById('replayBanner');
      if (banner) banner.querySelector('strong').textContent = t('replay_banner', { t: fmtDate(isoT) });
    }
    const empty = document.getElementById('rpEmpty');
    if (empty) empty.hidden = Boolean(shown || burnedShown);
  }

  // ── Lecture CONTINUE et locale ─────────────────────────────────────────────
  function stopPlaying() {
    R.playing = false;
    clearInterval(R.timer);
    const b = document.getElementById('rpPlay');
    if (b) { b.textContent = '▶'; b.setAttribute('aria-label', t('replay_play')); }
  }
  function play() {
    if (R.offsetH <= 0.01) R.offsetH = R.windowH; // relire depuis le début
    R.playing = true;
    const b = document.getElementById('rpPlay');
    if (b) { b.textContent = '⏸'; b.setAttribute('aria-label', t('replay_pause')); }
    window.track?.('replay_played', {});
    clearInterval(R.timer);
    // prefers-reduced-motion : pas d'animation continue — des pas discrets.
    const stepMode = reducedMotion();
    const tick = stepMode ? 600 : TICK_MS;
    R.timer = setInterval(() => {
      if (!R.playing || !R.active) return stopPlaying();
      const dh = stepMode ? 1 : SPEED_HPS[R.speedIdx] * (TICK_MS / 1000);
      const next = R.offsetH - (stepMode ? dh : dh);
      if (next <= 0) { renderFrame(0); stopPlaying(); return; }
      renderFrame(next);
    }, tick);
    renderFrame(R.offsetH);
  }

  function setWindow(h, { keepOffset = false } = {}) {
    if (!WINDOWS.includes(h)) return;
    R.windowH = h;
    const btn = document.getElementById('rpWindow');
    if (btn) btn.textContent = windowLabel(h);
    document.getElementById('rpSlider')?.setAttribute('max', String(h));
    if (!keepOffset) R.offsetH = Math.min(R.offsetH, h);
    if (R.active) { loadWindowData(); renderTicks(); renderAxis(); renderFrame(Math.min(R.offsetH, h)); }
  }

  // opts.at : instant partagé → fenêtre adaptée, image FIGÉE à T (jamais
  // d'autolecture sur un lien partagé : on regarde CET instant).
  function enter(opts) {
    if (R.active || !R.enabled) return;
    R.active = true;
    R.openedAt = Date.now();
    lastLabelMin = null;
    closeSheets?.();
    R.hidden = [];
    for (const ly of [cluster?.layer, typeof weatherLayer !== 'undefined' ? weatherLayer : null,
      typeof burntLayer !== 'undefined' ? burntLayer : null,
      typeof roadsLayer !== 'undefined' ? roadsLayer : null,
      typeof smokeLayer !== 'undefined' ? smokeLayer : null]) {
      if (ly && map.hasLayer(ly)) { R.hidden.push(ly); map.removeLayer(ly); }
    }
    if (!R.canvas) R.canvas = L.canvas({ padding: .4 });
    R.layer = L.layerGroup().addTo(map);
    document.getElementById('replayBar')?.removeAttribute('hidden');
    document.getElementById('replayBanner')?.removeAttribute('hidden');
    window.track?.('replay_opened', {});

    let atOffset = null;
    const atMs = Date.parse(opts?.at || '');
    if (Number.isFinite(atMs)) {
      atOffset = Math.min(WINDOWS[WINDOWS.length - 1], Math.max(0, (nowMs() - atMs) / 3600_000));
    }
    const win = atOffset === null ? R.windowH
      : (WINDOWS.find((w) => w >= atOffset) || WINDOWS[WINDOWS.length - 1]);
    setWindow(win, { keepOffset: true });
    if (atOffset !== null) {
      R.offsetH = atOffset;
      loadWindowData().then(() => renderFrame(atOffset)); // figé sur l'instant partagé
    } else {
      R.offsetH = R.windowH;
      loadWindowData().then(() => play());
    }
  }

  function exit() {
    if (!R.active) return;
    stopPlaying();
    R.active = false;
    if (R.layer) { map.removeLayer(R.layer); R.layer = null; }
    R.markers = [];
    R.burnedShown.clear();
    R.data = null;
    for (const ly of R.hidden) ly.addTo(map);
    R.hidden = [];
    document.getElementById('replayBar')?.setAttribute('hidden', '');
    document.getElementById('replayBanner')?.setAttribute('hidden', '');
    // Un lien partagé ne rouvre pas le replay après une sortie volontaire.
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
      types: 'fire', replay: '1', t: new Date(tAt(R.offsetH)).toISOString(),
    })}`;
    try {
      await navigator.clipboard.writeText(url);
      const prev = btn.textContent;
      btn.textContent = t('replay_share_copied');
      setTimeout(() => { btn.textContent = prev; }, 1600);
      window.track?.('replay_shared', {});
    } catch {
      window.prompt(t('replay_share'), url); // presse-papiers indisponible
    }
  }

  // ── Branchements ───────────────────────────────────────────────────────────
  window.kifehReplayBoot = (cfg) => { R.enabled = cfg?.fireReplay !== false; };
  window.kifehReplayEnabled = () => R.enabled;
  window.kifehReplayEnter = enter;
  window.kifehReplayState = () => ({
    active: R.active, offsetH: R.offsetH, playing: R.playing,
    windowH: R.windowH, shown: R.shown, total: R.markers.length,
    fluid: true, truncated: Boolean(R.data?.truncated),
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
      R.speedIdx = (R.speedIdx + 1) % SPEED_HPS.length;
      const b = document.getElementById('rpSpeed');
      if (b) b.textContent = `×${SPEED_HPS[R.speedIdx]}`;
      if (R.playing) play(); // recadence
    }
  });
  // Curseur : réponse IMMÉDIATE — les données sont locales, zéro réseau.
  document.getElementById('rpSlider')?.addEventListener('input', (e) => {
    stopPlaying();
    renderFrame(R.windowH - Number(e.target.value));
  });
  document.addEventListener('kifeh:fire-mode', (e) => { if (!e.detail?.on) exit(); });
  let moveT = null;
  map.on('moveend', () => {
    if (!R.active) return;
    clearTimeout(moveT);
    moveT = setTimeout(loadWindowData, 400); // nouvelle vue → nouvelles données, T conservé
  });
})();
