// Client API commun : fetch JSON (avec langue), gestion hors-ligne, échappement.
// (Les libellés, fmtDate et timeAgo sont fournis par i18n.js, chargé avant.)
'use strict';

// Sous /sandbox, toutes les requêtes API restent dans la sandbox.
const API_BASE = location.pathname.startsWith('/sandbox') ? '/sandbox' : '';

const API = {
  async call(method, url, body = null, opts = {}) {
    if (url.startsWith('/api')) url = API_BASE + url;
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
  update();
}
document.addEventListener('DOMContentLoaded', initOfflineBanner);

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
