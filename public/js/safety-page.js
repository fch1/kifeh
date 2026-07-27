// Page « Statut de sécurité » (lien partagé) — affiche UNIQUEMENT ce que
// l'auteur a choisi de partager : statut, prénom éventuel, zone approximative,
// horodatage. Aucune coordonnée, aucun identifiant. Fichier séparé (CSP :
// aucun script inline n'est autorisé sur Kifeh).
(async () => {
  const el = document.getElementById('statusContent');
  const token = new URLSearchParams(location.search).get('s') || '';
  try {
    const r = await API.get(`/api/safety/shared/${encodeURIComponent(token)}`);
    const label = r.status === 'left_area' ? t('safety_status_left') : t('safety_status_safe');
    const icon = r.status === 'left_area' ? '🚶' : '🤍';
    el.innerHTML = `
      ${r.displayName ? `<p style="font-size:1.1rem"><strong>${esc(r.displayName)}</strong></p>` : ''}
      <p class="notice ${r.current ? 'ok' : 'warn'}" style="font-size:1.05rem">
        <strong>${icon} ${esc(r.current ? label : t('safety_status_expired'))}</strong></p>
      ${!r.current ? `<p class="notice warn small">${esc(t('safety_stale'))}</p>` : ''}
      ${r.message ? `<p>${esc(r.message)}</p>` : ''}
      ${r.areaLabel ? `<p class="muted">${esc(r.areaLabel)}</p>` : ''}
      <p class="muted small">${esc(t('safety_updated_at', { t: fmtDate(r.updatedAt) }))}</p>`;
  } catch {
    el.innerHTML = `<p class="notice warn">${esc(t('safety_link_invalid'))}</p>`;
  }
})();
