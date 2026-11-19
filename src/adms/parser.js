'use strict';
/**
 * Parser del protocolo push ADMS ("iclock") de ZKTeco.
 * Funciones puras: sin BD ni red, para que sean fáciles de probar.
 */

const VERIFY = { 0: 'contraseña', 1: 'huella', 2: 'tarjeta', 3: 'contraseña', 4: 'tarjeta', 15: 'rostro', 25: 'palma' };
const STATUS = { 0: 'entrada', 1: 'salida', 2: 'salida_descanso', 3: 'regreso_descanso', 4: 'entrada_extra', 5: 'salida_extra' };

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Divide el cuerpo en líneas no vacías, tolerando \r\n y \n */
function lines(body) {
  return String(body || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * ATTLOG: "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode\t..."
 * Devuelve { punches, errors } — nunca lanza: una línea mala no tumba el lote.
 */
function parseAttlog(body) {
  const punches = [];
  const errors = [];
  for (const raw of lines(body)) {
    const f = raw.split('\t');
    const pin = (f[0] || '').trim();
    const ts = (f[1] || '').trim();
    if (!pin || !TS_RE.test(ts)) {
      errors.push(raw);
      continue;
    }
    const status = toInt(f[2], 0);
    const verify = toInt(f[3], 0);
    punches.push({
      pin,
      ts,
      status,
      statusLabel: STATUS[status] || `estado_${status}`,
      verify,
      verifyLabel: VERIFY[verify] || `metodo_${verify}`,
      workcode: ['', '0'].includes((f[4] || '').trim()) ? null : f[4].trim(),
    });
  }
  return { punches, errors };
}

/** "KEY=val\tKEY2=val2" -> { KEY: 'val', KEY2: 'val2' } */
function parseKv(str) {
  const out = {};
  for (const part of String(str).split('\t')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * OPERLOG / USERINFO: líneas tipo
 *   "USER PIN=1\tName=Juan\tPri=0\tPasswd=\tCard=123\tGrp=1\tTZ=..."
 *   "FP PIN=1\tFID=6\tSize=1024\tValid=1\tTMP=..."
 *   "OPLOG 4\t0\t2026-11-19 08:00:00\t..."
 * Devuelve usuarios, conteo de plantillas y operaciones.
 */
function parseOperlog(body) {
  const users = [];
  const templates = [];
  const oplogs = [];
  for (const raw of lines(body)) {
    const sp = raw.indexOf(' ');
    const kind = sp > 0 ? raw.slice(0, sp).toUpperCase() : raw.toUpperCase();
    const rest = sp > 0 ? raw.slice(sp + 1) : '';
    if (kind === 'USER') {
      const kv = parseKv(rest);
      if (kv.PIN) {
        users.push({
          pin: kv.PIN,
          name: kv.Name || '',
          privilege: toInt(kv.Pri, 0),
          card: kv.Card && kv.Card !== '0' ? kv.Card : null,
          groupId: kv.Grp || null,
        });
      }
    } else if (kind === 'FP' || kind === 'FACE' || kind === 'BIODATA') {
      const kv = parseKv(rest);
      if (kv.PIN) templates.push({ pin: kv.PIN, kind, fid: kv.FID || kv.No || null });
    } else if (kind === 'OPLOG') {
      oplogs.push(rest.split('\t'));
    }
  }
  return { users, templates, oplogs };
}

/** Cuerpo de /iclock/devicecmd: "ID=1&Return=0&CMD=DATA\nID=2&Return=-1&CMD=..." */
function parseDeviceCmdResults(body) {
  const out = [];
  for (const raw of lines(body)) {
    const p = new URLSearchParams(raw);
    const id = p.get('ID');
    if (id) out.push({ id: Number(id), ret: toInt(p.get('Return'), -999), cmd: p.get('CMD') || '' });
  }
  return out;
}

/** Respuesta al handshake inicial GET /iclock/cdata?SN=...&options=all */
function handshakeResponse(sn, { attStamp = 'None', operStamp = 'None', tz = -5 } = {}) {
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${attStamp}`,
    `OPERLOGStamp=${operStamp}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP',
    `TimeZone=${tz}`,
    'Realtime=1',
    'Encrypt=None',
  ].join('\n') + '\n';
}

/** Formatea comandos pendientes para /iclock/getrequest */
function formatCommands(cmds) {
  if (!cmds.length) return 'OK';
  return cmds.map((c) => `C:${c.id}:${c.command}`).join('\n') + '\n';
}

/** Constructores de comandos frecuentes (evita errores de tipeo con tabs) */
const commands = {
  upsertUser: ({ pin, name = '', privilege = 0, card = '', password = '' }) =>
    `DATA UPDATE USERINFO PIN=${pin}\tName=${sanitize(name)}\tPri=${privilege}\tPasswd=${sanitize(password)}\tCard=${sanitize(card)}\tGrp=1\tTZ=0000000000000000`,
  deleteUser: (pin) => `DATA DELETE USERINFO PIN=${pin}`,
  queryAttlog: (from, to) => `DATA QUERY ATTLOG StartTime=${from}\tEndTime=${to}`,
  queryUsers: () => 'DATA QUERY USERINFO',
  info: () => 'INFO',
  check: () => 'CHECK',
  reboot: () => 'REBOOT',
};

function sanitize(v) {
  return String(v ?? '').replace(/[\t\r\n]/g, ' ');
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

module.exports = {
  parseAttlog,
  parseOperlog,
  parseKv,
  parseDeviceCmdResults,
  handshakeResponse,
  formatCommands,
  commands,
  STATUS,
  VERIFY,
};
