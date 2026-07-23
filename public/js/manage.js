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

  // Correction de localisation par le déclarant : appliquée directement à SA
  // déclaration (repère déplaçable + recherche d'adresse + position GPS).
  document.getElementById('btnLocIssue').addEventListener('click', () => {
    document.getElementById('locZone').innerHTML = `
      <p class="muted small">${t('loc_correct_hint_owner')}</p>
      <button class="btn secondary small-btn" id="ownGeo">${t('use_position')}</button>
      <div class="searchbox" style="margin-top:.5rem">
        <input id="ownSearch" type="text" autocomplete="off" placeholder="${esc(t('addr_ph'))}">
        <div id="ownResults" class="search-results" role="listbox" hidden></div>
      </div>
      <div id="ownMap" class="mini-map" aria-label="${esc(t('minimap_aria'))}"></div>
      <p class="muted small" id="ownPreview" aria-live="polite"></p>
      <div class="field-error" id="ownError" role="alert"></div>
      <button class="btn" id="ownApply" disabled>${t('loc_correct_apply')}</button>`;
    const st = { lat: i.lat, lng: i.lng, address: null, area: null };
    setTimeout(() => {
      const om = createMap('ownMap', { center: [i.lat, i.lng], zoom: 15 });
      const mk = L.marker([i.lat, i.lng], { draggable: true, icon: typeIcon(i.type, i.status) }).addTo(om);
      const setPos = async (lat, lng, address, area) => {
        st.lat = lat; st.lng = lng; st.address = address || null; st.area = area || null;
        mk.setLatLng([lat, lng]);
        document.getElementById('ownApply').disabled = false;
        document.getElementById('ownPreview').textContent = `${t('loc_correct_preview')} ${address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`;
        if (!address) {
          try {
            const { result } = await API.get(`/api/public/geocode/reverse?lat=${lat}&lng=${lng}`);
            if (result?.label) {
              st.address = result.label; st.area = result.area || null;
              document.getElementById('ownPreview').textContent = `${t('loc_correct_preview')} ${result.label}`;
            }
          } catch { /* la position seule suffit */ }
        }
      };
      mk.on('dragend', () => { const p = mk.getLatLng(); setPos(p.lat, p.lng); });
      om.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng));
      document.getElementById('ownGeo').addEventListener('click', (e) => withButton(e.currentTarget, () => new Promise((resolve) => {
        if (!navigator.geolocation) { document.getElementById('ownError').textContent = t('geo_unavailable'); return resolve(); }
        navigator.geolocation.getCurrentPosition(
          (pos) => { om.setView([pos.coords.latitude, pos.coords.longitude], 16); setPos(pos.coords.latitude, pos.coords.longitude); resolve(); },
          () => { document.getElementById('ownError').textContent = t('geo_not_found'); resolve(); },
          { enableHighAccuracy: true, timeout: 8000 });
      })));
      const inp = document.getElementById('ownSearch');
      const resBox = document.getElementById('ownResults');
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
                om.setView([r.lat, r.lng], 16);
                setPos(r.lat, r.lng, r.label, r.area);
              });
              resBox.appendChild(b);
            }
            resBox.hidden = results.length === 0;
          } catch { resBox.hidden = true; }
        }, 350);
      });
    }, 60);
    document.getElementById('ownApply').addEventListener('click', (e) => withButton(e.currentTarget, async () => {
      try {
        const r = await API.post('/api/manage/update-location', {
          token, lat: st.lat, lng: st.lng, address: st.address, publicArea: st.area,
        });
        feedback(r.message);
        render(); // recharge la fiche avec la nouvelle position
      } catch (ex) { document.getElementById('ownError').textContent = ex.message; }
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
