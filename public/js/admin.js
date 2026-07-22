// Back-office : connexion, file d'attente, modération, statistiques, configuration, journal.
'use strict';

let session = null; // { username, role, csrf }
const content = document.getElementById('adminContent');

const adminApi = {
  get: (url) => API.get(url),
  post: (url, body) => API.call('POST', url, body, { fetch: { headers: { 'Content-Type': 'application/json', 'X-CSRF': session?.csrf || '' } } }),
};

// --- Connexion --------------------------------------------------------------
(async () => {
  try { session = await API.get('/api/admin/me'); enter(); } catch { /* écran de connexion */ }
})();

document.getElementById('btnLogin').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
  const err = document.getElementById('loginError'); err.textContent = '';
  try {
    session = await API.post('/api/admin/login', {
      username: document.getElementById('adminUser').value.trim(),
      password: document.getElementById('adminPass').value,
    });
    enter();
  } catch (ex) { err.textContent = ex.message; }
}));

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await adminApi.post('/api/admin/logout', {}); } catch {}
  location.reload();
});

function enter() {
  document.getElementById('loginView').hidden = true;
  document.getElementById('appView').hidden = false;
  document.getElementById('whoami').textContent = `${session.username} (${session.role})`;
  showTab('queue');
}

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}
function showTab(name) {
  document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === name));
  ({ queue: renderQueue, incidents: renderIncidents, stats: renderStats, settings: renderSettings, audit: renderAudit })[name]();
}

// --- File d'attente / incidents --------------------------------------------
async function renderQueue() { renderIncidentList(''); }
async function renderIncidents() { renderIncidentList('active'); }

async function renderIncidentList(status) {
  content.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  const statuses = ['', 'pending_review', 'possible_duplicate', 'active', 'resolved', 'expired', 'rejected', 'pending_verification', 'deleted'];
  let rows;
  try { rows = (await adminApi.get(`/api/admin/incidents${status ? `?status=${status}` : ''}`)).incidents; }
  catch (e) { content.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }

  content.innerHTML = `
    <label for="statusFilter">Filtrer par statut</label>
    <select id="statusFilter">${statuses.map((s) =>
      `<option value="${s}" ${s === status ? 'selected' : ''}>${s ? esc(STATUS_LABELS[s] || s) : 'File d’attente (à traiter + actifs)'}</option>`).join('')}
    </select>
    <p class="muted small">${rows.length} incident(s) · <a href="/api/admin/export">Exporter en CSV</a></p>
    <div id="rows"></div>
    <div id="incidentDetail"></div>`;
  document.getElementById('statusFilter').addEventListener('change', (e) => renderIncidentList(e.target.value));

  const rowsEl = document.getElementById('rows');
  for (const i of rows) {
    const div = document.createElement('button');
    div.className = 'list-item';
    div.innerHTML = `
      <div class="type-dot ${esc(i.type)}">${TYPE_ICONS[i.type]}</div>
      <div style="flex:1">
        <strong>${esc(i.public_id)}</strong>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span>
        ${i.open_reports ? `<span class="badge" style="background:var(--danger)">⚑ ${i.open_reports}</span>` : ''}
        <br><span class="muted small">${esc(i.public_area || '—')} · ${esc(fmtDate(i.started_at))}
        · confiance ${i.trust_score} · 👥 ${i.confirmations_count}
        ${i.attachments_count ? ` · 📎 ${i.attachments_count}` : ''}</span>
        <br><span class="small">${esc((i.description || '').slice(0, 90))}</span>
      </div>`;
    div.addEventListener('click', () => renderDetail(i.id));
    rowsEl.appendChild(div);
  }
  if (!rows.length) rowsEl.innerHTML = '<p class="muted">Aucun incident.</p>';
}

async function renderDetail(id) {
  const el = document.getElementById('incidentDetail');
  el.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  el.scrollIntoView({ behavior: 'smooth' });
  let i;
  try { i = await adminApi.get(`/api/admin/incidents/${encodeURIComponent(id)}`); }
  catch (e) { el.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }

  el.innerHTML = `
    <div class="card" style="border-color:var(--primary)">
      <h2>${esc(i.public_id)} — ${esc(TYPE_LABELS[i.type])}
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
      <p class="small">Gravité : ${esc(SEVERITY_LABELS[i.severity])} · Score de confiance : <strong>${i.trust_score}</strong>
      · Confirmations : ${i.confirmations_count}<br>
      Début : ${esc(fmtDate(i.started_at))} ${i.ended_at ? `· Fin : ${esc(fmtDate(i.ended_at))}` : ''}<br>
      Zone publique : ${esc(i.public_area || '—')} (${i.public_lat}, ${i.public_lng})<br>
      ${i.lat != null
        ? `<span class="notice warn" style="display:inline-block;padding:.25rem .5rem">🔒 Localisation exacte (consultation journalisée) :
           ${esc(i.address || '')} — ${i.lat}, ${i.lng}</span>`
        : '<em>Localisation exacte non accessible avec votre rôle.</em>'}</p>
      <p><strong>Description :</strong> ${esc(i.description || '—')} ${i.hidden_description ? '<em>(masquée publiquement)</em>' : ''}</p>
      ${i.comment ? `<p class="small"><strong>Commentaire privé :</strong> ${esc(i.comment)}</p>` : ''}

      ${i.reports.length ? `<h2>Signalements</h2>` + i.reports.map((r) =>
        `<p class="small">⚑ ${esc(r.reason)} — ${esc(r.detail || '')} (${esc(fmtDate(r.created_at))}) ${r.status === 'open'
          ? `<button class="btn ghost small-btn" data-handle-report="${esc(r.id)}">Marquer traité</button>` : '✓ traité'}</p>`).join('') : ''}

      ${i.attachments.length ? `<h2>Pièces jointes</h2>` + i.attachments.map((a) =>
        `<p class="small">📎 ${esc(a.mime)} — ${esc(a.moderation_status)} ${a.public ? '(publique)' : '(privée)'}
         <a href="/api/admin/attachments/${esc(a.id)}/file" target="_blank">voir</a>
         <button class="btn ghost small-btn" data-approve-att="${esc(a.id)}">Approuver + publier</button>
         <button class="btn ghost small-btn" data-reject-att="${esc(a.id)}">Rejeter</button></p>`).join('') : ''}

      ${i.similar.length ? `<h2>Incidents proches (doublons potentiels)</h2>` + i.similar.map((s) =>
        `<p class="small">${esc(s.public_id)} — ${esc(STATUS_LABELS[s.status] || s.status)} · ${esc(fmtDate(s.started_at))}
         <button class="btn ghost small-btn" data-merge-into="${esc(s.id)}">Fusionner dans celui-ci</button></p>`).join('') : ''}

      <h2>Actions</h2>
      <div class="row" style="flex-wrap:wrap;gap:.5rem">
        <button class="btn small-btn" id="aApprove">Valider / publier</button>
        <button class="btn secondary small-btn" id="aHide">Masquer la description</button>
        <button class="btn secondary small-btn" id="aSuspend">Suspendre le contact (72 h)</button>
        <button class="btn danger small-btn" id="aReject">Rejeter</button>
      </div>
      <label for="aDesc">Modifier la description</label>
      <textarea id="aDesc">${esc(i.description || '')}</textarea>
      <button class="btn secondary small-btn" id="aEdit" style="margin-top:.5rem">Enregistrer la modification</button>
      <div id="aFeedback" role="status"></div>
    </div>`;

  const fb = (m, ok = true) => document.getElementById('aFeedback').innerHTML = `<div class="notice ${ok ? 'ok' : 'danger'}">${esc(m)}</div>`;
  const act = (url, body = {}) => adminApi.post(url, body).then(() => { fb('Action effectuée.'); renderDetail(id); }).catch((e) => fb(e.message, false));

  document.getElementById('aApprove').addEventListener('click', () => act(`/api/admin/incidents/${i.id}/approve`));
  document.getElementById('aReject').addEventListener('click', () => act(`/api/admin/incidents/${i.id}/reject`));
  document.getElementById('aHide').addEventListener('click', () => act(`/api/admin/incidents/${i.id}/hide-description`));
  document.getElementById('aEdit').addEventListener('click', () => act(`/api/admin/incidents/${i.id}/edit`, { description: document.getElementById('aDesc').value }));
  document.getElementById('aSuspend').addEventListener('click', () => {
    if (i.reporter_id) act(`/api/admin/reporters/${i.reporter_id}/suspend`, { hours: 72 });
    else fb('Aucun contact associé.', false);
  });
  el.querySelectorAll('[data-merge-into]').forEach((b) =>
    b.addEventListener('click', () => act(`/api/admin/incidents/${i.id}/merge`, { mainId: b.dataset.mergeInto })));
  el.querySelectorAll('[data-handle-report]').forEach((b) =>
    b.addEventListener('click', () => act(`/api/admin/reports/${b.dataset.handleReport}/handle`)));
  el.querySelectorAll('[data-approve-att]').forEach((b) =>
    b.addEventListener('click', () => act(`/api/admin/attachments/${b.dataset.approveAtt}/moderate`, { status: 'approved', public: true })));
  el.querySelectorAll('[data-reject-att]').forEach((b) =>
    b.addEventListener('click', () => act(`/api/admin/attachments/${b.dataset.rejectAtt}/moderate`, { status: 'rejected' })));
}

// --- Statistiques -----------------------------------------------------------
async function renderStats() {
  content.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  let s;
  try { s = await adminApi.get('/api/admin/stats'); }
  catch (e) { content.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }
  const maxDay = Math.max(1, ...s.byDay.map((d) => d.n));
  content.innerHTML = `
    <div class="card"><h2>Vue d'ensemble</h2>
      <p>Signalements « aussi concerné » : <strong>${s.confirmations}</strong> ·
      Signalements de contenu ouverts : <strong>${s.openReports}</strong> ·
      Durée moyenne de résolution : <strong>${s.avgResolutionMin ? Math.round(s.avgResolutionMin) + ' min' : '—'}</strong></p></div>
    <div class="card"><h2>Par statut</h2><table><tbody>
      ${s.byStatus.map((r) => `<tr><td>${esc(STATUS_LABELS[r.status] || r.status)}</td><td><strong>${r.n}</strong></td></tr>`).join('')}
    </tbody></table></div>
    <div class="card"><h2>Par type</h2><table><tbody>
      ${s.byType.map((r) => `<tr><td>${TYPE_ICONS[r.type]} ${esc(TYPE_LABELS[r.type])}</td><td><strong>${r.n}</strong></td></tr>`).join('')}
    </tbody></table></div>
    <div class="card"><h2>Déclarations — 30 derniers jours</h2>
      ${s.byDay.map((d) => `
        <div style="display:flex;align-items:center;gap:.5rem;margin:.15rem 0">
          <span class="small" style="width:80px">${esc(d.day.slice(5))}</span>
          <div style="background:var(--primary);height:14px;border-radius:4px;width:${(d.n / maxDay) * 100}%"></div>
          <span class="small">${d.n}</span>
        </div>`).join('') || '<p class="muted">Aucune donnée.</p>'}
    </div>`;
}

// --- Configuration ----------------------------------------------------------
const SETTING_LABELS = {
  other_category_enabled: 'Catégorie « Autre » activée (1/0)',
  anonymize_radius_m: 'Rayon d’anonymisation public (m)',
  otp_ttl_min: 'Validité du code OTP (min)',
  email_link_ttl_min: 'Validité du lien e-mail (min)',
  otp_max_attempts: 'Tentatives OTP max',
  otp_resend_delay_s: 'Délai entre renvois OTP (s)',
  otp_max_resends: 'Renvois OTP max',
  active_incident_ttl_h: 'Expiration d’un incident en cours (h)',
  reminder_before_expiry_h: 'Rappel avant expiration (h)',
  resolved_visible_h: 'Affichage des incidents résolus (h)',
  max_declarations_per_ip_per_h: 'Déclarations max / IP / h',
  max_declarations_per_contact_per_day: 'Déclarations max / contact / jour',
  max_confirms_per_ip_per_h: 'Confirmations max / IP / h',
  min_form_fill_s: 'Durée minimale de remplissage (s)',
  retention_days: 'Rétention des contacts (jours)',
  trust_publish_threshold: 'Seuil de confiance pour publication auto',
  dedup_radius_m: 'Rayon de détection des doublons (m)',
  dedup_window_h: 'Fenêtre de détection des doublons (h)',
  manage_link_ttl_days: 'Validité du lien de gestion (jours)',
};

async function renderSettings() {
  content.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  let s;
  try { s = (await adminApi.get('/api/admin/settings')).settings; }
  catch (e) { content.innerHTML = `<div class="notice danger">${esc(e.message)} (rôle administrateur requis)</div>`; return; }
  content.innerHTML = `<div class="card"><h2>Configuration</h2>
    ${Object.entries(s).map(([k, v]) => `
      <label for="set_${esc(k)}">${esc(SETTING_LABELS[k] || k)}</label>
      <input id="set_${esc(k)}" data-key="${esc(k)}" type="text" value="${esc(v)}">`).join('')}
    <div class="field-error" id="setError"></div>
    <button class="btn" id="btnSaveSettings" style="margin-top:1rem">Enregistrer</button>
    <div id="setFeedback" role="status"></div></div>`;
  document.getElementById('btnSaveSettings').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const settings = {};
    content.querySelectorAll('[data-key]').forEach((inp) => settings[inp.dataset.key] = inp.value);
    try {
      await adminApi.post('/api/admin/settings', { settings });
      document.getElementById('setFeedback').innerHTML = '<div class="notice ok">Configuration enregistrée.</div>';
    } catch (ex) { document.getElementById('setError').textContent = ex.message; }
  }));
}

// --- Journal d'audit --------------------------------------------------------
async function renderAudit() {
  content.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  let log;
  try { log = (await adminApi.get('/api/admin/audit')).log; }
  catch (e) { content.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }
  content.innerHTML = `<div class="card"><h2>Journal des actions sensibles</h2>
    <table><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th></tr></thead><tbody>
    ${log.map((l) => `<tr><td class="small">${esc(fmtDate(l.created_at))}</td>
      <td class="small">${esc(l.actor)}</td><td class="small">${esc(l.action)}</td>
      <td class="small">${esc(l.target || '')} ${esc(l.detail || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}
