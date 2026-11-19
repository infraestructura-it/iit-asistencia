'use strict';
/**
 * Parser del protocolo push ADMS ("iclock") de ZKTeco.
 * Funciones puras: sin BD ni red, para que sean fáciles de probar.
 */

const VERIFY = { 0: 'contraseña', 1: 'huella', 2: 'tarjeta', 3: 'contraseña', 4: 'tarjeta', 15: 'rostro', 25: 'palma' };
const STATUS = { 0: 'entrada', 1: 'salida', 2: 'salida_descanso', 3: 'regreso_descanso', 4: 'entrada_extra', 5: 'salida_extra' };

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Divide el cuerpo en líneas no vacías, tolerando \r\n, \n y bytes nulos (algunos firmwares rellenan con \0) */
function lines(body) {
  return String(body || '').replace(/\0/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

/**
 * "KEY=val\tKEY2=val2" -> { key: 'val', key2: 'val2' }
 * Claves en minúscula: según el firmware llegan como PIN/Pin/pin, Card/CardNo/cardno, etc.
 */
function parseKv(str) {
  const out = {};
  for (const part of String(str).split('\t')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

const TEMPLATE_KINDS = new Set(['FP', 'FACE', 'BIODATA', 'FVEIN', 'PV', 'BIOPHOTO', 'USERPIC']);
// Tipos de BIODATA (firmwares push ≥ 2.4: SpeedFace, ProFace, MB-VL, Horus…)
const BIO_TYPES = { 1: 'huella', 2: 'rostro', 3: 'voz', 4: 'iris', 5: 'retina', 6: 'palma', 7: 'vena', 8: 'palma', 9: 'rostro_vl' };

function userFromKv(kv) {
  const card = kv.card ?? kv.cardno ?? '';
  return {
    pin: kv.pin,
    name: kv.name || '',
    privilege: toInt(kv.pri ?? kv.privilege, 0),
    card: card && card !== '0' ? card : null,
    groupId: kv.grp || kv.group || null,
  };
}

/**
 * OPERLOG / USERINFO / BIODATA: líneas tipo
 *   "USER PIN=1\tName=Juan\tPri=0\tPasswd=\tCard=123\tGrp=1\tTZ=..."
 *   "FP PIN=1\tFID=6\tSize=1024\tValid=1\tTMP=..."
 *   "BIODATA Pin=1\tNo=0\tIndex=0\tValid=1\tType=9\tTmp=..."   (rostro luz visible / palma)
 *   "OPLOG 4\t0\t2026-11-19 08:00:00\t..."
 */
function parseOperlog(body) {
  const users = [];
  const templates = [];
  const oplogs = [];
  for (const raw of lines(body)) {
    const sp = raw.search(/[ \t]/);
    const kind = (sp > 0 ? raw.slice(0, sp) : raw).toUpperCase();
    const rest = sp > 0 ? raw.slice(sp + 1) : '';
    if (kind === 'USER') {
      const kv = parseKv(rest);
      if (kv.pin) users.push(userFromKv(kv));
    } else if (TEMPLATE_KINDS.has(kind)) {
      const kv = parseKv(rest);
      if (kv.pin) {
        const type = kind === 'BIODATA' ? BIO_TYPES[kv.type] || `tipo_${kv.type}` : kind === 'FP' ? 'huella' : kind === 'FACE' ? 'rostro' : kind.toLowerCase();
        templates.push({ pin: kv.pin, kind, type, fid: kv.fid || kv.no || null });
      }
    } else if (kind === 'OPLOG') {
      oplogs.push(rest.split('\t'));
    }
  }
  return { users, templates, oplogs };
}

/**
 * /iclock/querydata (firmwares push ≥ 2.4 responden así a DATA QUERY):
 *   tablename=user        → "user uid=1\tpin=1\tname=Ana\tprivilege=0\tcardno=..."
 *   tablename=ATTLOG/transaction → líneas ATTLOG normales o "transaction pin=1\ttime=2026-11-19 08:00:00..."
 */
function parseQueryData(tablename, body) {
  const t = String(tablename || '').toLowerCase();
  const users = [];
  const punches = [];
  for (const raw of lines(body)) {
    const sp = raw.search(/[ \t]/);
    const head = (sp > 0 ? raw.slice(0, sp) : '').toLowerCase();
    if (head === 'user' || (t === 'user' && raw.includes('='))) {
      const kv = parseKv(head === 'user' ? raw.slice(sp + 1) : raw);
      if (kv.pin) users.push(userFromKv(kv));
    } else if (head === 'transaction' || head === 'attlog' || (raw.includes('=') && t !== 'user')) {
      const kv = parseKv(sp > 0 && /^[a-z]+$/i.test(head) ? raw.slice(sp + 1) : raw);
      const ts = kv.time || kv.checktime || kv.datetime;
      if (kv.pin && TS_RE.test(ts || '')) {
        const status = toInt(kv.status ?? kv.inoutstate ?? kv.state, 0);
        const verify = toInt(kv.verify ?? kv.verifytype ?? kv.verified, 0);
        punches.push({ pin: kv.pin, ts, status, statusLabel: STATUS[status] || `estado_${status}`, verify, verifyLabel: VERIFY[verify] || `metodo_${verify}`, workcode: kv.workcode && kv.workcode !== '0' ? kv.workcode : null });
      }
    } else {
      punches.push(...parseAttlog(raw).punches);
    }
  }
  return { users, punches };
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
function handshakeResponse(sn, { attStamp = 'None', operStamp = 'None', tz = -5, delay = 10, transInterval = 1, transTimes = '00:00;14:05', realtime = true } = {}) {
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${attStamp}`,
    `OPERLOGStamp=${operStamp}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    `Delay=${delay}`,
    `TransTimes=${transTimes}`,
    `TransInterval=${transInterval}`,
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP',
    `TimeZone=${tz}`,
    `Realtime=${realtime ? 1 : 0}`,
    'Encrypt=None',
    'ServerVer=2.4.1',
    'PushProtVer=2.4.1',
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
  parseQueryData,
  BIO_TYPES,
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
