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

window.track = function () {}; // no-op si GA n'est pas chargé (sandbox)

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

  window.track = (event, params) => { try { gtag('event', event, params || {}); } catch {} };

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
