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
