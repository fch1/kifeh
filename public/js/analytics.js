// Balise Google (gtag.js) — Google Analytics 4, ID : G-B33KFSSPSG.
// - Chargée immédiatement sur toutes les pages publiques (équivalent exact du
//   snippet officiel fourni par Google) ;
// - jamais dans la sandbox (données de test exclues des statistiques) ;
// - signaux publicitaires désactivés : mesure d'audience uniquement ;
// - GA4 anonymise les adresses IP par conception : les rapports montrent la
//   région/ville et l'appareil, jamais l'IP exacte d'un visiteur.
'use strict';

window.track = function () {}; // no-op si GA n'est pas chargé (sandbox)

(function initAnalytics() {
  if (location.pathname.startsWith('/sandbox')) return;
  const GA_ID = 'G-B33KFSSPSG';

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  // Pas de signaux publicitaires : mesure d'audience uniquement.
  gtag('set', 'allow_google_signals', false);
  gtag('set', 'allow_ad_personalization_signals', false);
  gtag('config', GA_ID, {
    app_language: (localStorage.getItem('lang') || 'fr'),
  });
  window.track = (event, params) => { try { gtag('event', event, params || {}); } catch {} };
})();
