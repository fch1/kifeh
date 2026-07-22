// Atterrissage du lien e-mail signé (usage unique), bilingue FR/AR.
'use strict';

(async () => {
  const el = document.getElementById('content');
  const p = new URLSearchParams(location.search);
  const vid = p.get('vid'), tk = p.get('t');
  if (!vid || !tk) {
    el.innerHTML = `<div class="notice danger">${t('verify_invalid')}</div>`;
    return;
  }
  try {
    const r = await API.post('/api/declare/verify-link', { vid, t: tk });
    const i = r.incident;
    el.innerHTML = `
      <div class="notice ok"><strong>${t('verify_ok')}</strong></div>
      <div class="card">
        <h2>${t('ref')} ${esc(r.publicId)}</h2>
        <p><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
           <span class="badge status ${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span></p>
        <p class="muted">${esc(i.area || t('area_approx'))}<br>${t('started')} ${esc(fmtDate(i.startedAt))}</p>
        ${r.pendingReview
          ? `<p class="notice warn">${t('pending_review_note')}</p>`
          : `<p class="notice ok">${t('visible_note')}</p>`}
      </div>
      <div class="card">
        <h2>${t('verify_follow')}</h2>
        <p class="muted small">${t('verify_follow_hint')}</p>
        <p><a href="${esc(r.manageUrl)}">${t('manage_my')}</a></p>
      </div>
      <a class="btn" href="index.html">${t('see_map')}</a>`;
  } catch (ex) {
    el.innerHTML = `
      <div class="notice danger">${esc(ex.message)}</div>
      <p class="muted">${t('verify_expired_hint')}</p>
      <a class="btn secondary" href="index.html">${t('back_map')}</a>`;
  }
})();
