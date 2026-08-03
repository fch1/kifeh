// Client API commun : fetch JSON (avec langue), gestion hors-ligne, échappement.
// (Les libellés, fmtDate et timeAgo sont fournis par i18n.js, chargé avant.)
'use strict';

// Sous /sandbox, toutes les requêtes API restent dans la sandbox.
const API_BASE = location.pathname.startsWith('/sandbox') ? '/sandbox' : '';

const API = {
  async call(method, url, body = null, opts = {}) {
    if (url.startsWith('/api')) url = API_BASE + url;
    // Pays consulté : ajouté à toutes les requêtes API publiques (le serveur
    // cloisonne incidents, détections satellite, annuaire et statistiques par
    // pays ; les clients historiques sans paramètre restent sur la Tunisie).
    if (method === 'GET' && (url.includes('/api/public/') || url.includes('/api/fire-situation/'))
        && !url.includes('country=') && typeof currentCountry === 'function') {
      url += `${url.includes('?') ? '&' : '?'}country=${currentCountry()}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);
    try {
      const extraHeaders = opts.fetch?.headers || {};
      const res = await fetch(url, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}),
          'X-Lang': typeof LANG !== 'undefined' ? LANG : 'fr',
          ...extraHeaders,
        },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error || `Erreur ${res.status}`, res.status, data);
      window.kifehNetOk?.(); // réponse reçue = en ligne, la bannière s'efface
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(navigator.onLine === false ? t('err_offline') : t('err_server'), 0, {});
    } finally { clearTimeout(timeout); }
  },
  get(url, opts) { return this.call('GET', url, null, opts); },
  post(url, body, opts) { return this.call('POST', url, body, opts); },
};

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

// Identifiant d'appareil pseudonymisé : évite les doubles confirmations
// (une seule confirmation / signalement de fin par personne et par incident).
// Aléatoire, sans lien avec l'identité ; haché côté serveur avant stockage.
function getDeviceId() {
  try {
    let id = localStorage.getItem('kifeh_device');
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
      localStorage.setItem('kifeh_device', id);
    }
    return id;
  } catch { return null; }
}

// Mémoire locale des actions déjà faites (état « Vous avez confirmé »).
function markDone(kind, publicId) {
  try {
    const k = `kifeh_${kind}`;
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    s[publicId] = Date.now();
    localStorage.setItem(k, JSON.stringify(s));
  } catch {}
}
function isDone(kind, publicId) {
  try { return Boolean(JSON.parse(localStorage.getItem(`kifeh_${kind}`) || '{}')[publicId]); }
  catch { return false; }
}

// Télémétrie d'erreurs : les erreurs JavaScript inattendues sont signalées au
// serveur (message tronqué, aucune donnée personnelle) — l'utilisateur, lui,
// ne voit jamais de message technique.
(function initErrorReporting() {
  let sent = 0;
  const report = (message, source) => {
    if (sent >= 3) return; // jamais de tempête de requêtes
    sent++;
    try {
      fetch(`${API_BASE}/api/public/client-error`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: String(message).slice(0, 300), source: String(source || location.pathname).slice(0, 120) }),
      }).catch(() => {});
    } catch {}
  };
  window.addEventListener('error', (e) => report(e.message, e.filename));
  window.addEventListener('unhandledrejection', (e) => report(e.reason?.message || e.reason, 'promise'));
})();

// Échappement systématique de tout contenu dynamique inséré dans le DOM.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bannière hors-ligne globale.
function initOfflineBanner() {
  let banner = document.querySelector('.offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = t('offline_banner');
    document.body.appendChild(banner);
  }
  const update = () => banner.classList.toggle('visible', navigator.onLine === false);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  // Un réveil de veille peut rater l'événement « online » : on revérifie.
  document.addEventListener('visibilitychange', update);
  // Une requête RÉUSSIE prouve la connexion, quoi qu'en dise navigator.onLine
  // (VPN, portails captifs et Wi-Fi capricieux le font mentir) : on efface.
  window.kifehNetOk = () => banner.classList.remove('visible');
  update();
}
document.addEventListener('DOMContentLoaded', initOfflineBanner);

// ── Alertes de zone (Web Push) — helpers partagés (accueil + déclaration) ───
function kifehPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function kifehUrlB64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
// Abonne cet appareil aux alertes autour de (lat, lng). Renvoie true si actif.
// Lève une erreur claire si la permission est refusée.
async function kifehSubscribePush({ lat, lng, radiusKm = 10, key, country }) {
  if (!kifehPushSupported() || !key) throw new Error('unsupported');
  window.track?.('push_permission_requested', {});
  const perm = await Notification.requestPermission();
  window.track?.(perm === 'granted' ? 'push_permission_granted' : 'push_permission_refused', {});
  if (perm !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: kifehUrlB64ToUint8(key),
  });
  await API.post('/api/public/push/subscribe', {
    subscription: sub.toJSON(), lat, lng, radiusKm, country,
  });
  return true;
}
async function kifehCurrentPushSubscription() {
  if (!kifehPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return reg ? reg.pushManager.getSubscription() : null;
}

// Anti double-soumission : désactive le bouton pendant l'action.
async function withButton(btn, fn) {
  if (btn.disabled) return;
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = prev; }
}

function toLocalInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
