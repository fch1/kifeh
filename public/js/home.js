// Accueil : carte temps réel, recherche, filtres, liste, détail, confirmation.
'use strict';

const map = createMap('map');
let userPos = null;
let verificationRequired = true;
API.get('/api/public/config').then((c) => {
  verificationRequired = c.verificationRequired !== false;
  if (c.sandbox) showSandboxBanner();
}).catch(() => {});

function showSandboxBanner() {
  const b = document.createElement('div');
  b.className = 'sandbox-banner';
  b.setAttribute('role', 'status');
  b.textContent = t('sandbox_banner');
  document.body.appendChild(b);
}
let incidents = [];
const filters = { types: new Set(), status: 'active', periodH: '' };
// Le sélecteur de statut reflète le filtre par défaut (« En cours uniquement »).
document.getElementById('fStatus').value = filters.status;

const cluster = new GridCluster(map, (it) => openDetail(it.public_id));

// --- Chargement des incidents de la zone -----------------------------------
let loadTimer = null;
async function loadIncidents() {
  const b = map.getBounds();
  const params = new URLSearchParams({
    minLat: b.getSouth().toFixed(4), maxLat: b.getNorth().toFixed(4),
    minLng: b.getWest().toFixed(4), maxLng: b.getEast().toFixed(4),
  });
  if (filters.types.size) params.set('types', [...filters.types].join(','));
  if (filters.status) params.set('status', filters.status);
  // Filtre « période » : basé sur la date de PUBLICATION du signalement.
  if (filters.periodH) params.set('publishedSince', new Date(Date.now() - filters.periodH * 3600_000).toISOString());
  try {
    const data = await API.get(`/api/public/incidents?${params}`);
    incidents = data.incidents;
    cluster.setItems(incidents);
    const n = incidents.filter((i) => i.status === 'active').length;
    const counter = document.getElementById('counter');
    if (incidents.length === 0 && activeFilterCount() > 0) counter.textContent = t('filter_results_none');
    else counter.textContent = n === 0 ? t('counter_none') : n === 1 ? t('counter_one') : t('counter_n', { n });
    updateFilterCount();
  } catch (e) {
    document.getElementById('counter').textContent = e.message;
  }
}

// Nombre de filtres actifs (badge du bouton « Plus de filtres »).
function activeFilterCount() {
  return filters.types.size + (filters.status !== 'active' ? 1 : 0) + (filters.periodH ? 1 : 0);
}
function updateFilterBadge() {
  const n = activeFilterCount();
  const badge = document.getElementById('filterBadge');
  badge.hidden = n === 0;
  badge.textContent = n;
}
function updateFilterCount() {
  const el = document.getElementById('filterCount');
  if (!el) return;
  el.textContent = incidents.length === 0 ? t('filter_results_none')
    : incidents.length === 1 ? t('filter_results_one') : t('filter_results_n', { n: incidents.length });
}
map.on('moveend', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadIncidents, 350); });
loadIncidents();

// --- Temps réel (SSE) -------------------------------------------------------
try {
  const es = new EventSource(`${API_BASE}/api/events`);
  es.addEventListener('incident', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadIncidents, 500); });
} catch { /* repli : rechargement au déplacement de carte */ }

// --- Géolocalisation (consentement explicite : uniquement sur action) -------
document.getElementById('btnLocate').addEventListener('click', () => {
  if (!navigator.geolocation) return alert(t('geo_unavailable'));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setView([userPos.lat, userPos.lng], 14);
      L.circleMarker([userPos.lat, userPos.lng], { radius: 8, color: '#17557E', fillOpacity: .9 })
        .addTo(map).bindPopup(esc(t('you_are_here')));
    },
    () => alert(t('geo_not_found')),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// --- Recherche d'adresse ----------------------------------------------------
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('searchResults');
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const { results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`);
      searchResults.innerHTML = '';
      if (!results.length) {
        const b = document.createElement('button');
        b.disabled = true; b.textContent = t('addr_not_found');
        searchResults.appendChild(b);
      }
      for (const r of results) {
        const b = document.createElement('button');
        b.setAttribute('role', 'option');
        b.textContent = r.label;
        b.addEventListener('click', () => {
          searchResults.hidden = true;
          searchInput.value = r.label.split(',').slice(0, 2).join(',');
          searchInput.blur(); // referme le clavier mobile pour voir la carte
          map.setView([r.lat, r.lng], 15);
          if (window._searchMarker) map.removeLayer(window._searchMarker);
          window._searchMarker = L.circleMarker([r.lat, r.lng], { radius: 9, color: '#C4622D', fillOpacity: .7 })
            .addTo(map).bindPopup(esc(r.label.split(',').slice(0, 2).join(',')));
        });
        searchResults.appendChild(b);
      }
      searchResults.hidden = false;
    } catch {
      searchResults.innerHTML = '';
      const b = document.createElement('button');
      b.disabled = true; b.textContent = t('search_error');
      searchResults.appendChild(b);
      searchResults.hidden = false;
    }
  }, 350);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.searchbox')) searchResults.hidden = true;
});

// --- Filtres ----------------------------------------------------------------
// Les puces rapides (types) et la feuille « Plus de filtres » (types, statut,
// période) agissent sur le MÊME jeu de filtres : carte, liste et compteur
// restent toujours cohérents.
function syncTypeControls() {
  document.querySelectorAll('.chip[data-type]').forEach((c) =>
    c.setAttribute('aria-pressed', filters.types.has(c.dataset.type)));
  document.querySelectorAll('.fType').forEach((c) => { c.checked = filters.types.has(c.value); });
  updateFilterBadge();
}
for (const chip of document.querySelectorAll('.chip[data-type]')) {
  chip.addEventListener('click', () => {
    const ty = chip.dataset.type;
    if (filters.types.has(ty)) filters.types.delete(ty); else filters.types.add(ty);
    syncTypeControls();
    loadIncidents();
  });
}
for (const box of document.querySelectorAll('.fType')) {
  box.addEventListener('change', () => {
    if (box.checked) filters.types.add(box.value); else filters.types.delete(box.value);
    syncTypeControls();
  });
}
document.getElementById('chipOngoing').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on);
  filters.status = on ? 'active' : '';
  document.getElementById('fStatus').value = filters.status;
  updateFilterBadge();
  loadIncidents();
});
document.getElementById('chipFilters').addEventListener('click', () => openSheet('filterSheet'));
document.getElementById('filterApply').addEventListener('click', async () => {
  filters.status = document.getElementById('fStatus').value;
  filters.periodH = document.getElementById('fPeriod').value;
  document.getElementById('chipOngoing').setAttribute('aria-pressed', filters.status === 'active');
  window.track?.('filters_applied', { types: [...filters.types].join(',') || 'all', period_h: filters.periodH || 'all' });
  await loadIncidents();
  updateFilterBadge();
  closeSheets();
});
document.getElementById('filterReset').addEventListener('click', () => {
  filters.types.clear(); filters.status = 'active'; filters.periodH = '';
  document.getElementById('fStatus').value = 'active';
  document.getElementById('fPeriod').value = '';
  document.getElementById('chipOngoing').setAttribute('aria-pressed', 'true');
  syncTypeControls();
  closeSheets(); loadIncidents();
});

// --- Feuilles (bottom sheets) ----------------------------------------------
function openSheet(id) { closeSheets(); document.getElementById(id).classList.add('open'); }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open')); }
document.querySelectorAll('.sheet .handle').forEach((h) =>
  h.parentElement.addEventListener('click', (e) => { if (e.target === h) closeSheets(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
map.on('click', closeSheets);

// --- Liste ------------------------------------------------------------------
document.getElementById('btnList').addEventListener('click', () => { renderList(); openSheet('listSheet'); });
document.getElementById('sortSelect').addEventListener('change', renderList);

function renderList() {
  const sort = document.getElementById('sortSelect').value;
  const sevRank = { immediate_danger: 0, high: 1, moderate: 2, low: 3 };
  const rows = [...incidents];
  if (sort === 'time') rows.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  if (sort === 'severity') rows.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  if (sort === 'near' && userPos) {
    const d = (i) => (i.lat - userPos.lat) ** 2 + (i.lng - userPos.lng) ** 2;
    rows.sort((a, b) => d(a) - d(b));
  }
  const el = document.getElementById('listContainer');
  el.innerHTML = rows.length ? '' : `<p class="muted">${t('list_empty')}</p>`;
  for (const i of rows) {
    const btn = document.createElement('button');
    btn.className = 'list-item';
    btn.innerHTML = `
      <div class="type-dot ${esc(i.type)}">${TYPE_ICONS[i.type] || '•'}</div>
      <div style="flex:1">
        <strong>${esc(TYPE_LABELS[i.type])}</strong>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span><br>
        <span class="muted">${esc(i.area || t('area_approx'))} · ${t('started_ago')} ${esc(fmtDate(i.started_at))}
        · ${t('severity_short')} ${esc(SEVERITY_LABELS[i.severity])}</span>
      </div>`;
    btn.addEventListener('click', () => openDetail(i.public_id));
    el.appendChild(btn);
  }
}

// --- Détail + confirmation + fin d'incident + corrections --------------------
// Toutes les actions s'appliquent à l'incident EXISTANT : aucune ne crée de
// doublon d'incident ni de nouveau marqueur.

// Statut communautaire d'un incendie (jamais présenté comme officiel).
function fireStatusHtml(i) {
  if (i.type !== 'fire' || i.status !== 'active') return '';
  const total = i.fireThreshold || 3;
  const n = i.confirmations_count;
  const confirmed = n >= total;
  return `
    <div class="notice ${confirmed ? 'ok' : 'warn'}" id="fireStatus">
      <strong>${confirmed ? t('fire_confirmed_comm') : t('fire_to_confirm')}</strong><br>
      <span>${confirmed ? t('fire_progress_done', { total }) : t('fire_progress', { n, total })}</span><br>
      <span class="small muted">${t('fire_not_official')}</span>
    </div>`;
}

async function openDetail(publicId) {
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('detailSheet');
  let i;
  try { i = await API.get(`/api/public/incidents/${encodeURIComponent(publicId)}`); }
  catch (e) { el.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }

  const confirmed = isDone('confirmed', i.public_id);
  const endedReported = isDone('ended', i.public_id);
  const isFire = i.type === 'fire';
  const confirmLabel = isFire ? t('confirm_fire_btn') : t('im_affected');

  el.innerHTML = `
    <h2><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
    <p class="muted">${esc(i.area || t('area_approx'))} · ${t('ref')} ${esc(i.public_id)}</p>
    ${fireStatusHtml(i)}
    <p><strong>${t('started')}</strong> ${esc(fmtDate(i.started_at))}${i.time_approximate ? ` ${t('approx_suffix')}` : ''}<br>
    ${i.ended_at ? `<strong>${t('ended')}</strong> ${esc(fmtDate(i.ended_at))}<br>` : ''}
    <strong>${t('severity_label')}</strong> ${esc(SEVERITY_LABELS[i.severity])}<br>
    <strong>${t('last_update')}</strong> ${esc(timeAgo(i.updated_at))}</p>
    ${i.description ? `<p>${esc(i.description)}</p>` : ''}
    ${i.confirmations_count > 0 ? `<p class="notice ok" id="affectedCount">${i.confirmations_count > 1 ? t('affected_n', { n: i.confirmations_count }) : t('affected_one')}</p>` : '<p hidden id="affectedCount"></p>'}
    ${i.resolutionReports > 0 && i.status === 'active' ? `<p class="notice warn" id="endedCount">${i.resolutionReports > 1 ? t('ended_reports_n', { n: i.resolutionReports }) : t('ended_reports_one')}</p>` : ''}
    <div id="confirmZone">
      ${i.status === 'active' ? (confirmed
        ? `<p class="notice ok">${t('you_confirmed')}</p>`
        : `<button class="btn" id="btnConfirm">${confirmLabel}</button>`) : ''}
    </div>
    ${i.status === 'active' && !endedReported ? `<button class="btn secondary" id="btnEnded" style="margin-top:.5rem">${t('ended_report_btn')}</button>` : ''}
    <div id="endedZone"></div>
    <button class="btn ghost small-btn" id="btnLocCorrect" style="margin-top:.5rem">${t('loc_correct_title')}</button>
    <div id="locCorrectZone"></div>
    <button class="btn ghost small-btn" id="btnReport" style="margin-top:.5rem">${t('report_content')}</button>
    <div id="reportZone"></div>`;

  document.getElementById('btnConfirm')?.addEventListener('click', (e) => {
    if (!verificationRequired) return withButton(e.currentTarget, () => directConfirm(i));
    renderConfirmForm(i);
  });
  document.getElementById('btnEnded')?.addEventListener('click', () => renderEndedForm(i));
  document.getElementById('btnLocCorrect').addEventListener('click', () => renderCorrectionForm(i));
  document.getElementById('btnReport').addEventListener('click', () => renderReportForm(i));
}

// Position rapide et silencieuse (renforce la confirmation d'un incendie) —
// jamais bloquante : sans réponse en 4 s, la confirmation part sans position.
function quickPosition() {
  return new Promise((resolve) => {
    if (userPos) return resolve(userPos);
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 120000 }
    );
  });
}

async function directConfirm(i) {
  const zone = document.getElementById('confirmZone');
  try {
    const pos = i.type === 'fire' ? await quickPosition() : userPos;
    const r = await API.post('/api/public/confirm/direct', {
      publicId: i.public_id, deviceId: getDeviceId(),
      approxLat: pos?.lat, approxLng: pos?.lng,
    });
    window.track?.('incident_confirmed', { incident_type: i.type });
    markDone('confirmed', i.public_id);
    zone.innerHTML = `<p class="notice ok">${t('you_confirmed')}</p>`;
    const counts = document.getElementById('affectedCount');
    counts.hidden = false;
    counts.className = 'notice ok';
    counts.textContent = r.confirmations > 1 ? t('affected_n', { n: r.confirmations }) : t('affected_one');
    if (i.type === 'fire') {
      i.confirmations_count = r.confirmations;
      i.fireThreshold = r.fireThreshold;
      document.getElementById('fireStatus')?.remove();
      counts.insertAdjacentHTML('beforebegin', fireStatusHtml(i));
    }
    loadIncidents();
  } catch (ex) {
    if (ex.data?.alreadyConfirmed) {
      markDone('confirmed', i.public_id);
      zone.innerHTML = `<p class="notice ok">${t('you_confirmed')}</p>`;
    } else {
      zone.insertAdjacentHTML('beforeend', `<p class="field-error">${esc(ex.message)}</p>`);
    }
  }
}

// « Signaler que cet incident est terminé » — signalement communautaire lié à
// l'incident existant ; clôture automatique seulement au seuil configuré.
function renderEndedForm(i) {
  const zone = document.getElementById('endedZone');
  zone.innerHTML = `
    <div class="card">
      <h2>${t('ended_q')}</h2>
      <label for="endedTime">${t('ended_time_label')}</label>
      <input id="endedTime" type="datetime-local" value="${toLocalInput(new Date())}">
      <label for="endedComment">${t('ended_comment_label')}</label>
      <textarea id="endedComment" maxlength="300"></textarea>
      <div class="field-error" id="endedError" role="alert"></div>
      <button class="btn" id="endedSend">${t('ended_send')}</button>
    </div>`;
  document.getElementById('endedSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const v = document.getElementById('endedTime').value;
      const r = await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/resolution`, {
        deviceId: getDeviceId(),
        proposedEndedAt: v ? new Date(v).toISOString() : null,
        comment: document.getElementById('endedComment').value,
      });
      window.track?.('incident_resolution_reported', { incident_type: i.type, resolved: r.resolved });
      markDone('ended', i.public_id);
      zone.innerHTML = `<p class="notice ok">${r.reports > 1 ? t('ended_reports_n', { n: r.reports }) : t('ended_reports_one')}</p>`;
      document.getElementById('btnEnded')?.remove();
      if (r.resolved) openDetail(i.public_id);
      loadIncidents();
    } catch (ex) {
      if (ex.data?.alreadyReported) {
        markDone('ended', i.public_id);
        zone.innerHTML = `<p class="notice ok">${esc(ex.message)}</p>`;
        document.getElementById('btnEnded')?.remove();
      } else document.getElementById('endedError').textContent = ex.message;
    }
  }));
}

// Correction de localisation proposée par un visiteur : carte avec repère
// déplaçable + recherche d'adresse + position GPS. La proposition part en
// modération — elle ne déplace jamais l'incident de quelqu'un d'autre en direct.
let correctMap = null, correctMarker = null;
function renderCorrectionForm(i) {
  const zone = document.getElementById('locCorrectZone');
  correctMap = null; correctMarker = null;
  zone.innerHTML = `
    <div class="card">
      <h2>${t('loc_correct_title')}</h2>
      <p class="muted small">${t('loc_correct_hint_public')}</p>
      <button class="btn secondary small-btn" id="corrGeo">${t('use_position')}</button>
      <div class="searchbox" style="margin-top:.5rem">
        <input id="corrSearch" type="text" autocomplete="off" placeholder="${esc(t('addr_ph'))}">
        <div id="corrResults" class="search-results" role="listbox" hidden></div>
      </div>
      <div id="correctMap" class="mini-map" aria-label="${esc(t('minimap_aria'))}"></div>
      <p class="muted small" id="corrPreview" aria-live="polite"></p>
      <div class="field-error" id="corrError" role="alert"></div>
      <button class="btn" id="corrSend" disabled>${t('loc_correct_send')}</button>
    </div>`;
  const state = { lat: i.lat, lng: i.lng, address: null };
  setTimeout(() => {
    correctMap = createMap('correctMap', { center: [i.lat, i.lng], zoom: 15 });
    correctMarker = L.marker([i.lat, i.lng], { draggable: true, icon: typeIcon(i.type, i.status) }).addTo(correctMap);
    const setPos = (lat, lng, address) => {
      state.lat = lat; state.lng = lng; state.address = address || null;
      correctMarker.setLatLng([lat, lng]);
      document.getElementById('corrSend').disabled = false;
      document.getElementById('corrPreview').textContent =
        `${t('loc_correct_preview')} ${address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`;
    };
    correctMarker.on('dragend', () => { const p = correctMarker.getLatLng(); setPos(p.lat, p.lng); });
    correctMap.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng));
    document.getElementById('corrGeo').addEventListener('click', (e) => withButton(e.currentTarget, () => new Promise((resolve) => {
      if (!navigator.geolocation) { document.getElementById('corrError').textContent = t('geo_unavailable'); return resolve(); }
      navigator.geolocation.getCurrentPosition(
        (pos) => { correctMap.setView([pos.coords.latitude, pos.coords.longitude], 16); setPos(pos.coords.latitude, pos.coords.longitude); resolve(); },
        () => { document.getElementById('corrError').textContent = t('geo_not_found'); resolve(); },
        { enableHighAccuracy: true, timeout: 8000 });
    })));
    // Recherche d'adresse (accepte arabe, français et translittérations).
    const inp = document.getElementById('corrSearch');
    const resBox = document.getElementById('corrResults');
    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 3) { resBox.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const { results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`);
          resBox.innerHTML = '';
          for (const r of results) {
            const b = document.createElement('button');
            b.textContent = r.label;
            b.addEventListener('click', () => {
              resBox.hidden = true;
              inp.value = r.label.split(',').slice(0, 2).join(',');
              correctMap.setView([r.lat, r.lng], 16);
              setPos(r.lat, r.lng, r.label);
            });
            resBox.appendChild(b);
          }
          resBox.hidden = results.length === 0;
        } catch { resBox.hidden = true; }
      }, 350);
    });
  }, 60);
  document.getElementById('corrSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const r = await API.post(`/api/public/incidents/${encodeURIComponent(i.public_id)}/location-correction`, {
        deviceId: getDeviceId(), lat: state.lat, lng: state.lng, address: state.address,
      });
      window.track?.('location_correction_proposed', { incident_type: i.type });
      zone.innerHTML = `<p class="notice ok">${esc(r.message)}</p>`;
    } catch (ex) { document.getElementById('corrError').textContent = ex.message; }
  }));
}

function renderConfirmForm(i) {
  const zone = document.getElementById('confirmZone');
  zone.innerHTML = `
    <div class="card">
      <h2>${t('confirm_title')}</h2>
      <p class="muted small">${t('confirm_hint')}</p>
      <div class="seg" role="group" aria-label="${esc(t('confirm_method_aria'))}">
        <button id="cSms" aria-pressed="true">${t('sms')}</button>
        <button id="cEmail" aria-pressed="false">${t('email')}</button>
      </div>
      <div id="cPhoneField"><label for="cPhone">${t('phone_label')}</label>
        <input id="cPhone" type="tel" inputmode="tel" placeholder="${esc(t('phone_ph'))}" autocomplete="tel"></div>
      <div id="cEmailField" hidden><label for="cEmailInput">${t('email_label')}</label>
        <input id="cEmailInput" type="email" inputmode="email" placeholder="${esc(t('email_ph'))}" autocomplete="email"></div>
      <div class="checkbox-row">
        <input type="checkbox" id="cConsent">
        <label for="cConsent">${t('consent_confirm')}</label>
      </div>
      <div class="field-error" id="cError" role="alert"></div>
      <button class="btn" id="cSend">${t('receive_code')}</button>
      <div id="cCodeZone"></div>
    </div>`;
  let method = 'sms';
  const seg = (m) => {
    method = m;
    document.getElementById('cSms').setAttribute('aria-pressed', m === 'sms');
    document.getElementById('cEmail').setAttribute('aria-pressed', m !== 'sms');
    document.getElementById('cPhoneField').hidden = m !== 'sms';
    document.getElementById('cEmailField').hidden = m === 'sms';
  };
  document.getElementById('cSms').addEventListener('click', () => seg('sms'));
  document.getElementById('cEmail').addEventListener('click', () => seg('email'));
  document.getElementById('cSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const err = document.getElementById('cError'); err.textContent = '';
    try {
      const body = {
        publicId: i.public_id, consent: document.getElementById('cConsent').checked,
        method: method === 'sms' ? 'sms' : 'email_code',
        phone: document.getElementById('cPhone').value.trim(),
        email: document.getElementById('cEmailInput').value.trim(),
      };
      const { verificationId } = await API.post('/api/public/confirm/start', body);
      renderConfirmCode(i, verificationId);
    } catch (ex) { err.textContent = ex.message; }
  }));
}

function renderConfirmCode(i, verificationId) {
  const zone = document.getElementById('cCodeZone');
  zone.innerHTML = `
    <label for="cCode">${t('code_label')}</label>
    <input id="cCode" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
    <div class="field-error" id="cCodeError" role="alert"></div>
    <button class="btn" id="cVerify" style="margin-top:.5rem">${t('validate_confirm')}</button>`;
  document.getElementById('cVerify').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    const err = document.getElementById('cCodeError'); err.textContent = '';
    try {
      const r = await API.post('/api/public/confirm/verify', {
        verificationId, code: document.getElementById('cCode').value.trim(),
        approxLat: userPos?.lat, approxLng: userPos?.lng,
      });
      markDone('confirmed', i.public_id);
      document.getElementById('confirmZone').innerHTML =
        `<p class="notice ok">${t('you_confirmed')}<br>${r.confirmations > 1 ? t('affected_n', { n: r.confirmations }) : t('affected_one')}</p>`;
      loadIncidents();
    } catch (ex) { err.textContent = ex.message; }
  }));
}

// Lien profond depuis le parcours de déclaration : ?confirm=INC-XXXXXX
(function deepLinks() {
  const p = new URLSearchParams(location.search);
  const confirmId = p.get('confirm');
  const viewId = p.get('incident');
  if (confirmId) openDetail(confirmId).then(() => document.getElementById('btnConfirm')?.click());
  else if (viewId) openDetail(viewId);
})();

function renderReportForm(i) {
  const zone = document.getElementById('reportZone');
  zone.innerHTML = `
    <div class="card">
      <label for="rReason">${t('report_reason')}</label>
      <select id="rReason">
        <option value="wrong_location">${t('reason_wrong_location')}</option>
        <option value="not_real">${t('reason_not_real')}</option>
        <option value="resolved">${t('reason_resolved')}</option>
        <option value="inappropriate">${t('reason_inappropriate')}</option>
        <option value="other">${t('reason_other')}</option>
      </select>
      <label for="rDetail">${t('report_detail')}</label>
      <textarea id="rDetail" maxlength="500"></textarea>
      <div class="field-error" id="rError" role="alert"></div>
      <button class="btn secondary" id="rSend">${t('report_send')}</button>
    </div>`;
  document.getElementById('rSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      const r = await API.post('/api/public/report', {
        publicId: i.public_id,
        reason: document.getElementById('rReason').value,
        detail: document.getElementById('rDetail').value,
      });
      zone.innerHTML = `<p class="notice ok">${esc(r.message)}</p>`;
    } catch (ex) { document.getElementById('rError').textContent = ex.message; }
  }));
}
