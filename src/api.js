'use strict';
/** API REST del panel. */
const { commands } = require('./adms/parser');
const { REPORTS, INCIDENT_TYPES, buildReport, pickColumns, exportReport, holidaysFor } = require('./reports');
const { colombianHolidays } = require('./holidays-co');
const { dailyReport } = require('./attendance');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 370;

/** Fecha local de Colombia sin depender de la zona del servidor */
function today(offsetHours = -5) {
  return new Date(Date.now() + offsetHours * 3600000).toISOString().slice(0, 10);
}
function nowLocal(offsetHours = -5) {
  return new Date(Date.now() + offsetHours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function need(cond, msg) {
  if (!cond) throw httpError(400, msg);
}
function str(v, max = 100) {
  return v == null ? '' : String(v).trim().slice(0, max);
}

function validateDevice(j, isNew) {
  if (isNew) need(/^[A-Za-z0-9_-]{4,40}$/.test(str(j.sn)), 'Número de serie inválido');
  need(str(j.alias), 'El nombre del dispositivo es obligatorio');
  need(!j.ip || /^[\d.:a-fA-F]+$/.test(str(j.ip)), 'Dirección IP inválida');
  need(Number.isInteger(Number(j.timezone ?? -5)) && Math.abs(Number(j.timezone ?? -5)) <= 14, 'Zona horaria inválida');
  need(Number(j.delay ?? 10) >= 2 && Number(j.delay ?? 10) <= 600, 'Intervalo de solicitud entre 2 y 600 s');
  need(Number(j.trans_interval ?? 1) >= 1 && Number(j.trans_interval ?? 1) <= 1440, 'Intervalo de transferencia entre 1 y 1440 min');
  need(!j.trans_times || /^\d{2}:\d{2}(;\d{2}:\d{2})*$/.test(str(j.trans_times)), 'Hora de transferencia: formato HH:MM;HH:MM');
  return { ...j, sn: str(j.sn, 40), alias: str(j.alias, 60), ip: str(j.ip, 45), area: str(j.area, 60) };
}

function validateEmployee(j, isNew) {
  if (isNew) need(/^\d{1,9}$/.test(str(j.pin)), 'El código debe ser numérico (máx. 9 dígitos), igual que en el equipo');
  need(str(j.name), 'El nombre es obligatorio');
  need(!j.hire_date || DATE_RE.test(j.hire_date), 'Fecha de ingreso inválida');
  need(!j.card || /^\d{1,20}$/.test(str(j.card)), 'La tarjeta debe ser numérica');
  return {
    ...j, pin: str(j.pin, 9), name: str(j.name, 60), last_name: str(j.last_name, 60), card: str(j.card, 20),
    position: str(j.position, 60), department_id: j.department_id ? Number(j.department_id) : null,
    schedule_id: j.schedule_id ? Number(j.schedule_id) : null,
  };
}

function validateSchedule(j) {
  need(str(j.name), 'El nombre del horario es obligatorio');
  need(TIME_RE.test(j.start_time) && TIME_RE.test(j.end_time), 'Horas en formato HH:MM');
  need(j.start_time !== j.end_time, 'La entrada y la salida no pueden ser iguales');
  need(/^[1-7](,[1-7])*$/.test(str(j.workdays || '1,2,3,4,5')), 'Días laborables inválidos');
  need(Number(j.tolerance_min ?? 5) >= 0 && Number(j.tolerance_min ?? 5) <= 120, 'Tolerancia entre 0 y 120 min');
  need(Number(j.break_min ?? 60) >= 0 && Number(j.break_min ?? 60) <= 240, 'Descanso entre 0 y 240 min');
  return { ...j, name: str(j.name, 60) };
}

function createApi({ repo, config }) {
  const tz = config.deviceTz ?? -5;

  function isOnline(d) {
    if (!d.last_seen) return false;
    const last = Date.parse(d.last_seen.replace(' ', 'T') + 'Z');
    return Date.now() - last < config.offlineAfterMin * 60000;
  }

  function range(q) {
    const from = DATE_RE.test(q.get('from') || '') ? q.get('from') : today(tz);
    const to = DATE_RE.test(q.get('to') || '') ? q.get('to') : from;
    need(to >= from, 'La fecha final es anterior a la inicial');
    need((Date.parse(to) - Date.parse(from)) / 86400000 < MAX_RANGE_DAYS, `Rango máximo ${MAX_RANGE_DAYS} días`);
    return { from, to };
  }

  function sendToDevices(command, sn) {
    const targets = sn ? [sn] : repo.listDevices().map((d) => d.sn);
    return targets.map((s) => ({ sn: s, id: repo.queueCommand(s, command) }));
  }

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, time: new Date().toISOString(), version: '0.2.0' })],

    // ── Tablero
    ['GET', /^\/api\/dashboard$/, () => {
      const d = today(tz);
      const schedules = new Map(repo.listSchedules().map((s) => [s.id, s]));
      const employees = repo.listEmployees().filter((e) => e.active);
      const punches = repo.punches(`${d} 00:00:00`, `${d} 23:59:59`);
      const daily = dailyReport(punches, { dedupMinutes: config.dedupMinutes, schedules });
      const present = new Set(daily.map((r) => r.pin));
      const incidents = repo.listIncidents(d, d);
      const onLeave = new Set(incidents.map((i) => i.pin));
      const isHoliday = holidaysFor(repo, d, d).length > 0;
      const devices = repo.listDevices().map((x) => ({ sn: x.sn, alias: x.alias, online: isOnline(x), last_seen: x.last_seen }));
      return {
        date: d,
        isHoliday,
        employees: employees.length,
        present: present.size,
        late: daily.filter((r) => r.lateMinutes > 0).length,
        onLeave: onLeave.size,
        pending: employees.filter((e) => !present.has(e.pin) && !onLeave.has(e.pin)).length,
        devicesOnline: devices.filter((x) => x.online).length,
        devices,
        lastPunches: [...punches].reverse().slice(0, 12).map((p) => ({
          ts: p.ts, pin: p.pin, name: [p.name, p.last_name].filter(Boolean).join(' '), device_sn: p.device_sn,
        })),
        byHour: Array.from({ length: 24 }, (_, h) => punches.filter((p) => Number(p.ts.slice(11, 13)) === h).length),
      };
    }],

    // ── Equipos
    ['GET', /^\/api\/devices$/, () => repo.listDevices().map((d) => ({ ...d, online: isOnline(d) }))],
    ['POST', /^\/api\/devices$/, ({ json }) => {
      const d = validateDevice(json, true);
      if (repo.getDevice(d.sn)) throw httpError(409, 'Ya existe un dispositivo con ese número de serie');
      repo.createDevice(d);
      return repo.getDevice(d.sn);
    }],
    ['PUT', /^\/api\/devices\/([^/]+)$/, ({ m, json }) => {
      if (!repo.getDevice(m[1])) throw httpError(404, 'Equipo no encontrado');
      repo.updateDevice(m[1], validateDevice(json, false));
      return repo.getDevice(m[1]);
    }],
    ['PATCH', /^\/api\/devices\/([^/]+)$/, ({ m, json }) => {
      if (!repo.getDevice(m[1])) throw httpError(404, 'Equipo no encontrado');
      repo.setAlias(m[1], str(json.alias, 60));
      return { ok: true };
    }],
    ['DELETE', /^\/api\/devices\/([^/]+)$/, ({ m }) => {
      if (!repo.deleteDevice(m[1])) throw httpError(404, 'Equipo no encontrado');
      return { ok: true };
    }],
    ['GET', /^\/api\/devices\/([^/]+)\/commands$/, ({ m }) => repo.listCommands(m[1])],
    ['GET', /^\/api\/commands$/, () => repo.listCommands()],
    ['POST', /^\/api\/devices\/([^/]+)\/commands$/, ({ m, json }) => {
      const sn = m[1];
      if (!repo.getDevice(sn)) throw httpError(404, 'Equipo no encontrado');
      let cmd;
      switch (json.type) {
        case 'info': cmd = commands.info(); break;
        case 'check': cmd = commands.check(); break;
        case 'reboot': cmd = commands.reboot(); break;
        case 'queryUsers': cmd = commands.queryUsers(); break;
        case 'queryAttlog': {
          need(DATE_RE.test(json.from || '') && DATE_RE.test(json.to || ''), 'from/to requeridos (YYYY-MM-DD)');
          cmd = commands.queryAttlog(`${json.from} 00:00:00`, `${json.to} 23:59:59`);
          break;
        }
        case 'resync': {
          // Olvida hasta dónde se recibió: el equipo reenvía todo (los duplicados se ignoran)
          repo.resetStamps(sn);
          cmd = commands.check();
          break;
        }
        default: throw httpError(400, 'type inválido: info | check | reboot | queryUsers | queryAttlog | resync');
      }
      return { id: repo.queueCommand(sn, cmd), command: cmd };
    }],
    ['GET', /^\/api\/raw-log$/, () => repo.listRaw()],

    // ── Áreas
    ['GET', /^\/api\/areas$/, () => repo.listAreas()],
    ['POST', /^\/api\/areas$/, ({ json }) => {
      need(str(json.name), 'Nombre obligatorio');
      try { return { id: repo.createArea(str(json.name, 60)) }; } catch { throw httpError(409, 'Esa área ya existe'); }
    }],
    ['DELETE', /^\/api\/areas\/(\d+)$/, ({ m }) => ({ ok: !!repo.deleteArea(Number(m[1])) })],

    // ── Horarios
    ['GET', /^\/api\/schedules$/, () => repo.listSchedules()],
    ['POST', /^\/api\/schedules$/, ({ json }) => ({ id: repo.createSchedule(validateSchedule(json)) })],
    ['PUT', /^\/api\/schedules\/(\d+)$/, ({ m, json }) => {
      if (!repo.updateSchedule(Number(m[1]), validateSchedule(json))) throw httpError(404, 'Horario no encontrado');
      return repo.getSchedule(Number(m[1]));
    }],
    ['DELETE', /^\/api\/schedules\/(\d+)$/, ({ m }) => ({ ok: !!repo.deleteSchedule(Number(m[1])) })],

    // ── Departamentos
    ['GET', /^\/api\/departments$/, () => repo.listDepartments()],
    ['POST', /^\/api\/departments$/, ({ json }) => {
      need(str(json.name), 'Nombre obligatorio');
      try {
        return { id: repo.createDepartment({ code: str(json.code, 20), name: str(json.name, 60), schedule_id: json.schedule_id ? Number(json.schedule_id) : null }) };
      } catch { throw httpError(409, 'Ese departamento ya existe'); }
    }],
    ['PUT', /^\/api\/departments\/(\d+)$/, ({ m, json }) => {
      need(str(json.name), 'Nombre obligatorio');
      if (!repo.updateDepartment(Number(m[1]), { code: str(json.code, 20), name: str(json.name, 60), schedule_id: json.schedule_id ? Number(json.schedule_id) : null })) {
        throw httpError(404, 'Departamento no encontrado');
      }
      return repo.getDepartment(Number(m[1]));
    }],
    ['DELETE', /^\/api\/departments\/(\d+)$/, ({ m }) => ({ ok: !!repo.deleteDepartment(Number(m[1])) })],

    // ── Empleados
    ['GET', /^\/api\/employees$/, () => repo.listEmployees()],
    ['POST', /^\/api\/employees$/, ({ json }) => {
      const e = validateEmployee(json, true);
      if (repo.getEmployee(e.pin)) throw httpError(409, 'Ya existe un empleado con ese código');
      repo.createEmployee(e);
      if (json.sendToDevices) sendToDevices(commands.upsertUser({ pin: e.pin, name: `${e.name} ${e.last_name}`.trim(), card: e.card || '' }));
      return repo.getEmployee(e.pin);
    }],
    ['PUT', /^\/api\/employees\/([^/]+)$/, ({ m, json }) => {
      if (!repo.getEmployee(m[1])) throw httpError(404, 'Empleado no encontrado');
      const e = validateEmployee(json, false);
      repo.updateEmployee(m[1], e);
      return repo.getEmployee(m[1]);
    }],
    ['PATCH', /^\/api\/employees\/([^/]+)$/, ({ m, json }) => {
      const cur = repo.getEmployee(m[1]);
      if (!cur) throw httpError(404, 'Empleado no encontrado');
      repo.updateEmployee(m[1], { ...cur, ...json });
      return repo.getEmployee(m[1]);
    }],
    ['DELETE', /^\/api\/employees\/([^/]+)$/, ({ m, q }) => {
      if (!repo.deleteEmployee(m[1])) throw httpError(404, 'Empleado no encontrado');
      const queued = q.get('fromDevices') === '1' ? sendToDevices(commands.deleteUser(m[1])) : [];
      return { ok: true, queued };
    }],
    ['POST', /^\/api\/employees\/([^/]+)\/push$/, ({ m, json }) => {
      const e = repo.getEmployee(m[1]);
      if (!e) throw httpError(404, 'Empleado no encontrado');
      const name = `${e.name} ${e.last_name || ''}`.trim().slice(0, 24); // el equipo limita el largo del nombre
      return { queued: sendToDevices(commands.upsertUser({ pin: e.pin, name, privilege: e.privilege, card: e.card || '' }), json.sn) };
    }],
    ['POST', /^\/api\/employees\/sync$/, () => ({ queued: sendToDevices(commands.queryUsers()) })],

    // ── Marcaciones
    ['GET', /^\/api\/punches$/, ({ q }) => {
      const r = range(q);
      return repo.punches(`${r.from} 00:00:00`, `${r.to} 23:59:59`, q.get('pin') || null);
    }],
    ['POST', /^\/api\/punches$/, ({ json }) => {
      need(repo.getEmployee(str(json.pin)), 'Empleado no encontrado');
      need(DATE_RE.test(json.date || '') && TIME_RE.test(json.time || ''), 'Fecha y hora requeridas');
      need(str(json.note), 'Escribe el motivo de la marcación manual');
      const ts = `${json.date} ${json.time}:00`;
      need(ts <= nowLocal(tz), 'No se pueden registrar marcaciones en el futuro');
      return { id: repo.addManualPunch({ pin: str(json.pin), ts, status: Number(json.status) || 0, note: str(json.note, 200) }) };
    }],
    ['DELETE', /^\/api\/punches\/(\d+)$/, ({ m }) => {
      if (!repo.deleteManualPunch(Number(m[1]))) throw httpError(400, 'Solo se pueden borrar marcaciones manuales');
      return { ok: true };
    }],

    // ── Novedades
    ['GET', /^\/api\/incident-types$/, () => INCIDENT_TYPES],
    ['GET', /^\/api\/incidents$/, ({ q }) => {
      const r = range(q);
      return repo.listIncidents(r.from, r.to);
    }],
    ['POST', /^\/api\/incidents$/, ({ json }) => {
      need(repo.getEmployee(str(json.pin)), 'Empleado no encontrado');
      need(INCIDENT_TYPES[json.type], 'Tipo de novedad inválido');
      need(DATE_RE.test(json.from_date || '') && DATE_RE.test(json.to_date || ''), 'Fechas requeridas');
      need(json.to_date >= json.from_date, 'La fecha final es anterior a la inicial');
      return { id: repo.createIncident({ pin: str(json.pin), type: json.type, from_date: json.from_date, to_date: json.to_date, note: str(json.note, 200) }) };
    }],
    ['DELETE', /^\/api\/incidents\/(\d+)$/, ({ m }) => ({ ok: !!repo.deleteIncident(Number(m[1])) })],

    // ── Festivos (Colombia automáticos + propios)
    ['GET', /^\/api\/holidays$/, ({ q }) => {
      const year = Number(q.get('year')) || Number(today(tz).slice(0, 4));
      const custom = repo.listHolidays(`${year}-01-01`, `${year}-12-31`).map((h) => ({ ...h, custom: true }));
      const auto = colombianHolidays(year).filter((h) => !custom.some((c) => c.date === h.date));
      return [...auto, ...custom].sort((a, b) => a.date.localeCompare(b.date));
    }],
    ['POST', /^\/api\/holidays$/, ({ json }) => {
      need(DATE_RE.test(json.date || '') && str(json.name), 'Fecha y nombre requeridos');
      repo.upsertHoliday(json.date, str(json.name, 60));
      return { ok: true };
    }],
    ['DELETE', /^\/api\/holidays\/(\d{4}-\d{2}-\d{2})$/, ({ m }) => ({ ok: !!repo.deleteHoliday(m[1]) })],

    // ── Reportes
    ['GET', /^\/api\/reports$/, () =>
      Object.entries(REPORTS).map(([id, r]) => ({ id, title: r.title, description: r.description, columns: r.columns }))],
    ['GET', /^\/api\/reports\/([a-z]+)$/, ({ m, q }) => {
      const r = range(q);
      const report = buildReport(repo, m[1], {
        ...r, pin: q.get('pin') || null, departmentId: q.get('department') ? Number(q.get('department')) : null, today: today(tz),
      }, config);
      if (!report) throw httpError(404, 'Reporte no encontrado');
      const columns = pickColumns(REPORTS[m[1]], q.get('cols'));
      const format = q.get('format');
      if (['csv', 'xlsx', 'txt'].includes(format)) return { __file: exportReport(report, columns, format) };
      return { ...report, columns };
    }],

    // Compatibilidad con v0.1
    ['GET', /^\/api\/report\/daily$/, ({ q }) => {
      const r = range(q);
      return buildReport(repo, 'daily', { ...r, pin: q.get('pin') || null, today: today(tz) }, config).rows;
    }],
  ];

  return async function handle(req, res, url, body) {
    if (config.apiToken) {
      const auth = req.headers.authorization || '';
      const tok = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
      if (tok !== config.apiToken) return sendJson(res, 401, { error: 'No autorizado' });
    }
    for (const [method, re, fn] of routes) {
      if (req.method !== method) continue;
      const m = url.pathname.match(re);
      if (!m) continue;
      try {
        let json = {};
        if (body && body.length) {
          try { json = JSON.parse(body); } catch { throw httpError(400, 'JSON inválido'); }
        }
        const out = await fn({ m, q: url.searchParams, json, req });
        if (out && out.__file) {
          const f = out.__file;
          res.writeHead(200, {
            'Content-Type': f.type,
            'Content-Disposition': `attachment; filename="${f.filename}"`,
          });
          return res.end(f.content);
        }
        return sendJson(res, 200, out);
      } catch (err) {
        if (!err.status) console.error('[api]', err);
        return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
      }
    }
    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  };
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

module.exports = { createApi, today };
