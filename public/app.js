'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let tab = 'report';

  function token() { try { return localStorage.getItem('iit_token') || ''; } catch { return ''; } }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const r = await fetch(path, { ...opts, headers });
    if (r.status === 401) {
      const t = prompt('Token de acceso:');
      if (t) { try { localStorage.setItem('iit_token', t); } catch {} return api(path, opts); }
    }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  function qs(extra = {}) {
    const p = new URLSearchParams({ from: $('#from').value, to: $('#to').value, ...extra });
    if ($('#pin').value.trim()) p.set('pin', $('#pin').value.trim());
    if (token()) p.set('token', token());
    return p.toString();
  }

  function table(el, cols, rows) {
    if (!rows.length) { el.innerHTML = '<tr><td class="empty">Sin datos para el rango seleccionado</td></tr>'; return; }
    el.innerHTML = '<thead><tr>' + cols.map((c) => `<th>${esc(c[1])}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + cols.map((c) => `<td>${c[2] ? c[2](r) : esc(r[c[0]])}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }

  const loaders = {
    async report() {
      const rows = await api('/api/report/daily?' + qs());
      const people = new Set(rows.map((r) => r.pin)).size;
      const inc = rows.filter((r) => r.incomplete).length;
      $('#stats').innerHTML = `
        <div class="stat"><b>${people}</b><small>personas con marcación</small></div>
        <div class="stat"><b>${rows.length}</b><small>jornadas</small></div>
        <div class="stat"><b style="color:var(--amber)">${inc}</b><small>jornadas incompletas</small></div>`;
      table($('#t-report'), [
        ['date', 'Fecha'], ['pin', 'Código'], ['name', 'Nombre'], ['department', 'Área'],
        ['firstIn', 'Entrada'], ['lastOut', 'Salida'], ['worked', 'Horas'],
        ['marks', 'Marcaciones', (r) => esc(r.marks.join(' · '))],
        ['incomplete', 'Estado', (r) => r.incomplete ? '<span class="tag warn">incompleta</span>' : '<span class="tag ok">ok</span>'],
      ], rows);
      $('#csv').href = '/api/report/daily?' + qs({ format: 'csv' });
    },
    async punches() {
      const rows = await api('/api/punches?' + qs());
      table($('#t-punches'), [['ts', 'Fecha/hora'], ['pin', 'Código'], ['name', 'Nombre'], ['device_sn', 'Equipo'], ['verify', 'Verif.']], rows);
      $('#csv').href = '/api/punches?' + qs({ format: 'csv' });
    },
    async employees() {
      const rows = await api('/api/employees');
      table($('#t-employees'), [
        ['pin', 'Código'],
        ['name', 'Nombre', (r) => `<input data-pin="${esc(r.pin)}" data-f="name" value="${esc(r.name)}">`],
        ['department', 'Área', (r) => `<input data-pin="${esc(r.pin)}" data-f="department" value="${esc(r.department)}">`],
        ['card', 'Tarjeta'],
        ['push', '', (r) => `<button data-push="${esc(r.pin)}">Enviar a equipos</button>`],
      ], rows);
    },
    async devices() {
      const rows = await api('/api/devices');
      $('#devices').innerHTML = rows.length ? rows.map((d) => `
        <div class="card">
          <h3>${esc(d.alias || d.sn)} ${d.online ? '<span class="tag ok">en línea</span>' : '<span class="tag off">desconectado</span>'}</h3>
          <dl>
            <dt>Serie</dt><dd>${esc(d.sn)}</dd><dt>IP</dt><dd>${esc(d.ip)}</dd>
            <dt>Firmware</dt><dd>${esc(d.firmware || '—')}</dd>
            <dt>Usuarios</dt><dd>${esc(d.user_count ?? '—')}</dd><dt>Registros</dt><dd>${esc(d.punch_count ?? '—')}</dd>
            <dt>Último contacto</dt><dd>${esc(d.last_seen)} UTC</dd>
          </dl>
          <div class="actions">
            <button data-cmd="queryUsers" data-sn="${esc(d.sn)}">Traer usuarios</button>
            <button data-cmd="queryAttlog" data-sn="${esc(d.sn)}">Re-descargar marcaciones</button>
            <button data-cmd="info" data-sn="${esc(d.sn)}">Info</button>
            <button data-alias="${esc(d.sn)}">Renombrar</button>
          </div>
        </div>`).join('') : '<p class="empty">Ningún equipo se ha conectado todavía. Configura el biométrico en modo ADMS apuntando a este servidor.</p>';
    },
  };

  async function load() {
    try { await loaders[tab](); } catch (e) { toast('Error: ' + e.message); }
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.tab) {
        tab = b.dataset.tab;
        document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + tab));
        $('#csv').style.display = tab === 'report' || tab === 'punches' ? '' : 'none';
        return load();
      }
      if (b.id === 'refresh') return load();
      if (b.dataset.cmd) {
        const body = { type: b.dataset.cmd, from: $('#from').value, to: $('#to').value };
        await api(`/api/devices/${encodeURIComponent(b.dataset.sn)}/commands`, { method: 'POST', body: JSON.stringify(body) });
        return toast('Comando en cola; el equipo lo toma en su próximo contacto');
      }
      if (b.dataset.alias) {
        const alias = prompt('Nombre del equipo (ej. Portería):'); if (alias == null) return;
        await api(`/api/devices/${encodeURIComponent(b.dataset.alias)}`, { method: 'PATCH', body: JSON.stringify({ alias }) });
        return load();
      }
      if (b.dataset.push) {
        const r = await api(`/api/employees/${encodeURIComponent(b.dataset.push)}/push`, { method: 'POST', body: '{}' });
        return toast(`Enviado a ${r.queued.length} equipo(s)`);
      }
    } catch (e) { toast('Error: ' + e.message); }
  });

  document.addEventListener('change', async (ev) => {
    const i = ev.target; if (!i.dataset.pin) return;
    try {
      await api(`/api/employees/${encodeURIComponent(i.dataset.pin)}`, { method: 'PATCH', body: JSON.stringify({ [i.dataset.f]: i.value }) });
      toast('Guardado');
    } catch (e) { toast('Error: ' + e.message); }
  });

  const d = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  $('#from').value = d; $('#to').value = d;
  load();
  setInterval(() => { if (tab === 'devices' || tab === 'report') load(); }, 30000);
})();
