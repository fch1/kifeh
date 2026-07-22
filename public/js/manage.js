// Gestion d'une déclaration via lien signé (bilingue FR/AR).
'use strict';

const token = new URLSearchParams(location.search).get('token');
const content = document.getElementById('content');

async function render() {
  if (!token) {
    content.innerHTML = `<div class="notice danger">${t('manage_missing')}</div>`;
    return;
  }
  let i;
  try { i = await API.get(`/api/manage/incident?token=${encodeURIComponent(token)}`); }
  catch (e) { content.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }

  const ongoing = i.status === 'active' && i.temporalStatus === 'ongoing';
  content.innerHTML = `
    <div class="card">
      <h2>${t('ref')} ${esc(i.publicId)}
        <span class="badge ${esc(i.type)}">${TYPE_ICONS[i.type]} ${esc(TYPE_LABELS[i.type])}</span>
        <span class="badge status ${esc(i.status)}">${esc(STATUS_LABELS[i.status] || i.status)}</span></h2>
      <p class="muted small">${t('started')} ${esc(fmtDate(i.startedAt))}${i.timeApproximate ? ` ${t('approx_suffix')}` : ''}
      ${i.endedAt ? `· ${t('ended')} ${esc(fmtDate(i.endedAt))}` : ''}
      ${i.expiresAt && ongoing ? `<br>${t('expires_in')} ${esc(fmtDate(i.expiresAt))}` : ''}
      ${i.confirmations ? `<br>${t('confirmed_people', { n: i.confirmations })}` : ''}</p>
      <p>${esc(i.description)}</p>
      <p class="muted small">📍 ${esc(i.address || t('position_saved'))} <em>${t('visible_only_you')}</em></p>
      <div id="manageMap"></div>
    </div>

    ${ongoing ? `
    <div class="card">
      <h2>${t('still_q')}</h2>
      <div class="row">
        <button class="btn secondary" id="btnStill">${t('yes_ongoing')}</button>
        <button class="btn" id="btnClose">${t('no_finished')}</button>
      </div>
      <div id="closeZone"></div>
    </div>` : ''}
    ${!ongoing && ['pending_review', 'verified'].includes(i.status) ? `
    <div class="card"><button class="btn" id="btnClose">${t('close_incident')}</button><div id="closeZone"></div></div>` : ''}

    <div class="card">
      <h2>${t('update_desc_title')}</h2>
      <textarea id="descEdit" maxlength="500">${esc(i.description)}</textarea>
      <div class="field-error" id="updError" role="alert"></div>
      <button class="btn secondary" id="btnUpdate">${t('save')}</button>
    </div>

    <div class="card">
      <h2>${t('other_actions')}</h2>
      <button class="btn secondary" id="btnLocIssue">${t('report_loc')}</button>
      <div id="locZone"></div>
      <button class="btn danger" id="btnDelete" style="margin-top:.5rem">${t('delete_mine')}</button>
      <p class="muted small">${t('delete_note')}</p>
    </div>
    <div id="feedback" role="status" aria-live="polite"></div>`;

  setTimeout(() => {
    const m = createMap('manageMap', { center: [i.lat, i.lng], zoom: 15 });
    L.marker([i.lat, i.lng], { icon: typeIcon(i.type, i.status) }).addTo(m);
  }, 50);

  const feedback = (msgText, ok = true) => {
    document.getElementById('feedback').innerHTML = `<div class="notice ${ok ? 'ok' : 'danger'}">${esc(msgText)}</div>`;
    window.scrollTo(0, document.body.scrollHeight);
  };

  document.getElementById('btnStill')?.addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try { await API.post('/api/manage/still-ongoing', { token }); feedback(t('thanks_extended')); render(); }
    catch (ex) { feedback(ex.message, false); }
  }));

  document.getElementById('btnClose')?.addEventListener('click', () => {
    document.getElementById('closeZone').innerHTML = `
      <label for="endEdit">${t('end_time')}</label>
      <div class="row">
        <input id="endEdit" type="datetime-local" value="${toLocalInput(new Date())}">
      </div>
      <div class="checkbox-row"><input type="checkbox" id="endApprox">
        <label for="endApprox">${t('end_approx')}</label></div>
      <div class="field-error" id="closeError" role="alert"></div>
      <button class="btn" id="btnCloseConfirm">${t('confirm_close')}</button>`;
    document.getElementById('btnCloseConfirm').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
      try {
        const endedAt = new Date(document.getElementById('endEdit').value).toISOString();
        await API.post('/api/manage/close', { token, endedAt, timeApproximate: document.getElementById('endApprox').checked });
        feedback(t('closed_thanks'));
        render();
      } catch (ex) { document.getElementById('closeError').textContent = ex.message; }
    }));
  });

  document.getElementById('btnUpdate').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    try {
      await API.post('/api/manage/update', { token, description: document.getElementById('descEdit').value });
      feedback(t('desc_updated'));
    } catch (ex) { document.getElementById('updError').textContent = ex.message; }
  }));

  document.getElementById('btnLocIssue').addEventListener('click', () => {
    document.getElementById('locZone').innerHTML = `
      <label for="locDetail">${t('describe_error')}</label>
      <textarea id="locDetail" maxlength="500"></textarea>
      <button class="btn secondary" id="btnLocSend">${t('send')}</button>`;
    document.getElementById('btnLocSend').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
      try {
        const r = await API.post('/api/manage/location-issue', { token, detail: document.getElementById('locDetail').value });
        feedback(r.message);
        document.getElementById('locZone').innerHTML = '';
      } catch (ex) { feedback(ex.message, false); }
    }));
  });

  document.getElementById('btnDelete').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
    if (!window.confirm(t('confirm_delete'))) return;
    try {
      await API.post('/api/manage/delete', { token });
      content.innerHTML = `<div class="notice ok">${t('deleted_ok')}</div><a class="btn" href="index.html">${t('back_map')}</a>`;
    } catch (ex) { feedback(ex.message, false); }
  }));
}

render();
