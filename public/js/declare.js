// Parcours de déclaration en 6 étapes (bilingue FR/AR via t()).
// Brouillon sauvegardé en localStorage : retour arrière et coupures réseau sans perte.
'use strict';

const STORAGE_KEY = 'incident_draft_v1';
const startedFillingAt = Date.now();

const state = Object.assign({
  step: 1, type: null, lat: null, lng: null, locationSource: null, gpsAccuracy: null,
  deviceLat: null, deviceLng: null, address: null, publicArea: null,
  temporalStatus: 'ongoing', startedAt: null, endedAt: null, timeApproximate: false,
  description: '', severity: 'moderate', affectedCount: '', comment: '',
  method: 'sms', phone: '', email: '', emailLink: true,
  incidentId: null, draftToken: null, verificationId: null,
  idempotencyKey: `d-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}, load());

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    // Brouillon de plus de 2 h : repartir de zéro.
    if (!saved.savedAt || Date.now() - saved.savedAt > 2 * 3600_000) return {};
    return saved;
  } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch {}
}
function clearDraft() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }

// --- Navigation entre étapes -----------------------------------------------
const STEPS = ['step1', 'step2', 'step3', 'step4', 'stepDup', 'step5', 'step6', 'stepDone'];
const TITLES = {
  step1: ['t_type', 1], step2: ['t_location', 2], step3: ['t_period', 3], step4: ['t_desc', 4],
  stepDup: ['t_dup', null], step5: ['t_contact', 5], step6: ['t_verif', 6], stepDone: ['t_done', null],
};
const ORDER_FOR_BACK = { step2: 'step1', step3: 'step2', step4: 'step3', stepDup: 'step4', step5: 'step4', step6: 'step5' };

// Nombre d'étapes RÉEL affiché à l'utilisateur : 4 quand la vérification de
// contact est désactivée (le parcours saute contact + code), 6 sinon.
let stepsTotal = 6;
function applyStepsTotal() {
  document.querySelectorAll('#progressBar span').forEach((s, idx) => { s.hidden = idx >= stepsTotal; });
  if (TITLES[state.step]?.[1]) {
    document.getElementById('stepHint').textContent = t('step_of', { n: TITLES[state.step][1], total: stepsTotal });
  }
}

function show(stepId) {
  for (const id of STEPS) document.getElementById(id).hidden = id !== stepId;
  const [titleKey, n] = TITLES[stepId];
  document.getElementById('stepTitle').textContent = t(titleKey);
  document.getElementById('stepHint').textContent =
    n ? t('step_of', { n, total: stepsTotal }) : t(stepId === 'stepDone' ? 'step_done_hint' : 'step_verif_hint');
  const idx = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'].indexOf(stepId);
  document.querySelectorAll('#progressBar span').forEach((s, i) => s.classList.toggle('done', idx >= 0 && i <= idx));
  state.step = stepId; save();
  window.scrollTo(0, 0);
  if (stepId === 'step2') setTimeout(initMiniMap, 50);
}

document.getElementById('btnBack').addEventListener('click', () => {
  const prev = ORDER_FOR_BACK[state.step];
  if (prev) show(prev); else location.href = 'index.html';
});

// --- Étape 1 : type ---------------------------------------------------------
// Configuration serveur : catégorie « Autre », vérification OTP active ou non.
let verificationRequired = true;
API.get('/api/public/config')
  .then((c) => {
    document.getElementById('typeOther').hidden = !c.otherCategoryEnabled;
    if (c.sandbox) {
      const b = document.createElement('div');
      b.className = 'sandbox-banner';
      b.textContent = t('sandbox_banner');
      document.body.appendChild(b);
    }
    verificationRequired = c.verificationRequired !== false;
    if (!verificationRequired) {
      // La vérification est désactivée : le bouton de l'étape 4 publie directement
      // et le parcours affiché compte 4 étapes (pas 6).
      document.getElementById('btnDetailsNext').textContent = t('publish_now');
      stepsTotal = 4;
      applyStepsTotal();
    }
  })
  .catch(() => {});

for (const card of document.querySelectorAll('.type-card')) {
  card.addEventListener('click', () => {
    state.type = card.dataset.type;
    window.track?.('declare_started', { incident_type: state.type });
    document.querySelectorAll('.type-card').forEach((c) => c.setAttribute('aria-pressed', c === card));
    const isFire = state.type === 'fire';
    document.getElementById('fireWarning').hidden = !isFire;
    document.getElementById('fireWarning2').hidden = !isFire;
    save();
    // L'avertissement incendie doit être lu avant de continuer.
    setTimeout(() => show('step2'), isFire ? 1500 : 250);
  });
}

// --- Étape 2 : localisation -------------------------------------------------
let miniMap = null, marker = null;
function initMiniMap() {
  if (miniMap) { miniMap.invalidateSize(); return; }
  miniMap = createMap('miniMap', { center: [34.2, 9.6], zoom: 6 }); // Tunisie
  miniMap.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, 'manual'));
  if (state.lat != null) {
    setPoint(state.lat, state.lng, state.locationSource || 'manual', { silentGeocode: true });
    miniMap.setView([state.lat, state.lng], 15);
    if (state.address) document.getElementById('addrDisplay').textContent = `📍 ${state.address}`;
  }
}

async function setPoint(lat, lng, source, opts = {}) {
  state.lat = lat; state.lng = lng; state.locationSource = source;
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true, icon: typeIcon(state.type || 'other', 'active') }).addTo(miniMap);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      setPoint(p.lat, p.lng, 'manual');
    });
  } else marker.setLatLng([lat, lng]);
  document.getElementById('btnLocationNext').disabled = false;
  save();
  if (!opts.silentGeocode) {
    document.getElementById('addrDisplay').textContent = t('addr_searching');
    try {
      const { result } = await API.get(`/api/public/geocode/reverse?lat=${lat}&lng=${lng}`);
      state.address = result?.label || null;
      state.publicArea = result?.area || null;
      document.getElementById('addrDisplay').textContent = result?.label ? `📍 ${result.label}` : t('addr_saved');
    } catch {
      document.getElementById('addrDisplay').textContent = t('addr_saved');
    }
    save();
  }
}

document.getElementById('btnGeoloc').addEventListener('click', (e) => withButton(e.currentTarget, () => new Promise((resolve) => {
  const errEl = document.getElementById('geoError'); errEl.textContent = '';
  if (!navigator.geolocation) {
    errEl.textContent = t('geo_device_unavailable');
    return resolve();
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      state.deviceLat = latitude; state.deviceLng = longitude; state.gpsAccuracy = accuracy;
      miniMap.setView([latitude, longitude], accuracy > 200 ? 14 : 16);
      setPoint(latitude, longitude, 'gps');
      if (accuracy > 200) errEl.textContent = t('geo_imprecise', { m: Math.round(accuracy) });
      resolve();
    },
    (err) => {
      errEl.textContent = t(err.code === 1 ? 'geo_denied' : 'geo_failed');
      resolve();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
})));

// Autocomplétion d'adresse (accepte arabe et orthographes latines variées).
const addrInput = document.getElementById('addrSearch');
const addrResults = document.getElementById('addrResults');
let addrTimer = null;
addrInput.addEventListener('input', () => {
  clearTimeout(addrTimer);
  const q = addrInput.value.trim();
  if (q.length < 3) { addrResults.hidden = true; return; }
  addrTimer = setTimeout(async () => {
    try {
      const { results } = await API.get(`/api/public/geocode/search?q=${encodeURIComponent(q)}`);
      addrResults.innerHTML = '';
      if (!results.length) {
        const b = document.createElement('button');
        b.disabled = true; b.textContent = t('addr_manual_hint');
        addrResults.appendChild(b);
      }
      for (const r of results) {
        const b = document.createElement('button');
        b.textContent = r.label;
        b.addEventListener('click', () => {
          addrResults.hidden = true;
          addrInput.value = r.label.split(',').slice(0, 2).join(',');
          state.address = r.label; state.publicArea = r.area;
          miniMap.setView([r.lat, r.lng], 16);
          setPoint(r.lat, r.lng, 'address', { silentGeocode: true });
          document.getElementById('addrDisplay').textContent = `📍 ${r.label}`;
        });
        addrResults.appendChild(b);
      }
      addrResults.hidden = false;
    } catch {
      addrResults.innerHTML = '';
      const b = document.createElement('button');
      b.disabled = true; b.textContent = t('search_error');
      addrResults.appendChild(b);
      addrResults.hidden = false;
    }
  }, 350);
});

document.getElementById('btnLocationNext').addEventListener('click', () => {
  if (state.lat == null) return;
  show('step3');
});

// --- Étape 3 : période ------------------------------------------------------
for (const b of document.querySelectorAll('[data-temporal]')) {
  b.addEventListener('click', () => {
    state.temporalStatus = b.dataset.temporal;
    document.querySelectorAll('[data-temporal]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    document.getElementById('endField').hidden = state.temporalStatus !== 'finished';
    document.getElementById('ongoingHint').hidden = state.temporalStatus !== 'ongoing';
    save();
  });
}
document.getElementById('btnNow').addEventListener('click', () => {
  // « Cela vient de commencer » : préremplit la date et l'heure actuelles.
  document.getElementById('startInput').value = toLocalInput(new Date());
});
if (state.startedAt) document.getElementById('startInput').value = toLocalInput(state.startedAt);
if (state.endedAt) document.getElementById('endInput').value = toLocalInput(state.endedAt);
document.getElementById('approxTime').checked = Boolean(state.timeApproximate);

document.getElementById('btnTimeNext').addEventListener('click', () => {
  const err = document.getElementById('timeError'); err.textContent = '';
  const startVal = document.getElementById('startInput').value;
  if (!startVal) { err.textContent = t('err_start_required'); return; }
  const start = new Date(startVal);
  if (start.getTime() > Date.now() + 60_000) {
    err.textContent = t('err_start_future'); return;
  }
  state.startedAt = start.toISOString();
  if (state.temporalStatus === 'finished') {
    const endVal = document.getElementById('endInput').value;
    if (!endVal) { err.textContent = t('err_end_required'); return; }
    const end = new Date(endVal);
    if (end < start) { err.textContent = t('err_end_before'); return; }
    state.endedAt = end.toISOString();
  } else state.endedAt = null;
  state.timeApproximate = document.getElementById('approxTime').checked;
  save();
  show('step4');
});

// --- Étape 4 : détails ------------------------------------------------------
for (const b of document.querySelectorAll('[data-sev]')) {
  b.addEventListener('click', () => {
    state.severity = b.dataset.sev;
    document.querySelectorAll('[data-sev]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    save();
  });
}
document.getElementById('descInput').value = state.description || '';
document.getElementById('commentInput').value = state.comment || '';
document.getElementById('affectedInput').value = state.affectedCount || '';

document.getElementById('btnDetailsNext').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
  const err = document.getElementById('detailError'); err.textContent = '';
  state.description = document.getElementById('descInput').value.trim();
  state.comment = document.getElementById('commentInput').value.trim();
  state.affectedCount = document.getElementById('affectedInput').value;
  save();
  // Détection de doublons.
  try {
    const { similar } = await API.post('/api/declare/check-duplicates', {
      type: state.type, lat: state.lat, lng: state.lng, startedAt: state.startedAt,
    });
    if (similar.length) { renderDuplicates(similar); show('stepDup'); return; }
  } catch { /* en cas d'échec réseau on continue le parcours normal */ }
  if (!verificationRequired) return publishDirect(true);
  show('step5');
}));

function renderDuplicates(similar) {
  const el = document.getElementById('dupList');
  el.innerHTML = '';
  for (const s of similar) {
    const conf = s.confirmations
      ? ` · 👥 ${s.confirmations > 1 ? t('dup_confirmations_n', { n: s.confirmations }) : t('dup_confirmations_one')}` : '';
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <strong>${TYPE_ICONS[s.type]} ${esc(TYPE_LABELS[s.type])}</strong> · ${t('ref')} ${esc(s.publicId)}<br>
      <span class="muted small">${esc(s.area || t('dup_near'))} · ${t('started_ago')} ${esc(fmtDate(s.startedAt))}${conf}</span>
      ${s.description ? `<p class="small">${esc(s.description)}</p>` : ''}
      <button class="btn" data-confirm="${esc(s.publicId)}">${t('dup_confirm')}</button>`;
    el.appendChild(div);
  }
  el.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => {
    // Parcours court : la confirmation se fait sur la fiche de l'incident existant.
    clearDraft();
    location.href = `index.html?confirm=${encodeURIComponent(b.dataset.confirm)}`;
  }));
}
document.getElementById('btnDupNew').addEventListener('click', (e) => {
  if (!verificationRequired) return withButton(e.currentTarget, () => publishDirect(true));
  show('step5');
});

// --- Étape 5 : contact ------------------------------------------------------
for (const b of document.querySelectorAll('[data-method]')) {
  b.addEventListener('click', () => {
    state.method = b.dataset.method;
    document.querySelectorAll('[data-method]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    document.getElementById('phoneField').hidden = state.method !== 'sms';
    document.getElementById('emailField').hidden = state.method !== 'email';
    save();
  });
}
document.getElementById('phoneInput').value = state.phone || '';
document.getElementById('emailInput').value = state.email || '';

document.getElementById('btnContactNext').addEventListener('click', (e) => withButton(e.currentTarget, () => submitContact(true)));

async function submitContact(allowRetry) {
  const err = document.getElementById('contactError'); err.textContent = '';
  state.phone = document.getElementById('phoneInput').value.trim();
  state.email = document.getElementById('emailInput').value.trim();
  state.emailLink = document.getElementById('emailLinkPref').checked;
  if (!document.getElementById('consentCheck').checked) {
    err.textContent = t('err_consent'); return;
  }
  save();
  try {
    // 1-2. Brouillon serveur + pièce jointe éventuelle.
    await ensureDraft();
    // 3. Contact + envoi de la vérification.
    const method = state.method === 'sms' ? 'sms' : (state.emailLink ? 'email_link' : 'email_code');
    const r = await API.post('/api/declare/contact', {
      incidentId: state.incidentId, draftToken: state.draftToken,
      method, phone: state.phone, email: state.email, consent: true,
    });
    state.verificationId = r.verificationId;
    save();
    setupStep6(method);
    show('step6');
  } catch (ex) {
    // Brouillon expiré ou déjà publié (ex. déclaration précédente restée en
    // mémoire) : on repart proprement sur un nouveau brouillon, une seule fois.
    if (allowRetry && (ex.data?.code === 'draft_expired' || ex.status === 403)) {
      state.incidentId = null; state.draftToken = null; state.verificationId = null;
      state.idempotencyKey = `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      save();
      return submitContact(false);
    }
    err.textContent = ex.message;
  }
}

// --- Publication directe (vérification OTP désactivée par l'admin) -----------
async function ensureDraft() {
  if (state.incidentId) return;
  const draft = await API.post('/api/declare/draft', {
    type: state.type, lat: state.lat, lng: state.lng,
    locationSource: state.locationSource, gpsAccuracy: state.gpsAccuracy,
    deviceLat: state.deviceLat, deviceLng: state.deviceLng,
    address: state.address, publicArea: state.publicArea,
    temporalStatus: state.temporalStatus, startedAt: state.startedAt,
    endedAt: state.endedAt, timeApproximate: state.timeApproximate,
    description: state.description, severity: state.severity,
    affectedCount: state.affectedCount, comment: state.comment,
    website: document.getElementById('website').value, // honeypot
    fillSeconds: Math.round((Date.now() - startedFillingAt) / 1000),
    idempotencyKey: state.idempotencyKey,
  });
  state.incidentId = draft.incidentId;
  state.draftToken = draft.draftToken;
  save();
  const file = document.getElementById('photoInput').files[0];
  if (file) {
    const fd = new FormData();
    fd.append('incidentId', state.incidentId);
    fd.append('draftToken', state.draftToken);
    fd.append('file', file);
    await API.post('/api/declare/upload', fd, { timeout: 60000 }).catch((ex) => {
      console.warn('Pièce jointe non envoyée :', ex.message);
    });
  }
}

async function publishDirect(allowRetry) {
  const err = document.getElementById('detailError'); err.textContent = '';
  try {
    await ensureDraft();
    const r = await API.post('/api/declare/publish-unverified', {
      incidentId: state.incidentId, draftToken: state.draftToken,
    });
    finish(r);
  } catch (ex) {
    if (allowRetry && (ex.data?.code === 'draft_expired' || ex.status === 403)) {
      state.incidentId = null; state.draftToken = null;
      state.idempotencyKey = `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      save();
      return publishDirect(false);
    }
    err.textContent = ex.message;
  }
}

// --- Étape 6 : vérification -------------------------------------------------
let pollTimer = null;
function setupStep6(method) {
  const isLink = method === 'email_link';
  document.getElementById('otpZone').hidden = isLink;
  document.getElementById('emailWaitZone').hidden = !isLink;
  if (isLink) {
    document.getElementById('emailShown').textContent = state.email;
    armResend('btnResendLink');
    // Le lien e-mail publie côté serveur ; on interroge le statut du brouillon.
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const r = await API.get(`/api/manage/incident?token=${encodeURIComponent(state.draftToken)}`);
        if (r && r.status !== 'pending_verification' && r.status !== 'draft') {
          clearInterval(pollTimer);
          document.getElementById('waitStatus').textContent = t('email_confirmed');
          finishFromManage(r);
        }
      } catch { // le jeton de brouillon est révoqué à la publication → on informe
        clearInterval(pollTimer);
        document.getElementById('waitStatus').textContent = t('email_confirmed_alt');
      }
    }, 4000);
  } else {
    document.getElementById('otpHint').textContent = state.method === 'sms'
      ? t('otp_hint_sms', { phone: state.phone })
      : t('otp_hint_email', { email: state.email });
    armResend('btnResend');
  }
}

function armResend(btnId) {
  const btn = document.getElementById(btnId);
  let left = 60;
  btn.disabled = true;
  const base = t(btnId === 'btnResend' ? 'resend_code' : 'resend_link');
  btn.textContent = `${base} (${left})`;
  const timer = setInterval(() => {
    left--;
    btn.textContent = `${base} (${left})`;
    if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = base; }
  }, 1000);
}

document.getElementById('btnResend').addEventListener('click', (e) => withButton(e.currentTarget, resendCode));
document.getElementById('btnResendLink').addEventListener('click', (e) => withButton(e.currentTarget, resendCode));
async function resendCode() {
  try {
    await API.post('/api/declare/resend', { verificationId: state.verificationId });
    armResend(document.getElementById('otpZone').hidden ? 'btnResendLink' : 'btnResend');
  } catch (ex) {
    const el = document.getElementById(document.getElementById('otpZone').hidden ? 'waitStatus' : 'otpError');
    el.textContent = ex.message;
  }
}

document.getElementById('btnVerify').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
  const err = document.getElementById('otpError'); err.textContent = '';
  const code = document.getElementById('otpInput').value.trim();
  if (!/^\d{6}$/.test(code)) { err.textContent = t('err_otp_format'); return; }
  try {
    const r = await API.post('/api/declare/verify', { verificationId: state.verificationId, code });
    finish(r);
  } catch (ex) {
    err.textContent = ex.message;
    if (ex.data?.expired) document.getElementById('btnResend').disabled = false;
  }
}));

// --- Panneau d'urgence tunisien (selon le type d'incident) -------------------
// Les numéros viennent EXCLUSIVEMENT de l'annuaire vérifié du serveur : aucun
// numéro en dur ici, jamais de numéro étranger. Incendie → Protection civile
// en action principale ; électricité → STEG ; eau → SONEDE. La Protection
// civile est ajoutée aux pannes uniquement en cas de danger déclaré.
async function renderEmergencyPanel(type, severity) {
  const host = document.getElementById('emergencyPanel');
  if (!host) return;
  host.innerHTML = '';
  if (!['fire', 'electricity', 'water'].includes(type)) return;
  let contacts;
  try { ({ contacts } = await API.get(`/api/public/contacts?type=${encodeURIComponent(type)}`)); }
  catch { return; }
  if (!contacts?.length) return;

  const danger = severity === 'immediate_danger' || severity === 'high';
  let list = contacts;
  if (type !== 'fire') {
    // Panne ordinaire : fournisseur d'abord ; Protection civile seulement en cas de danger.
    const pc = contacts.find((c) => c.id === 'protection_civile');
    list = contacts.filter((c) => c.id !== 'protection_civile');
    if (danger && pc) list = [pc, ...list];
  }
  const isFire = type === 'fire';
  const nameOf = (c) => (LANG === 'ar' ? c.name_ar : c.name_fr);
  const callBtn = (c, primary) =>
    `<a class="btn call-btn${primary ? ' call-primary' : ' secondary'}" href="tel:${esc(c.phone_tel)}">
       ${esc(t('call_btn', { name: nameOf(c), num: c.phone_display }))}</a>`;

  const [first, ...rest] = list;
  host.innerHTML = `
    <div class="emergency-panel${isFire || danger ? ' danger' : ''}" role="alert">
      <h2>${isFire ? t('emergency_title') : t('useful_numbers')}</h2>
      ${isFire ? `<p><strong>${t('fire_safety_msg')}</strong></p><p class="small">${t('fire_safety_donts')}</p>` : ''}
      ${danger && !isFire ? `<p><strong>${t('provider_note_danger')}</strong></p>` : ''}
      ${callBtn(first, true)}
      ${rest.slice(0, 3).map((c) => callBtn(c, false)).join('')}
      ${type === 'electricity' ? `<p class="small">${t('provider_note_electricity')}</p>
        <p class="small"><a href="https://www.steg.com.tn" target="_blank" rel="noopener">${t('steg_site_link')}</a></p>` : ''}
      ${type === 'water' ? `<p class="small">${t('provider_note_water')}</p>` : ''}
    </div>`;
}

function finish(r) {
  clearInterval(pollTimer);
  clearDraft();
  window.track?.('incident_published', { incident_type: r.incident?.type, status: r.status });
  renderEmergencyPanel(r.incident?.type || state.type, state.severity);
  const i = r.incident;
  document.getElementById('doneSummary').innerHTML = `
    <h2>${t('ref')} ${esc(r.publicId)}</h2>
    <p><span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
       <span class="badge status ${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span></p>
    <p class="muted">${esc(i.area || t('area_approx'))}<br>${t('started')} ${esc(fmtDate(i.startedAt))}</p>
    ${r.pendingReview ? `<p class="notice warn">${t('pending_review_note')}</p>` : `<p class="notice ok">${t('visible_note')}</p>`}`;
  const link = document.getElementById('manageLink');
  link.href = r.manageUrl;
  document.getElementById('btnCopyLink').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(r.manageUrl); e.target.textContent = t('link_copied'); }
    catch { prompt(t('copy_prompt'), r.manageUrl); }
  });
  show('stepDone');
}

function finishFromManage(r) {
  clearDraft();
  renderEmergencyPanel(r.type, state.severity);
  document.getElementById('doneSummary').innerHTML = `
    <h2>${t('ref')} ${esc(r.publicId)}</h2>
    <p><span class="badge ${esc(r.type)}">${TYPE_ICONS[r.type]} ${esc(TYPE_LABELS[r.type])}</span>
       <span class="badge status ${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span></p>
    <p class="notice ok">${t('email_link_sent_note')}</p>`;
  document.getElementById('followHint').textContent = t('email_link_sent_note');
  document.getElementById('manageLink').hidden = true;
  document.getElementById('btnCopyLink').hidden = true;
  show('stepDone');
}

// --- Restauration du brouillon ---------------------------------------------
(function restore() {
  if (state.type) {
    const card = document.querySelector(`.type-card[data-type="${state.type}"]`);
    card?.setAttribute('aria-pressed', 'true');
    document.getElementById('fireWarning').hidden = state.type !== 'fire';
    document.getElementById('fireWarning2').hidden = state.type !== 'fire';
  }
  document.querySelectorAll('[data-temporal]').forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.temporal === state.temporalStatus));
  document.getElementById('endField').hidden = state.temporalStatus !== 'finished';
  document.querySelectorAll('[data-sev]').forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.sev === state.severity));
  document.querySelectorAll('[data-method]').forEach((b) =>
    b.setAttribute('aria-pressed', b.dataset.method === state.method));
  document.getElementById('phoneField').hidden = state.method !== 'sms';
  document.getElementById('emailField').hidden = state.method !== 'email';
  // Reprend à l'étape sauvegardée (jamais au-delà de l'étape 5 sans brouillon serveur).
  const resumable = ['step1', 'step2', 'step3', 'step4', 'step5'];
  show(resumable.includes(state.step) ? state.step : 'step1');
})();
