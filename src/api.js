'use strict';
/** API REST del panel. JSON por defecto; ?format=csv en reportes. */
const { commands } = require('./adms/parser');
const { dailyReport, toCsv } = require('./attendance');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  // Fecha local de Colombia sin depender de la zona del servidor
  const d = new Date(Date.now() + -5 * 3600000);
  return d.toISOString().slice(0, 10);
}

function createApi({ repo, config }) {
  function isOnline(d) {
    const last = Date.parse(d.last_seen.replace(' ', 'T') + 'Z');
    return Date.now() - last < config.offlineAfterMin * 60000;
  }

  function range(q) {
    const from = DATE_RE.test(q.get('from') || '') ? q.get('from') : today();
    const to = DATE_RE.test(q.get('to') || '') ? q.get('to') : from;
    return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
  }

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, time: new Date().toISOString() })],

    ['GET', /^\/api\/devices$/, () => repo.listDevices().map((d) => ({ ...d, online: isOnline(d) }))],

    ['PATCH', /^\/api\/devices\/([^/]+)$/, ({ m, json }) => {
      if (!repo.getDevice(m[1])) throw httpError(404, 'Equipo no encontrado');
      repo.setAlias(m[1], String(json.alias || '').slice(0, 60));
      return { ok: true };
    }],

    ['GET', /^\/api\/devices\/([^/]+)\/commands$/, ({ m }) => repo.listCommands(m[1])],

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
          if (!DATE_RE.test(json.from || '') || !DATE_RE.test(json.to || '')) throw httpError(400, 'from/to requeridos (YYYY-MM-DD)');
          cmd = commands.queryAttlog(`${json.from} 00:00:00`, `${json.to} 23:59:59`);
          break;
        }
        default: throw httpError(400, 'type inválido: info | check | reboot | queryUsers | queryAttlog');
      }
      return { id: repo.queueCommand(sn, cmd), command: cmd };
    }],

    ['GET', /^\/api\/employees$/, () => repo.listEmployees()],

    ['PATCH', /^\/api\/employees\/([^/]+)$/, ({ m, json }) => {
      if (!repo.getEmployee(m[1])) throw httpError(404, 'Empleado no encontrado');
      repo.updateEmployee(m[1], json);
      return repo.getEmployee(m[1]);
    }],

    // Envía (crea/actualiza) el empleado a uno o todos los equipos
    ['POST', /^\/api\/employees\/([^/]+)\/push$/, ({ m, json }) => {
      const e = repo.getEmployee(m[1]);
      if (!e) throw httpError(404, 'Empleado no encontrado');
      const targets = json.sn ? [json.sn] : repo.listDevices().map((d) => d.sn);
      const cmd = commands.upsertUser({ pin: e.pin, name: e.name, privilege: e.privilege, card: e.card || '' });
      return { queued: targets.map((sn) => ({ sn, id: repo.queueCommand(sn, cmd) })) };
    }],

    ['GET', /^\/api\/punches$/, ({ q }) => {
      const r = range(q);
      const rows = repo.punches(r.fromTs, r.toTs, q.get('pin') || null);
      if (q.get('format') === 'csv') {
        return csv(`marcaciones_${r.from}_${r.to}.csv`, toCsv(rows, [
          { key: 'pin', label: 'Código' }, { key: 'name', label: 'Nombre' }, { key: 'department', label: 'Área' },
          { key: 'ts', label: 'Fecha/hora' }, { key: 'device_sn', label: 'Equipo' },
          { key: 'status', label: 'Estado' }, { key: 'verify', label: 'Verificación' },
        ]));
      }
      return rows;
    }],

    ['GET', /^\/api\/report\/daily$/, ({ q }) => {
      const r = range(q);
      const rows = dailyReport(repo.punches(r.fromTs, r.toTs, q.get('pin') || null), { dedupMinutes: config.dedupMinutes });
      if (q.get('format') === 'csv') {
        return csv(`asistencia_${r.from}_${r.to}.csv`, toCsv(rows, [
          { key: 'date', label: 'Fecha' }, { key: 'pin', label: 'Código' }, { key: 'name', label: 'Nombre' },
          { key: 'department', label: 'Área' }, { key: 'firstIn', label: 'Entrada' }, { key: 'lastOut', label: 'Salida' },
          { key: 'worked', label: 'Horas' }, { key: 'marks', label: 'Marcaciones' }, { key: 'incomplete', label: 'Incompleto' },
        ]));
      }
      return rows;
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
        if (out && out.__csv) {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${out.filename}"`,
          });
          return res.end(out.content);
        }
        return sendJson(res, 200, out);
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
      }
    }
    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  };
}

function csv(filename, content) {
  return { __csv: true, filename, content };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}

module.exports = { createApi };
