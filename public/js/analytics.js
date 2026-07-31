// Balise Google (gtag.js) — Google Analytics 4, ID : G-B33KFSSPSG.
// Mode Consentement (Consent Mode v2) avec bannière personnalisée :
// - consentement REFUSÉ par défaut : tant que le visiteur n'a pas accepté,
//   aucun cookie n'est déposé (Google ne reçoit que des signaux anonymes) ;
// - la bannière (fr/ar) propose Accepter / Refuser ; le choix est mémorisé ;
// - jamais dans la sandbox (données de test exclues des statistiques) ;
// - signaux publicitaires désactivés : mesure d'audience uniquement ;
// - GA4 anonymise les adresses IP par conception : les rapports montrent la
//   région/ville et l'appareil, jamais l'IP exacte d'un visiteur.
'use strict';

// Journal local des événements (TOUJOURS rempli, même consentement refusé :
// aucune donnée ne part — il vit dans l'onglet, pour les tests et DebugView).
window.__trackLog = [];
window.track = function (event, params) { // no-op réseau si GA absent (sandbox)
  try { window.__trackLog.push({ event, params: params || {} }); } catch {}
};

// ── Taxonomie CANONIQUE (docs/ANALYTICS_MEASUREMENT_PLAN.md) ────────────────
// Les noms historiques restent dans le code appelant ; ils sont TRADUITS ici
// vers le plan de mesure officiel — un seul vocabulaire côté GA4.
const CANON = {
  follow_sheet_opened: 'zone_follow_started',
  zone_followed: 'zone_follow_completed',
  zone_alerts_enabled: 'alert_channel_selected',
  email_alerts_subscribed: 'alert_channel_selected',
  layers_opened: 'source_panel_opened',
  vigilance_sheet_opened: 'official_update_opened',
  declare_started: 'incident_report_started',
  incident_published: 'incident_report_submitted',
  pwa_install_banner: 'pwa_install_prompted',
  locate_used: 'location_requested',
  incident_shared: 'map_shared',
};
const CANON_PARAMS = {
  zone_alerts_enabled: { alert_channel: 'push' },
  email_alerts_subscribed: { alert_channel: 'email' },
};

(function initAnalytics() {
  if (location.pathname.startsWith('/sandbox')) return;
  const GA_ID = 'G-B33KFSSPSG';
  const stored = localStorage.getItem('ga_consent'); // 'granted' | 'denied' | null

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Mode Consentement v2 : tout est refusé par défaut, AVANT toute mesure.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: stored === 'granted' ? 'granted' : 'denied',
  });

  gtag('js', new Date());
  // Pas de signaux publicitaires : mesure d'audience uniquement.
  gtag('set', 'allow_google_signals', false);
  gtag('set', 'allow_ad_personalization_signals', false);
  gtag('config', GA_ID, {
    app_language: (localStorage.getItem('lang') || 'fr'),
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);

  // Paramètres GLOBAUX non sensibles attachés à chaque événement — JAMAIS de
  // coordonnées exactes, d'adresse, de contact ni de contenu de signalement.
  const globalParams = () => ({
    selected_country: localStorage.getItem('kifeh_country') || '(none)',
    interface_language: localStorage.getItem('lang') || 'fr',
    entry_page: entryPage,
  });
  const entryPage = location.pathname || '/';
  window.track = (event, params) => {
    try {
      const name = CANON[event] || event;
      const p = { ...globalParams(), ...(CANON_PARAMS[event] || {}), ...(params || {}) };
      window.__trackLog.push({ event: name, params: p });
      gtag('event', name, p);
    } catch {}
  };

  // ── Boucles de retour : lien profond d'alerte ou de partage ───────────────
  // Les notifications/e-mails portent ?from=alert, les partages ?from=share :
  // le RETOUR (la métrique qui compte) devient mesurable. Le paramètre est
  // ensuite retiré de la barre d'adresse (les UTM restent pour GA).
  try {
    const q = new URLSearchParams(location.search);
    const from = q.get('from');
    const src = q.get('src') || ''; // liens historiques des notifications/e-mails
    if (from === 'alert' || src === 'push' || src === 'email') {
      window.track('return_after_alert', { alert_channel: src || 'push' });
    }
    if (src === 'digest') window.track('return_after_alert', { alert_channel: 'digest' });
    if (from === 'share') window.track('return_after_share', {});
    if (from) {
      q.delete('from');
      const qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
  } catch {}

  // Appels d'urgence : événement CRITIQUE d'utilité (jamais présenté comme
  // une conversion commerciale) — délégué sur tous les liens tel:.
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href^="tel:"]');
    if (a) window.track('emergency_call_clicked', {});
  }, true);

  // PWA réellement installée (l'invite est déjà mesurée par ailleurs).
  window.addEventListener('appinstalled', () => window.track('pwa_installed', {}));

  // ── « Modifier mon choix » (page mentions légales) ────────────────────────
  const wireReset = () => {
    for (const id of ['consent-reset', 'consent-reset-ar']) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('ga_consent');
        location.reload();
      });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireReset);
  else wireReset();

  // ── Bannière de consentement (une seule fois, choix mémorisé) ─────────────
  if (stored) return;
  const TXT = {
    fr: {
      msg: 'Kifeh mesure son audience avec Google Analytics (région, type d’appareil — jamais votre identité). Acceptez-vous les cookies de mesure ?',
      accept: 'Accepter', refuse: 'Refuser', more: 'En savoir plus',
    },
    ar: {
      msg: 'يقيس «كيفاه» جمهوره عبر Google Analytics (المنطقة ونوع الجهاز — دون هويّتك أبدًا). هل توافق على ملفّات قياس الجمهور؟',
      accept: 'أوافق', refuse: 'أرفض', more: 'اعرف المزيد',
    },
  };
  const lang = localStorage.getItem('lang')
    || (((navigator.language || '').toLowerCase().startsWith('ar')) ? 'ar' : 'fr');
  const t = TXT[lang] || TXT.fr;

  function show() {
    const el = document.createElement('div');
    el.className = 'consent-banner';
    el.dir = lang === 'ar' ? 'rtl' : 'ltr';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    const p = document.createElement('p');
    p.textContent = t.msg + ' ';
    const a = document.createElement('a');
    a.href = 'legal.html'; a.textContent = t.more;
    p.appendChild(a);
    const row = document.createElement('div');
    row.className = 'consent-actions';
    const btnNo = document.createElement('button');
    btnNo.type = 'button'; btnNo.className = 'consent-refuse'; btnNo.textContent = t.refuse;
    const btnYes = document.createElement('button');
    btnYes.type = 'button'; btnYes.className = 'consent-accept'; btnYes.textContent = t.accept;
    row.append(btnNo, btnYes);
    el.append(p, row);
    document.body.appendChild(el);
    const choose = (granted) => {
      localStorage.setItem('ga_consent', granted ? 'granted' : 'denied');
      if (granted) gtag('consent', 'update', { analytics_storage: 'granted' });
      el.remove();
    };
    btnYes.addEventListener('click', () => choose(true));
    btnNo.addEventListener('click', () => choose(false));
  }

  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
