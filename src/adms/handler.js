'use strict';
/**
 * Endpoints "iclock" que llama el biométrico en modo push (ADMS / Servidor en la nube).
 * Regla de oro: siempre responder rápido y con texto plano; si algo falla
 * se guarda en raw_log y el equipo reintenta (no se pierden marcaciones).
 *
 * Compatibilidad: protocolo "T&A PUSH" de ZKTeco (pushver 2.x y 3.x en modo asistencia).
 * Los equipos de control de acceso (SpeedFace-V4L/V5L, ProFace-X, ProMA, F22, SenseFace…)
 * deben ponerse en Sistema → Tipo de dispositivo → T&A PUSH.
 */
const P = require('./parser');

// Tablas que traen plantillas o fotos: se aceptan (OK) y se cuentan, no se guarda el binario
const MEDIA_TABLES = new Set(['ATTPHOTO', 'BIOPHOTO', 'USERPIC', 'FACE', 'FINGERTMP', 'FVEIN', 'BIODATA', 'ERRORLOG']);

function createAdmsHandler({ repo, config, log = () => {} }) {
  return async function handle(req, res, url, body) {
    const q = url.searchParams;
    const sn = q.get('SN') || q.get('sn');
    const route = url.pathname.replace(/^\/iclock/i, '').replace(/\.aspx$/i, '').toLowerCase();
    const ip = (req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    if (!sn) return text(res, 'OK'); // ping/registry sin SN
    repo.touchDevice(sn, ip);

    try {
      if (route === '/cdata' && req.method === 'GET') {
        repo.raw(sn, 'cdata:handshake', url.search, null);
        // Datos que el equipo anuncia en la URL del handshake
        repo.setDeviceMeta(sn, {
          pushVer: q.get('pushver') || q.get('PushVersion'),
          model: q.get('DeviceType') && q.get('DeviceType') !== 'att' ? q.get('DeviceType') : null,
        });
        const d = repo.getDevice(sn);
        log(`[adms] handshake ${sn} (${ip}) pushver=${q.get('pushver') || '?'}`);
        return text(res, P.handshakeResponse(sn, {
          attStamp: d.att_stamp, operStamp: d.oper_stamp,
          tz: d.timezone ?? config.deviceTz, delay: d.delay ?? 10,
          transInterval: d.trans_interval ?? 1, transTimes: d.trans_times || '00:00;14:05',
        }));
      }

      if (route === '/cdata' && req.method === 'POST') {
        const table = (q.get('table') || '').toUpperCase();
        repo.raw(sn, `cdata:${table}`, url.search, MEDIA_TABLES.has(table) ? String(body).slice(0, 500) : body);

        if (table === 'ATTLOG') {
          const { punches, errors } = P.parseAttlog(body);
          const inserted = repo.insertPunches(sn, punches);
          const stamp = q.get('Stamp');
          if (stamp) repo.setStamps(sn, stamp, null);
          log(`[adms] ${sn} ATTLOG recibidas=${punches.length} nuevas=${inserted} malas=${errors.length}`);
          return text(res, `OK: ${punches.length}`);
        }

        if (table === 'OPERLOG' || table === 'USERINFO' || table === 'USER') {
          const { users, templates } = P.parseOperlog(body);
          if (users.length) repo.upsertEmployees(users);
          const stamp = q.get('OpStamp') || q.get('Stamp');
          if (stamp) repo.setStamps(sn, null, stamp);
          log(`[adms] ${sn} ${table} usuarios=${users.length} plantillas=${templates.length}`);
          return text(res, `OK: ${users.length + templates.length}`);
        }

        if (table === 'OPTIONS') {
          const kv = parseOptions(body);
          repo.setDeviceInfo(sn, {
            firmware: kv.FWVersion || kv.FirmVer,
            userCount: num(kv.UserCount), punchCount: num(kv.TransactionCount),
          });
          repo.setDeviceMeta(sn, {
            model: kv.DeviceName || kv.DeviceType, fpCount: num(kv.FPCount),
            faceCount: num(kv.FaceCount ?? kv.FaceTempCount),
          });
          return text(res, 'OK');
        }

        if (MEDIA_TABLES.has(table)) {
          const n = ['BIODATA', 'FACE', 'FINGERTMP'].includes(table) ? P.parseOperlog(prefixed(table, body)).templates.length : 1;
          return text(res, `OK: ${n}`);
        }

        return text(res, 'OK');
      }

      if (route === '/getrequest') {
        const info = q.get('INFO');
        if (info) {
          // "Ver 8.0.4.7,usuarios,huellas,marcaciones,ip,verHuella,verRostro,rostrosReq,rostros,funciones"
          const f = info.split(',');
          repo.setDeviceInfo(sn, { firmware: f[0], userCount: num(f[1]), punchCount: num(f[3]) });
          repo.setDeviceMeta(sn, { fpCount: num(f[2]), faceCount: num(f[8]) });
        }
        const cmds = repo.takeCommands(sn);
        if (cmds.length) log(`[adms] ${sn} enviando ${cmds.length} comando(s)`);
        return text(res, P.formatCommands(cmds));
      }

      if (route === '/devicecmd') {
        repo.raw(sn, 'devicecmd', url.search, body);
        for (const r of P.parseDeviceCmdResults(body)) repo.completeCommand(sn, r.id, r.ret);
        return text(res, 'OK');
      }

      // Firmwares push ≥ 2.4: respuesta a DATA QUERY en otra ruta
      if (route === '/querydata') {
        repo.raw(sn, 'querydata', url.search, body);
        const { users, punches } = P.parseQueryData(q.get('tablename') || q.get('table'), body);
        if (users.length) repo.upsertEmployees(users);
        const inserted = punches.length ? repo.insertPunches(sn, punches) : 0;
        log(`[adms] ${sn} querydata usuarios=${users.length} marcaciones=${punches.length} nuevas=${inserted}`);
        return text(res, `OK: ${users.length + punches.length}`);
      }

      return text(res, 'OK'); // /ping, /registry, /push, /fdata, etc.
    } catch (err) {
      log(`[adms] ERROR ${sn}: ${err.stack || err}`);
      repo.raw(sn, 'error', url.pathname + url.search, String(err.stack || err));
      // Responder error hace que el equipo reintente el lote más tarde
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('ERROR');
    }
  };
}

/** "~DeviceName=MB160,FWVersion=Ver 8.0…" o una clave por línea */
function parseOptions(body) {
  const kv = {};
  for (const part of String(body).replace(/\0/g, '').split(/[,\n\t]/)) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i).replace(/^~/, '').trim()] = part.slice(i + 1).trim();
  }
  return kv;
}

/** Algunas tablas llegan sin el prefijo de tipo en cada línea */
function prefixed(table, body) {
  const kind = table === 'FINGERTMP' ? 'FP' : table;
  return String(body).split(/\r?\n/).map((l) => (l && !/^[A-Z]+\s/.test(l) ? `${kind} ${l}` : l)).join('\n');
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function text(res, s) {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

module.exports = { createAdmsHandler, parseOptions };
