// Mesure d'audience (Google Analytics 4).
// - Chargée uniquement si un identifiant GA est configuré côté serveur ;
// - jamais dans la sandbox ;
// - GA4 anonymise les adresses IP par conception : les rapports montrent la
//   région/ville et l'appareil, jamais l'IP exacte d'un visiteur.
'use strict';

window.track = function () {}; // no-op tant que GA n'est pas chargé

(function initAnalytics() {
  const base = location.pathname.startsWith('/sandbox') ? '/sandbox' : '';
  fetch(`${base}/api/public/config`)
    .then((r) => r.json())
    .then((c) => {
      if (!c.gaId || c.sandbox) return;
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(c.gaId)}`;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag('js', new Date());
      // Pas de signaux publicitaires : mesure d'audience uniquement.
      gtag('set', 'allow_google_signals', false);
      gtag('set', 'allow_ad_personalization_signals', false);
      gtag('config', c.gaId, {
        app_language: (localStorage.getItem('lang') || 'fr'),
      });
      window.track = (event, params) => { try { gtag('event', event, params || {}); } catch {} };
    })
    .catch(() => {});
})();
