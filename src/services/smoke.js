// SIMULATION INDICATIVE DE FUMÉE (master feux §6.4 — décision de charte du
// 04/08). Ce module est VOLONTAIREMENT pur et déterministe : mêmes entrées →
// mêmes bouffées, aucun aléa d'horloge ni de Math.random (la « graine » est
// un hachage stable de l'identifiant de détection).
//
// CE QUE C'EST : une construction visuelle simple — émission proportionnelle
// à la FRP plafonnée, advection par le vent (u/v), élargissement √(σ₀²+2Kt),
// atténuation exponentielle, durée de vie bornée à 6 h.
// CE QUE CE N'EST PAS (et ne doit JAMAIS devenir) : une observation de fumée,
// une mesure de qualité de l'air, une prévision sanitaire, une heure
// d'arrivée, une trajectoire d'incendie. Les libellés de l'interface le
// disent en permanence — pas seulement dans une infobulle.
'use strict';

// ── Constantes du modèle (documentées dans docs/FIRE_SMOKE_MODEL.md) ─────────
export const SMOKE = {
  MAX_AGE_H: 6,          // durée de vie maximale d'une contribution
  STEP_MIN: 20,          // pas d'échantillonnage du panache (minutes)
  FRP_CAP_MW: 300,       // plafond de contribution d'UNE détection (jamais ∝ à l'infini)
  SIGMA0_M: 250,         // largeur initiale du panache (m)
  K_M2S: 45,             // coefficient de diffusion simple (m²/s)
  TAU_H: 2.5,            // constante d'atténuation temporelle (heures)
  OPACITY0: 0.34,        // opacité de départ (avant facteurs FRP/âge)
  MAX_PUFFS_PER_DET: 18, // bornes dures — jamais une tempête de dessin
  MAX_PUFFS_TOTAL: 400,
  MAX_PUFFS_TOTAL_LITE: 140, // mode performance réduite
};

const DEG_LAT_M = 111_320; // mètres par degré de latitude (approx. sphérique)

// Conversion direction météo (« d'où vient le vent », degrés) + vitesse (m/s)
// → composantes u (vers l'est) / v (vers le nord).
//   u = −V · sin(θ)   v = −V · cos(θ)
// Vent du nord (θ=0) → v négatif : l'air VA vers le sud. Testé sur N/S/E/O
// et direction intermédiaire (tests §19.1).
export function windUV(speedMS, directionFromDeg) {
  const th = ((Number(directionFromDeg) || 0) * Math.PI) / 180;
  const V = Math.max(0, Number(speedMS) || 0);
  return { u: -V * Math.sin(th), v: -V * Math.cos(th) };
}

// Pseudo-aléa DÉTERMINISTE depuis une chaîne (graine = id de détection) :
// même détection → même léger étalement latéral, à chaque calcul, partout.
export function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Simule les bouffées visibles « maintenant » pour un jeu de détections.
//   detections : [{ id, lat, lng, frp, observedAt }] (dédupliquées en amont)
//   windFor    : (lat, lng) → { speedMS, directionFromDeg } | null
//   nowMs      : horloge INJECTÉE (déterminisme des tests)
//   lite       : mode performance réduite (moins de bouffées)
// Retour : { puffs: [{ lat, lng, rM, op }], truncated }
export function simulateSmoke({ detections = [], windFor, nowMs = Date.now(), lite = false } = {}) {
  const maxTotal = lite ? SMOKE.MAX_PUFFS_TOTAL_LITE : SMOKE.MAX_PUFFS_TOTAL;
  const puffs = [];
  let truncated = false;

  for (const d of detections) {
    if (puffs.length >= maxTotal) { truncated = true; break; }
    const t0 = Date.parse(d.observedAt || '');
    if (!Number.isFinite(t0)) continue;
    const ageMs = nowMs - t0;
    if (ageMs < 0 || ageMs > SMOKE.MAX_AGE_H * 3600_000) continue; // 6 h max — jamais au-delà
    const wind = windFor ? windFor(d.lat, d.lng) : null;
    if (!wind) continue; // pas de vent connu → pas de panache inventé
    const { u, v } = windUV(wind.speedMS, wind.directionFromDeg);
    const frp = Math.min(Math.max(0, Number(d.frp) || 0), SMOKE.FRP_CAP_MW);
    const strength = 0.35 + 0.65 * (frp / SMOKE.FRP_CAP_MW); // 0.35..1 — jamais 0 ni > 1
    // Étalement latéral déterministe (graine = id) : ±12° autour du flux.
    const jitter = (hash01(d.id || `${d.lat},${d.lng}`) - 0.5) * (Math.PI / 7.5);
    const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter);
    const uj = u * cosJ - v * sinJ, vj = u * sinJ + v * cosJ;

    const stepS = SMOKE.STEP_MIN * 60;
    const steps = Math.min(SMOKE.MAX_PUFFS_PER_DET, Math.floor(ageMs / (stepS * 1000)));
    for (let i = 1; i <= steps; i++) {
      if (puffs.length >= maxTotal) { truncated = true; break; }
      const tS = i * stepS; // âge de la bouffée (s) — position(t+Δt) = position + vent×Δt
      const dLat = (vj * tS) / DEG_LAT_M;
      const cosLat = Math.max(0.2, Math.cos((d.lat * Math.PI) / 180)); // latitude RESPECTÉE
      const dLng = (uj * tS) / (DEG_LAT_M * cosLat);
      const sigma = Math.sqrt(SMOKE.SIGMA0_M ** 2 + 2 * SMOKE.K_M2S * tS); // σ(t)=√(σ₀²+2Kt)
      const op = SMOKE.OPACITY0 * strength * Math.exp(-(tS / 3600) / SMOKE.TAU_H);
      if (op < 0.02) break; // invisible : on arrête ce panache
      puffs.push({
        lat: +(d.lat + dLat).toFixed(5),
        lng: +(d.lng + dLng).toFixed(5),
        rM: Math.round(sigma * 2.2),
        op: +op.toFixed(3),
      });
    }
  }
  return { puffs, truncated };
}
