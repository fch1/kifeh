// Accueil : carte temps réel, recherche, filtres, liste, détail, confirmation.
'use strict';

const map = createMap('map');
let userPos = null;
let verificationRequired = true;
API.get('/api/public/config').then((c) => { verificationRequired = c.verificationRequired !== false; }).catch(() => {});
let incidents = [];
const filters = { types: new Set(), status: 'active', periodH: '' };

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
  if (filters.periodH) params.set('since', new Date(Date.now() - filters.periodH * 3600_000).toISOString());
  try {
    const data = await API.get(`/api/public/incidents?${params}`);
    incidents = data.incidents;
    cluster.setItems(incidents);
    const n = incidents.filter((i) => i.status === 'active').length;
    document.getElementById('counter').textContent =
      n === 0 ? t('counter_none') : n === 1 ? t('counter_one') : t('counter_n', { n });
  } catch (e) {
    document.getElementById('counter').textContent = e.message;
  }
}
map.on('moveend', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadIncidents, 350); });
loadIncidents();

// --- Temps réel (SSE) -------------------------------------------------------
try {
  const es = new EventSource('/api/events');
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
for (const chip of document.querySelectorAll('.chip[data-type]')) {
  chip.addEventListener('click', () => {
    const t = chip.dataset.type;
    if (filters.types.has(t)) filters.types.delete(t); else filters.types.add(t);
    chip.setAttribute('aria-pressed', filters.types.has(t));
    loadIncidents();
  });
}
document.getElementById('chipOngoing').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on);
  filters.status = on ? 'active' : '';
  document.getElementById('fStatus').value = filters.status;
  loadIncidents();
});
document.getElementById('chipFilters').addEventListener('click', () => openSheet('filterSheet'));
document.getElementById('filterApply').addEventListener('click', () => {
  filters.status = document.getElementById('fStatus').value;
  filters.periodH = document.getElementById('fPeriod').value;
  document.getElementById('chipOngoing').setAttribute('aria-pressed', filters.status === 'active');
  closeSheets(); loadIncidents();
});
document.getElementById('filterReset').addEventListener('click', () => {
  filters.types.clear(); filters.status = 'active'; filters.periodH = '';
  document.querySelectorAll('.chip[data-type]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  document.getElementById('fStatus').value = 'active';
  document.getElementById('fPeriod').value = '';
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

// --- Détail + confirmation + signalement -----------------------------------
async function openDetail(publicId) {
  const el = document.getElementById('detailContent');
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  openSheet('detailSheet');
  let i;
  try { i = await API.get(`/api/public/incidents/${encodeURIComponent(publicId)}`); }
  catch (e) { el.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }

  el.innerHTML = `
    <h2><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
    <p class="muted">${esc(i.area || t('area_approx'))} · ${t('ref')} ${esc(i.public_id)}</p>
    <p><strong>${t('started')}</strong> ${esc(fmtDate(i.started_at))}${i.time_approximate ? ` ${t('approx_suffix')}` : ''}<br>
    ${i.ended_at ? `<strong>${t('ended')}</strong> ${esc(fmtDate(i.ended_at))}<br>` : ''}
    <strong>${t('severity_label')}</strong> ${esc(SEVERITY_LABELS[i.severity])}<br>
    <strong>${t('last_update')}</strong> ${esc(timeAgo(i.updated_at))}</p>
    ${i.description ? `<p>${esc(i.description)}</p>` : ''}
    ${i.confirmations_count > 0 ? `<p class="notice ok">${i.confirmations_count > 1 ? t('confirmed_n', { n: i.confirmations_count }) : t('confirmed_one')}</p>` : ''}
    <div id="confirmZone">
      ${i.status === 'active' ? `<button class="btn" id="btnConfirm">${t('im_affected')}</button>` : ''}
    </div>
    <button class="btn ghost small-btn" id="btnReport" style="margin-top:.5rem">${t('report_content')}</button>
    <div id="reportZone"></div>`;

  document.getElementById('btnConfirm')?.addEventListener('click', (e) => {
    if (!verificationRequired) {
      return withButton(e.currentTarget, async () => {
        try {
          const r = await API.post('/api/public/confirm/direct', { publicId: i.public_id });
          document.getElementById('confirmZone').innerHTML =
            `<p class="notice ok">${r.confirmations > 1 ? t('thanks_n', { n: r.confirmations }) : t('thanks_one')}</p>`;
          loadIncidents();
        } catch (ex) {
          document.getElementById('confirmZone').innerHTML = `<p class="field-error">${esc(ex.message)}</p>`;
        }
      });
    }
    renderConfirmForm(i);
  });
  document.getElementById('btnReport').addEventListener('click', () => renderReportForm(i));
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
      document.getElementById('confirmZone').innerHTML =
        `<p class="notice ok">${r.confirmations > 1 ? t('thanks_n', { n: r.confirmations }) : t('thanks_one')}</p>`;
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
