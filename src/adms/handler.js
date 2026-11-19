'use strict';
/**
 * Endpoints "iclock" que llama el biométrico en modo push (ADMS / Servidor en la nube).
 * Regla de oro: siempre responder rápido y con texto plano; si algo falla
 * se guarda en raw_log y el equipo reintenta (no se pierden marcaciones).
 */
const P = require('./parser');

function createAdmsHandler({ repo, config, log = () => {} }) {
  return async function handle(req, res, url, body) {
    const sn = url.searchParams.get('SN') || url.searchParams.get('sn');
    const route = url.pathname.replace(/^\/iclock/, '').replace(/\.aspx$/, '').toLowerCase();
    const ip = (req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    if (!sn) return text(res, 'OK'); // ping/registry sin SN
    repo.touchDevice(sn, ip);

    try {
      if (route === '/cdata' && req.method === 'GET') {
        repo.raw(sn, 'cdata:handshake', url.search, null);
        const d = repo.getDevice(sn);
        log(`[adms] handshake ${sn} (${ip})`);
        return text(res, P.handshakeResponse(sn, { attStamp: d.att_stamp, operStamp: d.oper_stamp, tz: config.deviceTz }));
      }

      if (route === '/cdata' && req.method === 'POST') {
        const table = (url.searchParams.get('table') || '').toUpperCase();
        repo.raw(sn, `cdata:${table}`, url.search, body);

        if (table === 'ATTLOG') {
          const { punches, errors } = P.parseAttlog(body);
          const inserted = repo.insertPunches(sn, punches);
          const stamp = url.searchParams.get('Stamp');
          if (stamp) repo.setStamps(sn, stamp, null);
          log(`[adms] ${sn} ATTLOG recibidas=${punches.length} nuevas=${inserted} malas=${errors.length}`);
          return text(res, `OK: ${punches.length}`);
        }

        if (table === 'OPERLOG' || table === 'USERINFO') {
          const { users, templates } = P.parseOperlog(body);
          if (users.length) repo.upsertEmployees(users);
          const stamp = url.searchParams.get('OpStamp') || url.searchParams.get('Stamp');
          if (stamp) repo.setStamps(sn, null, stamp);
          log(`[adms] ${sn} ${table} usuarios=${users.length} plantillas=${templates.length}`);
          return text(res, `OK: ${users.length + templates.length}`);
        }

        if (table === 'OPTIONS') {
          const kv = {};
          for (const part of String(body).split(/[,\n]/)) {
            const i = part.indexOf('=');
            if (i > 0) kv[part.slice(0, i).replace(/^~/, '').trim()] = part.slice(i + 1).trim();
          }
          repo.setDeviceInfo(sn, { firmware: kv.FWVersion || kv.FirmVer });
          return text(res, 'OK');
        }

        return text(res, 'OK'); // ATTPHOTO u otras tablas: aceptar sin procesar
      }

      if (route === '/getrequest') {
        const info = url.searchParams.get('INFO');
        if (info) {
          const f = info.split(',');
          repo.setDeviceInfo(sn, { firmware: f[0], userCount: num(f[1]), punchCount: num(f[3]) });
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

      return text(res, 'OK'); // /ping, /registry, /push, etc.
    } catch (err) {
      log(`[adms] ERROR ${sn}: ${err.stack || err}`);
      repo.raw(sn, 'error', url.pathname + url.search, String(err.stack || err));
      // Responder error hace que el equipo reintente el lote más tarde
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('ERROR');
    }
  };
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function text(res, s) {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

module.exports = { createAdmsHandler };
