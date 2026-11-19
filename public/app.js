'use strict';
/* IIT Asistencia — panel web (vanilla JS, sin dependencias) */
(() => {
  // ═════════════════════════ utilidades
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };
  const bogota = () => new Date(Date.now() - 5 * 3600000);
  const today = () => bogota().toISOString().slice(0, 10);
  const monthStart = () => today().slice(0, 8) + '01';
  const fullName = (e) => [e.name, e.last_name].filter(Boolean).join(' ');
  const DAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  function token() { return store.get('iit_token', ''); }
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const r = await fetch(path, { ...opts, headers, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    if (r.status === 401) {
      const t = prompt('Este servidor está protegido. Escribe el token de acceso:');
      if (t) { store.set('iit_token', t); return api(path, opts); }
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }
  const withToken = (url) => (token() ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token()) : url);

  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = ''), isErr ? 4500 : 2600);
  }
  const fail = (e) => toast(e.message || String(e), true);

  // ═════════════════════════ modal de formulario
  /**
   * fields: [{ key, label, type, options, req, readonly, hint, wide, placeholder }]
   * onSubmit(values) → si lanza, el error se muestra en el modal.
   */
  function openForm({ title, fields, values = {}, onSubmit, okText = 'Confirmar', oneCol = false }) {
    const back = $('#modal-back');
    const body = $('#modal-body');
    $('#modal-title').textContent = title;
    $('#modal-ok').textContent = okText;
    $('#modal-error').textContent = '';
    body.className = 'modal-body' + (oneCol ? ' one' : '');
    body.innerHTML = fields.map((f) => fieldHtml(f, values[f.key])).join('');
    back.classList.add('show');
    const first = $('input:not([readonly]),select,textarea', body);
    if (first) first.focus();

    return new Promise((resolve) => {
      const close = (v) => { back.classList.remove('show'); form.onsubmit = null; resolve(v); };
      const form = $('#modal-form');
      $('#modal-close').onclick = () => close(null);
      $('#modal-cancel').onclick = () => close(null);
      back.onclick = (ev) => { if (ev.target === back) close(null); };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const vals = readForm(fields, body);
        const missing = fields.find((f) => f.req && (vals[f.key] === '' || vals[f.key] == null));
        if (missing) { $('#modal-error').textContent = `El campo "${missing.label}" es obligatorio`; return; }
        $('#modal-ok').disabled = true;
        try { const r = await onSubmit(vals); close(r ?? true); } catch (e) { $('#modal-error').textContent = e.message; } finally { $('#modal-ok').disabled = false; }
      };
    });
  }

  function fieldHtml(f, v) {
    const id = 'f_' + f.key;
    const val = v ?? f.default ?? '';
    const ro = f.readonly ? ' readonly' : '';
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}" name="${f.key}">${(f.options || []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.key}" rows="3"${ro}>${esc(val)}</textarea>`;
    } else if (f.type === 'days') {
      const on = String(val || '1,2,3,4,5').split(',');
      input = `<div class="days" id="${id}">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" value="${d}"${on.includes(String(d)) ? ' checked' : ''}>${DAYS[d]}</label>`).join('')}</div>`;
    } else if (f.type === 'checkbox') {
      input = `<label><input type="checkbox" id="${id}" name="${f.key}"${val ? ' checked' : ''}> ${esc(f.text || '')}</label>`;
    } else {
      input = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(val)}"${ro}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}>`;
    }
    return `<label class="field${f.wide ? ' wide' : ''}"><span class="${f.req ? 'req' : ''}">${esc(f.label)}</span>${input}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</label>`;
  }

  function readForm(fields, root) {
    const out = {};
    for (const f of fields) {
      const el = $('#f_' + f.key, root);
      if (!el) continue;
      if (f.type === 'days') out[f.key] = $$('input:checked', el).map((c) => c.value).join(',');
      else if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'number') out[f.key] = el.value === '' ? '' : Number(el.value);
      else out[f.key] = el.value.trim();
    }
    return out;
  }

  const confirmBox = (title, text, okText = 'Confirmar') =>
    openForm({ title, oneCol: true, okText, fields: [{ key: '_msg', label: '', type: 'textarea', readonly: true, wide: true }], values: { _msg: text }, onSubmit: () => true });

  // ═════════════════════════ tabla con búsqueda, orden, selección y paginación
  function grid(container, { columns, rows, key = 'id', selectable = true, onOpen, empty = 'Sin registros', pageSizes = [16, 50, 100, 500] }) {
    const state = { q: '', sort: null, dir: 1, page: 0, size: store.get('iit_page', 16), sel: new Set() };
    container.innerHTML = `<div class="table-wrap"><table class="grid"><thead></thead><tbody></tbody></table></div>
      <div class="pager"><button class="btn" data-p="-1">‹</button><span data-info></span><button class="btn" data-p="1">›</button>
      <select data-size>${pageSizes.map((n) => `<option${n === state.size ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <span style="flex:1"></span><span data-total></span></div>`;
    const thead = $('thead', container), tbody = $('tbody', container);

    const cell = (c, r) => (c.render ? c.render(r) : esc(Array.isArray(r[c.key]) ? r[c.key].join(' · ') : r[c.key]));
    function filtered() {
      let list = rows;
      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)));
      }
      if (state.sort) {
        const k = state.sort;
        list = [...list].sort((a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'es', { numeric: true }) * state.dir);
      }
      return list;
    }
    function draw() {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / state.size));
      state.page = Math.min(state.page, pages - 1);
      const slice = list.slice(state.page * state.size, (state.page + 1) * state.size);
      thead.innerHTML = '<tr>' + (selectable ? '<th class="chk"><input type="checkbox" data-all></th>' : '') +
        columns.map((c) => `<th data-k="${esc(c.key)}">${esc(c.label)}${state.sort === c.key ? (state.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>';
      tbody.innerHTML = slice.length
        ? slice.map((r) => {
            const k = String(r[key]);
            return `<tr data-key="${esc(k)}" class="${state.sel.has(k) ? 'sel' : ''}">` +
              (selectable ? `<td class="chk"><input type="checkbox"${state.sel.has(k) ? ' checked' : ''}></td>` : '') +
              columns.map((c, i) => `<td class="${c.cls || ''}${i === 0 && onOpen ? ' link' : ''}">${cell(c, r)}</td>`).join('') + '</tr>';
          }).join('')
        : `<tr><td class="empty" colspan="${columns.length + (selectable ? 1 : 0)}">${esc(empty)}</td></tr>`;
      $('[data-info]', container).textContent = `Página ${state.page + 1} de ${pages}`;
      $('[data-total]', container).textContent = `Total ${list.length} registros` + (state.sel.size ? ` · ${state.sel.size} seleccionados` : '');
      api.onSel && api.onSel(state.sel.size);
    }
    container.addEventListener('click', (ev) => {
      const th = ev.target.closest('th[data-k]');
      if (th) { state.dir = state.sort === th.dataset.k ? -state.dir : 1; state.sort = th.dataset.k; return draw(); }
      if (ev.target.matches('[data-all]')) {
        const keys = filtered().slice(state.page * state.size, (state.page + 1) * state.size).map((r) => String(r[key]));
        keys.forEach((k) => (ev.target.checked ? state.sel.add(k) : state.sel.delete(k)));
        return draw();
      }
      const p = ev.target.closest('[data-p]');
      if (p) { state.page = Math.max(0, state.page + Number(p.dataset.p)); return draw(); }
      const tr = ev.target.closest('tbody tr[data-key]');
      if (!tr) return;
      if (ev.target.closest('td.link') && onOpen) return onOpen(rows.find((r) => String(r[key]) === tr.dataset.key));
      if (selectable && !ev.target.closest('button,a,input:not([type=checkbox])')) {
        const k = tr.dataset.key;
        state.sel.has(k) ? state.sel.delete(k) : state.sel.add(k);
        draw();
      }
    });
    $('[data-size]', container).onchange = (ev) => { state.size = Number(ev.target.value); store.set('iit_page', state.size); draw(); };
    const api = {
      search(q) { state.q = q; state.page = 0; draw(); },
      selected: () => rows.filter((r) => state.sel.has(String(r[key]))),
      setRows(r) { rows = r; state.sel.clear(); draw(); },
      rows: () => filtered(),
      onSel: null,
    };
    draw();
    return api;
  }

  /** Página estándar: barra de herramientas + tabla */
  function listPage(root, { buttons = [], search = true, extra = '' }) {
    root.innerHTML = `<div class="card"><div class="toolbar">${buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-b="${i}"${b.needSel ? ' disabled' : ''}>${esc(b.label)}</button>`).join('')}
      ${extra}<span class="grow"></span>${search ? '<input type="search" placeholder="Buscar…" data-search size="22">' : ''}</div><div data-grid></div></div>`;
    return { gridEl: $('[data-grid]', root), bind(g) {
      g.onSel = (n) => buttons.forEach((b, i) => { if (b.needSel) $(`[data-b="${i}"]`, root).disabled = b.needSel === 1 ? n !== 1 : n === 0; });
      g.onSel(0);
      buttons.forEach((b, i) => ($(`[data-b="${i}"]`, root).onclick = () => Promise.resolve(b.run(g.selected())).catch(fail)));
      const s = $('[data-search]', root);
      if (s) s.oninput = () => g.search(s.value);
    } };
  }

  // ═════════════════════════ catálogos compartidos
  const cache = {};
  async function catalogs() {
    const [departments, schedules, areas, devices, incidentTypes] = await Promise.all([
      api('/api/departments'), api('/api/schedules'), api('/api/areas'), api('/api/devices'), cache.incidentTypes || api('/api/incident-types'),
    ]);
    Object.assign(cache, { departments, schedules, areas, devices, incidentTypes });
    return cache;
  }
  const opts = (list, label, value = 'id', blank = '— Ninguno —') => [{ value: '', label: blank }, ...list.map((x) => ({ value: x[value], label: typeof label === 'function' ? label(x) : x[label] }))];
  const yesNo = (v) => (v ? '<span class="tag ok">Sí</span>' : '<span class="tag gray">No</span>');
  const TZ_OPTS = Array.from({ length: 27 }, (_, i) => i - 12).map((h) => ({ value: h, label: `UTC${h >= 0 ? '+' : '−'}${String(Math.abs(h)).padStart(2, '0')}:00${h === -5 ? ' (Colombia)' : ''}` }));

  // ═════════════════════════ páginas
  const pages = {};

  // ── Tablero
  pages.dashboard = async (root) => {
    const d = await api('/api/dashboard');
    const max = Math.max(1, ...d.byHour);
    root.innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${d.employees}</b><small>Empleados activos</small></div>
        <div class="kpi ok"><b>${d.present}</b><small>Presentes hoy</small></div>
        <div class="kpi warn"><b>${d.late}</b><small>Llegadas tarde</small></div>
        <div class="kpi"><b>${d.onLeave}</b><small>Con novedad (vacaciones, permisos…)</small></div>
        <div class="kpi bad"><b>${d.pending}</b><small>Sin marcar todavía</small></div>
        <div class="kpi ${d.devicesOnline === d.devices.length && d.devices.length ? 'ok' : 'bad'}"><b>${d.devicesOnline}/${d.devices.length}</b><small>Equipos en línea</small></div>
      </div>
      ${d.isHoliday ? '<p class="tag info" style="margin:0 0 10px">Hoy es festivo en Colombia</p>' : ''}
      <div class="dash">
        <div class="card"><h3>Marcaciones por hora — ${esc(d.date)}</h3>
          <div class="bars">${d.byHour.map((n, h) => `<div data-n="${n}" style="height:${(n / max) * 100}%" title="${h}:00 → ${n}"></div>`).join('')}</div>
          <div class="bar-labels">${d.byHour.map((_, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('')}</div>
        </div>
        <div class="card"><h3>Equipos</h3><ul class="list">${d.devices.map((x) => `<li><span><span class="dot ${x.online ? 'on' : 'off'}"></span> ${esc(x.alias || x.sn)}</span><small>${x.online ? 'En línea' : 'Desconectado'}</small></li>`).join('') || '<li>Sin equipos registrados</li>'}</ul></div>
        <div class="card" style="grid-column:1/-1"><h3>Últimas marcaciones</h3><div data-g></div></div>
      </div>`;
    grid($('[data-g]', root), {
      selectable: false, key: 'ts', rows: d.lastPunches, empty: 'Aún no hay marcaciones hoy',
      columns: [{ key: 'ts', label: 'Fecha/hora' }, { key: 'pin', label: 'Código' }, { key: 'name', label: 'Nombre' }, { key: 'device_sn', label: 'Equipo' }],
    });
  };

  // ── Empleados
  pages.employees = async (root) => {
    const c = await catalogs();
    const rows = await api('/api/employees');
    const fields = (isNew) => [
      { key: 'pin', label: 'Código (ID en el equipo)', req: true, readonly: !isNew, hint: isNew ? 'Numérico, el mismo que usa el biométrico' : '' },
      { key: 'card', label: 'Tarjeta' },
      { key: 'name', label: 'Nombre', req: true }, { key: 'last_name', label: 'Apellido' },
      { key: 'department_id', label: 'Departamento', type: 'select', options: opts(c.departments, 'name') },
      { key: 'position', label: 'Cargo' },
      { key: 'schedule_id', label: 'Horario', type: 'select', options: opts(c.schedules, 'name', 'id', '— El del departamento —') },
      { key: 'hire_date', label: 'Fecha de ingreso', type: 'date' },
      { key: 'active', label: 'Estado', type: 'select', options: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Retirado' }] },
      ...(isNew ? [{ key: 'sendToDevices', label: 'Equipos', type: 'checkbox', text: 'Enviar al biométrico al guardar' }] : []),
    ];
    const edit = async (e) => {
      const ok = await openForm({ title: 'Editar empleado', fields: fields(false), values: e, onSubmit: (v) => api('/api/employees/' + encodeURIComponent(e.pin), { method: 'PUT', body: { ...v, active: Number(v.active) } }) });
      if (ok) { toast('Empleado actualizado'); render(); }
    };
    const p = listPage(root, {
      buttons: [
        { label: 'Nuevo', primary: true, run: async () => {
          const ok = await openForm({ title: 'Nuevo empleado', fields: fields(true), values: { active: 1, sendToDevices: true }, onSubmit: (v) => api('/api/employees', { method: 'POST', body: { ...v, active: Number(v.active) } }) });
          if (ok) { toast('Empleado creado'); render(); }
        } },
        { label: 'Editar', needSel: 1, run: (s) => edit(s[0]) },
        { label: 'Borrar', danger: true, needSel: 2, run: async (s) => {
          const ok = await openForm({ title: 'Borrar empleados', oneCol: true, okText: 'Borrar',
            fields: [{ key: 'fromDevices', label: 'Equipos', type: 'checkbox', text: 'Borrarlos también del biométrico (huellas incluidas)' }],
            values: { fromDevices: false },
            onSubmit: async (v) => { for (const e of s) await api(`/api/employees/${encodeURIComponent(e.pin)}${v.fromDevices ? '?fromDevices=1' : ''}`, { method: 'DELETE' }); } });
          if (ok) { toast(`${s.length} empleado(s) borrado(s). Sus marcaciones se conservan.`); render(); }
        } },
        { label: 'Enviar a equipos', needSel: 2, run: async (s) => {
          for (const e of s) await api(`/api/employees/${encodeURIComponent(e.pin)}/push`, { method: 'POST', body: {} });
          toast(`${s.length} empleado(s) en cola para el biométrico`);
        } },
        { label: 'Traer del equipo', run: async () => { const r = await api('/api/employees/sync', { method: 'POST', body: {} }); toast(`Solicitado a ${r.queued.length} equipo(s). Recarga en un minuto.`); } },
      ],
    });
    const g = grid(p.gridEl, {
      rows, key: 'pin', onOpen: edit,
      columns: [
        { key: 'pin', label: 'Código', cls: 'num' }, { key: 'name', label: 'Nombre' }, { key: 'last_name', label: 'Apellido' },
        { key: 'department_name', label: 'Departamento' }, { key: 'position', label: 'Cargo' },
        { key: 'effective_schedule_id', label: 'Horario', render: (r) => esc((c.schedules.find((s) => s.id === r.effective_schedule_id) || {}).name || '—') },
        { key: 'card', label: 'Tarjeta' }, { key: 'hire_date', label: 'Ingreso' },
        { key: 'active', label: 'Estado', render: (r) => (r.active ? '<span class="tag ok">Activo</span>' : '<span class="tag gray">Retirado</span>') },
      ],
    });
    p.bind(g);
    function render() { route(); }
  };

  // ── Departamentos
  pages.departments = async (root) => {
    const c = await catalogs();
    const fields = [
      { key: 'code', label: 'Código' }, { key: 'name', label: 'Nombre', req: true },
      { key: 'schedule_id', label: 'Horario', type: 'select', options: opts(c.schedules, 'name'), wide: true, hint: 'Se aplica a todos sus empleados que no tengan horario propio' },
    ];
    const edit = async (d) => { if (await openForm({ title: 'Editar departamento', fields, values: d, onSubmit: (v) => api('/api/departments/' + d.id, { method: 'PUT', body: v }) })) route(); };
    const p = listPage(root, { buttons: [
      { label: 'Nuevo', primary: true, run: async () => { if (await openForm({ title: 'Nuevo departamento', fields, onSubmit: (v) => api('/api/departments', { method: 'POST', body: v }) })) route(); } },
      { label: 'Editar', needSel: 1, run: (s) => edit(s[0]) },
      { label: 'Borrar', danger: true, needSel: 2, run: async (s) => {
        if (!(await confirmBox('Borrar departamentos', `Se borrarán ${s.length} departamento(s). Los empleados quedan sin departamento.`, 'Borrar'))) return;
        for (const d of s) await api('/api/departments/' + d.id, { method: 'DELETE' });
        route();
      } },
    ] });
    p.bind(grid(p.gridEl, { rows: c.departments, onOpen: edit, columns: [
      { key: 'code', label: 'Código' }, { key: 'name', label: 'Nombre' }, { key: 'schedule_name', label: 'Horario' }, { key: 'employees', label: 'Empleados', cls: 'num' },
    ] }));
  };

  // ── Áreas
  pages.areas = async (root) => {
    const rows = await api('/api/areas');
    const p = listPage(root, { buttons: [
      { label: 'Nueva área', primary: true, run: async () => { if (await openForm({ title: 'Nueva área', oneCol: true, fields: [{ key: 'name', label: 'Nombre', req: true, placeholder: 'Ej. Producción, Portería' }], onSubmit: (v) => api('/api/areas', { method: 'POST', body: v }) })) route(); } },
      { label: 'Borrar', danger: true, needSel: 2, run: async (s) => { for (const a of s) await api('/api/areas/' + a.id, { method: 'DELETE' }); route(); } },
    ] });
    p.bind(grid(p.gridEl, { rows, columns: [{ key: 'name', label: 'Área' }] }));
  };

  // ── Dispositivos
  pages.devices = async (root) => {
    const c = await catalogs();
    const fields = (isNew) => [
      { key: 'alias', label: 'Nombre del dispositivo', req: true, placeholder: 'Ej. M2 Pro Portería' },
      { key: 'attendance', label: 'Asistencia', type: 'select', options: [{ value: 1, label: 'Sí' }, { value: 0, label: 'No' }] },
      { key: 'sn', label: 'Número de serie', req: true, readonly: !isNew, hint: isNew ? 'Menú del equipo → Info del sistema' : '' },
      { key: 'ip', label: 'Dirección IP', placeholder: '192.168.40.57' },
      { key: 'area', label: 'Área', type: 'select', options: opts(c.areas, 'name', 'name') },
      { key: 'timezone', label: 'Zona horaria', type: 'select', options: TZ_OPTS },
      { key: 'delay', label: 'Intervalo de solicitud (s)', type: 'number', min: 2, max: 600, req: true },
      { key: 'trans_interval', label: 'Intervalo de transferencia (min)', type: 'number', min: 1, max: 1440, req: true },
      { key: 'trans_times', label: 'Hora de transferencia', req: true, placeholder: '00:00;14:05' },
    ];
    const defaults = { attendance: 1, timezone: -5, delay: 10, trans_interval: 1, trans_times: '00:00;14:05' };
    const edit = async (d) => {
      if (await openForm({ title: 'Editar', fields: fields(false), values: d, onSubmit: (v) => api('/api/devices/' + encodeURIComponent(d.sn), { method: 'PUT', body: { ...v, attendance: Number(v.attendance) } }) })) { toast('Dispositivo actualizado'); route(); }
    };
    const cmd = (type, extra = {}) => async (s) => {
      for (const d of s) await api(`/api/devices/${encodeURIComponent(d.sn)}/commands`, { method: 'POST', body: { type, ...extra } });
      toast('Comando en cola: el equipo lo toma en su próxima consulta (≈10 s)');
    };
    const p = listPage(root, { buttons: [
      { label: 'Nuevo', primary: true, run: async () => {
        if (await openForm({ title: 'Nuevo dispositivo', fields: fields(true), values: defaults, onSubmit: (v) => api('/api/devices', { method: 'POST', body: { ...v, attendance: Number(v.attendance) } }) })) { toast('Dispositivo registrado'); route(); }
      } },
      { label: 'Editar', needSel: 1, run: (s) => edit(s[0]) },
      { label: 'Borrar', danger: true, needSel: 2, run: async (s) => {
        if (!(await confirmBox('Borrar dispositivos', `Se quitarán ${s.length} equipo(s) de la lista. Las marcaciones ya recibidas se conservan. Si el equipo sigue apuntando a este servidor volverá a aparecer.`, 'Borrar'))) return;
        for (const d of s) await api('/api/devices/' + encodeURIComponent(d.sn), { method: 'DELETE' });
        route();
      } },
      { label: 'Traer usuarios', needSel: 2, run: cmd('queryUsers') },
      { label: 'Traer marcaciones…', needSel: 2, run: async (s) => {
        const v = await openForm({ title: 'Descargar marcaciones del equipo', fields: [
          { key: 'from', label: 'Desde', type: 'date', req: true }, { key: 'to', label: 'Hasta', type: 'date', req: true }], values: { from: monthStart(), to: today() }, onSubmit: (x) => x });
        if (v) await cmd('queryAttlog', v)(s);
      } },
      { label: 'Resincronizar todo', needSel: 2, run: async (s) => {
        if (await confirmBox('Resincronizar', 'El equipo reenviará TODAS sus marcaciones. Las repetidas se ignoran automáticamente. Puede tardar unos minutos.')) await cmd('resync')(s);
      } },
      { label: 'Info', needSel: 2, run: cmd('info') },
      { label: 'Reiniciar', danger: true, needSel: 2, run: async (s) => { if (await confirmBox('Reiniciar equipo', '¿Reiniciar el biométrico? Estará fuera de servicio ~1 minuto.', 'Reiniciar')) await cmd('reboot')(s); } },
    ] });
    p.bind(grid(p.gridEl, { rows: c.devices, key: 'sn', onOpen: edit, empty: 'Ningún equipo todavía. Usa "Nuevo" o configura el biométrico (ver Sistema → Configurar equipo).', columns: [
      { key: 'sn', label: 'Número de serie' }, { key: 'alias', label: 'Nombre del dispositivo' }, { key: 'area', label: 'Área' },
      { key: 'ip', label: 'Dirección IP' },
      { key: 'online', label: 'Estado', render: (r) => (r.online ? '<span class="tag ok">En línea</span>' : r.last_seen ? '<span class="tag bad">Desconectado</span>' : '<span class="tag gray">Sin contacto</span>') },
      { key: 'last_seen', label: 'Última conexión (UTC)' }, { key: 'firmware', label: 'Firmware' },
      { key: 'user_count', label: 'Usuarios', cls: 'num' }, { key: 'punch_count', label: 'Transacciones', cls: 'num' },
      { key: 'attendance', label: 'Asistencia', render: (r) => yesNo(r.attendance) },
    ] }));
  };

  // ── Comandos
  const CMD_NAMES = [[/^DATA UPDATE USERINFO/, 'Enviar usuario'], [/^DATA DELETE USERINFO/, 'Borrar usuario'], [/^DATA QUERY ATTLOG/, 'Descargar marcaciones'],
    [/^DATA QUERY USERINFO/, 'Traer usuarios'], [/^INFO/, 'Info'], [/^CHECK/, 'Sincronizar'], [/^REBOOT/, 'Reiniciar']];
  const STATE = { pending: ['Pendiente', 'gray'], sent: ['Enviado', 'info'], ok: ['Ejecutado', 'ok'], error: ['Error', 'bad'] };
  pages.commands = async (root) => {
    const rows = await api('/api/commands');
    const p = listPage(root, { buttons: [{ label: 'Actualizar', run: () => route() }] });
    p.bind(grid(p.gridEl, { rows, selectable: false, columns: [
      { key: 'id', label: 'ID', cls: 'num' }, { key: 'device_sn', label: 'Equipo' },
      { key: 'command', label: 'Comando', render: (r) => esc((CMD_NAMES.find(([re]) => re.test(r.command)) || [0, r.command.split(' ')[0]])[1]) },
      { key: 'command', label: 'Detalle', render: (r) => `<small>${esc(r.command.replace(/\t/g, ' ').slice(0, 80))}</small>` },
      { key: 'state', label: 'Estado', render: (r) => `<span class="tag ${STATE[r.state][1]}">${STATE[r.state][0]}</span>` },
      { key: 'return_code', label: 'Código', cls: 'num' }, { key: 'created_at', label: 'Creado (UTC)' }, { key: 'done_at', label: 'Respuesta (UTC)' },
    ] }));
  };

  pages.rawlog = async (root) => {
    const rows = await api('/api/raw-log');
    const p = listPage(root, { buttons: [{ label: 'Actualizar', run: () => route() }] });
    p.bind(grid(p.gridEl, { rows, selectable: false, columns: [
      { key: 'created_at', label: 'Fecha (UTC)' }, { key: 'device_sn', label: 'Equipo' }, { key: 'endpoint', label: 'Tipo' },
      { key: 'body', label: 'Contenido', render: (r) => `<small>${esc((r.body || r.query || '').replace(/\t/g, ' ').slice(0, 140))}</small>` },
    ] }));
  };

  // ── Horarios
  pages.schedules = async (root) => {
    const rows = await api('/api/schedules');
    const fields = [
      { key: 'name', label: 'Nombre', req: true, wide: true },
      { key: 'start_time', label: 'Hora de entrada', type: 'time', req: true }, { key: 'end_time', label: 'Hora de salida', type: 'time', req: true },
      { key: 'tolerance_min', label: 'Tolerancia (min)', type: 'number', min: 0, max: 120, hint: 'Minutos de gracia antes de contar tardanza' },
      { key: 'break_min', label: 'Descanso (min)', type: 'number', min: 0, max: 240, hint: 'Almuerzo; se descuenta si no marcan' },
      { key: 'workdays', label: 'Días laborables', type: 'days', wide: true },
    ];
    const defaults = { start_time: '08:00', end_time: '17:00', tolerance_min: 5, break_min: 60, workdays: '1,2,3,4,5' };
    const edit = async (s) => { if (await openForm({ title: 'Editar horario', fields, values: s, onSubmit: (v) => api('/api/schedules/' + s.id, { method: 'PUT', body: v }) })) route(); };
    const p = listPage(root, { buttons: [
      { label: 'Nuevo', primary: true, run: async () => { if (await openForm({ title: 'Nuevo horario', fields, values: defaults, onSubmit: (v) => api('/api/schedules', { method: 'POST', body: v }) })) route(); } },
      { label: 'Editar', needSel: 1, run: (s) => edit(s[0]) },
      { label: 'Borrar', danger: true, needSel: 2, run: async (s) => { if (await confirmBox('Borrar horarios', 'Los departamentos y empleados con este horario quedarán sin horario.', 'Borrar')) { for (const x of s) await api('/api/schedules/' + x.id, { method: 'DELETE' }); route(); } } },
    ] });
    p.bind(grid(p.gridEl, { rows, onOpen: edit, columns: [
      { key: 'name', label: 'Nombre' }, { key: 'start_time', label: 'Entrada' }, { key: 'end_time', label: 'Salida' },
      { key: 'type', label: 'Tipo', render: (r) => (r.end_time < r.start_time ? '<span class="tag info">Nocturno</span>' : 'Diurno') },
      { key: 'tolerance_min', label: 'Tolerancia', cls: 'num' }, { key: 'break_min', label: 'Descanso', cls: 'num' },
      { key: 'workdays', label: 'Días', render: (r) => esc(r.workdays.split(',').map((d) => DAYS[d]).join(' ')) },
    ] }));
  };

  // ── Festivos
  pages.holidays = async (root) => {
    const year = store.get('iit_hyear', Number(today().slice(0, 4)));
    const rows = await api('/api/holidays?year=' + year);
    const p = listPage(root, {
      extra: `<label>Año <input type="number" data-year value="${year}" style="width:80px"></label>`,
      buttons: [
        { label: 'Agregar día no laborable', primary: true, run: async () => {
          if (await openForm({ title: 'Día no laborable', oneCol: true, fields: [{ key: 'date', label: 'Fecha', type: 'date', req: true }, { key: 'name', label: 'Descripción', req: true, placeholder: 'Ej. Día de la empresa' }], onSubmit: (v) => api('/api/holidays', { method: 'POST', body: v }) })) route();
        } },
        { label: 'Quitar', danger: true, needSel: 2, run: async (s) => {
          const own = s.filter((h) => h.custom);
          if (own.length < s.length) toast('Los festivos de ley no se pueden quitar; solo los agregados por ti', true);
          for (const h of own) await api('/api/holidays/' + h.date, { method: 'DELETE' });
          if (own.length) route();
        } },
      ],
    });
    $('[data-year]', root).onchange = (ev) => { store.set('iit_hyear', Number(ev.target.value)); route(); };
    p.bind(grid(p.gridEl, { rows, key: 'date', columns: [
      { key: 'date', label: 'Fecha' }, { key: 'day', label: 'Día', render: (r) => DAYS[((new Date(r.date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1] },
      { key: 'name', label: 'Festivo' }, { key: 'custom', label: 'Origen', render: (r) => (r.custom ? '<span class="tag info">Empresa</span>' : '<span class="tag gray">Ley colombiana</span>') },
    ] }));
  };

  // ── Novedades
  pages.incidents = async (root) => {
    const c = await catalogs();
    const employees = await api('/api/employees');
    const f = store.get('iit_inc_range', { from: monthStart(), to: today() });
    const rows = await api(`/api/incidents?from=${f.from}&to=${f.to}`);
    const types = Object.entries(c.incidentTypes).map(([k, t]) => ({ value: k, label: t.label }));
    const p = listPage(root, {
      extra: `<label>Desde <input type="date" data-from value="${f.from}"></label><label>Hasta <input type="date" data-to value="${f.to}"></label>`,
      buttons: [
        { label: 'Nueva novedad', primary: true, run: async () => {
          const ok = await openForm({ title: 'Nueva novedad', fields: [
            { key: 'pin', label: 'Empleado', type: 'select', req: true, wide: true, options: opts(employees.filter((e) => e.active), (e) => `${e.pin} — ${fullName(e) || 'Sin nombre'}`, 'pin', '— Selecciona —') },
            { key: 'type', label: 'Tipo', type: 'select', req: true, options: types }, { key: 'from_date', label: 'Desde', type: 'date', req: true },
            { key: 'to_date', label: 'Hasta', type: 'date', req: true }, { key: 'note', label: 'Observación', type: 'textarea', wide: true },
          ], values: { from_date: today(), to_date: today(), type: 'VAC' }, onSubmit: (v) => api('/api/incidents', { method: 'POST', body: v }) });
          if (ok) { toast('Novedad registrada'); route(); }
        } },
        { label: 'Borrar', danger: true, needSel: 2, run: async (s) => { for (const i of s) await api('/api/incidents/' + i.id, { method: 'DELETE' }); route(); } },
      ],
    });
    const reload = () => { store.set('iit_inc_range', { from: $('[data-from]', root).value, to: $('[data-to]', root).value }); route(); };
    $('[data-from]', root).onchange = reload; $('[data-to]', root).onchange = reload;
    p.bind(grid(p.gridEl, { rows, columns: [
      { key: 'pin', label: 'Código', cls: 'num' }, { key: 'name', label: 'Nombre', render: (r) => esc(fullName(r)) },
      { key: 'type', label: 'Tipo', render: (r) => { const t = c.incidentTypes[r.type] || { label: r.type, color: '#666' }; return `<span class="tag" style="background:${t.color}1a;color:${t.color}">${esc(t.label)}</span>`; } },
      { key: 'from_date', label: 'Desde' }, { key: 'to_date', label: 'Hasta' }, { key: 'note', label: 'Observación' },
    ] }));
  };

  // ── Marcación manual
  pages.manual = async (root) => {
    const employees = await api('/api/employees');
    const f = store.get('iit_man_range', { from: monthStart(), to: today() });
    const all = await api(`/api/punches?from=${f.from}&to=${f.to}`);
    const rows = all.filter((p) => p.source === 'manual');
    const pg = listPage(root, {
      extra: `<label>Desde <input type="date" data-from value="${f.from}"></label><label>Hasta <input type="date" data-to value="${f.to}"></label>`,
      buttons: [
        { label: 'Nueva marcación', primary: true, run: async () => {
          const ok = await openForm({ title: 'Marcación manual', fields: [
            { key: 'pin', label: 'Empleado', type: 'select', req: true, wide: true, options: opts(employees.filter((e) => e.active), (e) => `${e.pin} — ${fullName(e) || 'Sin nombre'}`, 'pin', '— Selecciona —') },
            { key: 'date', label: 'Fecha', type: 'date', req: true }, { key: 'time', label: 'Hora', type: 'time', req: true },
            { key: 'status', label: 'Tipo', type: 'select', options: [{ value: 0, label: 'Entrada' }, { value: 1, label: 'Salida' }, { value: 2, label: 'Salida descanso' }, { value: 3, label: 'Regreso descanso' }] },
            { key: 'note', label: 'Motivo', type: 'textarea', req: true, wide: true, placeholder: 'Ej. Olvidó marcar; autorizado por jefe de área' },
          ], values: { date: today() }, onSubmit: (v) => api('/api/punches', { method: 'POST', body: v }) });
          if (ok) { toast('Marcación registrada'); route(); }
        } },
        { label: 'Borrar', danger: true, needSel: 2, run: async (s) => { for (const x of s) await api('/api/punches/' + x.id, { method: 'DELETE' }); route(); } },
      ],
    });
    const reload = () => { store.set('iit_man_range', { from: $('[data-from]', root).value, to: $('[data-to]', root).value }); route(); };
    $('[data-from]', root).onchange = reload; $('[data-to]', root).onchange = reload;
    pg.bind(grid(pg.gridEl, { rows, empty: 'No hay marcaciones manuales en el rango', columns: [
      { key: 'ts', label: 'Fecha/hora' }, { key: 'pin', label: 'Código', cls: 'num' }, { key: 'name', label: 'Nombre', render: (r) => esc(fullName(r)) },
      { key: 'department', label: 'Departamento' }, { key: 'note', label: 'Motivo' }, { key: 'received_at', label: 'Registrada (UTC)' },
    ] }));
  };

  // ── Reportes
  function reportPage(id) {
    return async (root) => {
      const [defs, c, employees] = await Promise.all([cache.reports || api('/api/reports'), catalogs(), api('/api/employees')]);
      cache.reports = defs;
      const def = defs.find((r) => r.id === id);
      const f = store.get('iit_rep_filters', { from: monthStart(), to: today(), department: '', pin: '' });
      let cols = store.get('iit_cols_' + id, def.columns.filter((x) => x.default).map((x) => x.key));
      cols = cols.filter((k) => def.columns.some((x) => x.key === k));

      root.innerHTML = `<div class="card">
        <div class="desc">${esc(def.description)}</div>
        <div class="report-filters">
          <label>Desde<input type="date" data-f="from" value="${f.from}"></label>
          <label>Hasta<input type="date" data-f="to" value="${f.to}"></label>
          <label>Departamento<select data-f="department">${opts(c.departments, 'name', 'id', 'Todos').map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.department) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <label>Empleado<select data-f="pin">${opts(employees, (e) => `${e.pin} — ${fullName(e) || 'Sin nombre'}`, 'pin', 'Todos').map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.pin) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <button class="btn primary" data-a="run">Consultar</button>
          <button class="btn" data-a="cols">Columnas</button>
          <span style="flex:1"></span>
          <button class="btn" data-a="xlsx">Excel</button><button class="btn" data-a="pdf">PDF / Imprimir</button>
          <button class="btn" data-a="txt">TXT</button><button class="btn" data-a="csv">CSV</button>
        </div>
        <div class="cols-panel" data-cols><small>Marca las columnas y arrástralas para cambiar el orden. Se recuerda para la próxima vez.</small><div class="cols-list"></div></div>
        <div data-grid></div></div>`;

      const filters = () => {
        const v = Object.fromEntries($$('[data-f]', root).map((el) => [el.dataset.f, el.value]));
        store.set('iit_rep_filters', v);
        return v;
      };
      const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...filters(), cols: cols.join(','), ...extra }).filter(([, v]) => v !== '')).toString();
      const colList = $('.cols-list', root);
      const drawCols = () => {
        const ordered = [...cols.map((k) => def.columns.find((x) => x.key === k)), ...def.columns.filter((x) => !cols.includes(x.key))];
        colList.innerHTML = ordered.map((x) => `<label draggable="true" data-k="${esc(x.key)}"><input type="checkbox"${cols.includes(x.key) ? ' checked' : ''}>${esc(x.label)}</label>`).join('');
      };
      const saveCols = () => {
        cols = $$('label', colList).filter((l) => $('input', l).checked).map((l) => l.dataset.k);
        if (!cols.length) cols = def.columns.filter((x) => x.default).map((x) => x.key);
        store.set('iit_cols_' + id, cols);
      };
      colList.onchange = () => { saveCols(); run(); };
      let drag;
      colList.ondragstart = (ev) => { drag = ev.target.closest('label'); drag.classList.add('dragging'); };
      colList.ondragend = () => { drag && drag.classList.remove('dragging'); drag = null; saveCols(); run(); };
      colList.ondragover = (ev) => {
        ev.preventDefault();
        const over = ev.target.closest('label');
        if (!drag || !over || over === drag) return;
        const r = over.getBoundingClientRect();
        colList.insertBefore(drag, ev.clientX > r.left + r.width / 2 ? over.nextSibling : over);
      };
      drawCols();

      let last;
      async function run() {
        try {
          last = await api(`/api/reports/${id}?` + qs());
          grid($('[data-grid]', root), {
            rows: last.rows.map((r, i) => ({ ...r, _i: i })), key: '_i', selectable: false, empty: 'Sin datos para los filtros seleccionados',
            columns: last.columns.map((x) => ({
              key: x.key, label: x.label, cls: /Minutes$|^days$|Count$|absences|incidentDays|incomplete$/.test(x.key) && id === 'summary' ? 'num' : '',
              render: x.key === 'status' ? (r) => `<span class="tag ${r.status === 'Normal' ? 'ok' : r.status === 'Tarde' ? 'warn' : r.status === 'Festivo' ? 'info' : 'bad'}">${esc(r.status)}</span>`
                : typeof (last.rows[0] || {})[x.key] === 'boolean' ? (r) => (r[x.key] ? 'Sí' : 'No') : null,
            })),
          });
        } catch (e) { fail(e); }
      }
      root.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]');
        if (!a) return;
        const act = a.dataset.a;
        if (act === 'run') return run();
        if (act === 'cols') return $('[data-cols]', root).classList.toggle('show');
        if (act === 'pdf') return printReport(last, def);
        location.href = withToken(`/api/reports/${id}?` + qs({ format: act }));
      });
      run();
    };
  }

  function printReport(rep, def) {
    if (!rep) return toast('Primero consulta el reporte', true);
    const w = window.open('', '_blank');
    if (!w) return toast('El navegador bloqueó la ventana emergente; permítela para imprimir', true);
    const val = (v) => esc(Array.isArray(v) ? v.join(' ') : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : v);
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(def.title)} ${esc(rep.from)} a ${esc(rep.to)}</title>
      <style>body{font:11px "Segoe UI",Arial,sans-serif;color:#222;margin:18px}header{display:flex;justify-content:space-between;border-bottom:3px solid #0b3d91;padding-bottom:8px;margin-bottom:10px}
      h1{font-size:17px;margin:0;color:#0b3d91}table{width:100%;border-collapse:collapse}th{background:#0b3d91;color:#fff;text-align:left;padding:5px 6px;font-weight:600}
      td{padding:4px 6px;border-bottom:1px solid #ddd}tr:nth-child(even) td{background:#f4f7fb}footer{margin-top:10px;color:#777;font-size:10px}
      @page{size:${rep.columns.length > 7 ? 'landscape' : 'portrait'};margin:12mm}</style></head><body>
      <header><div><h1>${esc(def.title)}</h1><div>Período: ${esc(rep.from)} a ${esc(rep.to)} · ${rep.rows.length} registros</div></div><div style="text-align:right"><b>IIT Asistencia</b><br>Generado ${esc(bogota().toISOString().slice(0, 16).replace('T', ' '))}</div></header>
      <table><thead><tr>${rep.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rep.rows.map((r) => `<tr>${rep.columns.map((c) => `<td>${val(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <footer>Para guardar como PDF elige "Guardar como PDF" en el destino de impresión.</footer>
      <script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
    w.document.close();
  }

  // ── Sistema
  pages.setup = async (root) => {
    const host = location.hostname, port = location.port || '80';
    root.innerHTML = `<div class="help">
      <h3>Conectar un biométrico ZKTeco</h3>
      <p>En el equipo entra a <b>Menú → Comunicación → Servidor en la nube</b> (en algunos firmwares: <i>Configuración ADMS</i>) y configura:</p>
      <table><tr><td>Modo de servidor</td><td><b>ADMS</b></td></tr>
      <tr><td>Dirección del servidor</td><td><b>IP de este PC en la red del equipo</b> (no uses <code>localhost</code>; ahora estás entrando por <code>${esc(host)}</code>)</td></tr>
      <tr><td>Puerto</td><td><b>${esc(port)}</b></td></tr><tr><td>Proxy / HTTPS</td><td>Desactivados</td></tr></table>
      <p>A los pocos segundos aparece en <b>Dispositivo → Dispositivos</b>. Luego usa <b>Traer usuarios</b> y <b>Resincronizar todo</b> para cargar empleados e historial.</p>
      <p>⚠️ Un equipo solo envía a <b>un</b> servidor: mientras apunte aquí, BioTime no recibe. Las marcaciones nunca se pierden: el equipo las guarda hasta que el servidor confirma.</p>
      <h3>Zona horaria</h3>
      <p>Colombia es <b>UTC−05:00</b>. En BioTime la opción <code>Etc/GMT-5</code> corresponde, en notación IANA, a <b>UTC+05:00</b> (el signo va invertido). Si las horas salían corridas, esa es la causa probable.</p>
    </div>`;
  };
  pages.about = async (root) => {
    const h = await api('/api/health');
    root.innerHTML = `<div class="help"><h3>IIT Asistencia</h3><p>Versión ${esc(h.version)} · Servidor activo (${esc(h.time)})</p>
      <p>Desarrollado por <b>Infraestructura-IT</b> · infraestructura-it.com</p>
      <p>Base de datos local SQLite · Protocolo ADMS/push compatible con terminales ZKTeco (M2 Pro, M1, MB160, entre otros).</p></div>`;
  };

  // ═════════════════════════ navegación
  const MODULES = [
    { id: 'home', label: 'Inicio', menu: [['Inicio', [['dashboard', 'Tablero']]]] },
    { id: 'personal', label: 'Personal', menu: [['Personal', [['employees', 'Empleados'], ['departments', 'Departamentos'], ['areas', 'Áreas']]]] },
    { id: 'device', label: 'Dispositivo', menu: [['Dispositivo', [['devices', 'Dispositivos'], ['commands', 'Comandos de dispositivo'], ['rawlog', 'Datos recibidos']]]] },
    { id: 'att', label: 'Asistencia', menu: [['Reglas', [['schedules', 'Horarios'], ['holidays', 'Festivos']]], ['Novedades', [['incidents', 'Novedades'], ['manual', 'Marcación manual']]], ['Datos', [['rep-transactions', 'Transacciones']]]] },
    { id: 'reports', label: 'Reportes', menu: [['Reportes', [
      ['rep-daily', 'Asistencia diaria'], ['rep-firstlast', 'Primera y última'], ['rep-summary', 'Resumen por empleado'], ['rep-late', 'Llegadas tarde'],
      ['rep-overtime', 'Horas extra'], ['rep-absences', 'Ausencias'], ['rep-incidents', 'Novedades'], ['rep-transactions', 'Transacciones']]]] },
    { id: 'system', label: 'Sistema', menu: [['Sistema', [['setup', 'Configurar equipo'], ['about', 'Acerca de']]]] },
  ];
  const TITLES = {};
  MODULES.forEach((m) => m.menu.forEach(([, items]) => items.forEach(([id, t]) => (TITLES[id] = TITLES[id] || { title: t, module: m.id }))));
  ['daily', 'firstlast', 'summary', 'late', 'overtime', 'absences', 'incidents', 'transactions'].forEach((r) => (pages['rep-' + r] = reportPage(r)));
  TITLES['rep-transactions'].module = 'att';

  $('#modules').innerHTML = MODULES.map((m) => `<button data-m="${m.id}">${esc(m.label)}</button>`).join('');
  $('#modules').onclick = (ev) => {
    const b = ev.target.closest('[data-m]');
    if (!b) return;
    const m = MODULES.find((x) => x.id === b.dataset.m);
    location.hash = '#/' + m.menu[0][1][0][0];
  };

  let currentModule = null;
  async function route() {
    const id = location.hash.replace(/^#\//, '') || 'dashboard';
    if (!pages[id]) { location.hash = '#/dashboard'; return; }
    // Si la página está en el menú del módulo actual, se queda ahí (p. ej. Transacciones está en Asistencia y Reportes)
    const inCurrent = currentModule && MODULES.find((m) => m.id === currentModule).menu.some(([, it]) => it.some(([x]) => x === id));
    const modId = inCurrent ? currentModule : TITLES[id].module;
    currentModule = modId;
    const mod = MODULES.find((m) => m.id === modId);
    $$('#modules button').forEach((b) => b.classList.toggle('active', b.dataset.m === modId));
    $('#sidebar').innerHTML = mod.menu.map(([h, items]) => `<h4>${esc(h)}</h4>` + items.map(([pid, t]) => `<a href="#/${pid}" class="${pid === id ? 'active' : ''}">${esc(t)}</a>`).join('')).join('');
    $('#page-title').textContent = TITLES[id].title;
    const root = $('#page');
    root.innerHTML = '<p style="color:var(--muted);padding:20px">Cargando…</p>';
    try { await pages[id](root); } catch (e) { root.innerHTML = `<div class="help"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div>`; }
  }
  window.addEventListener('hashchange', route);

  async function heartbeat() {
    $('#clock').textContent = bogota().toISOString().slice(0, 16).replace('T', ' ');
    try {
      const devs = await api('/api/devices');
      const on = devs.filter((d) => d.online).length;
      $('#dev-status').innerHTML = devs.length ? `<span class="dot ${on === devs.length ? 'on' : 'off'}"></span> ${on}/${devs.length} equipos` : '<span class="dot"></span> sin equipos';
    } catch { $('#dev-status').innerHTML = '<span class="dot off"></span> sin conexión'; }
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#modal-back').classList.contains('show')) $('#modal-cancel').click(); });
  route();
  heartbeat();
  setInterval(heartbeat, 30000);
})();
