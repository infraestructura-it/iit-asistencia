'use strict';
/**
 * Compatibilidad: simula equipos de distintas familias de la lista ZKTeco
 * (firmware antiguo, rostro de luz visible push 2.4, equipos de acceso en T&A PUSH) y HTTPS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { openDb } = require('../src/db');
const { createServer, createRequestHandler, decodeBody } = require('../src/app');
const { matchModel, DEVICES } = require('../src/compat');
const P = require('../src/adms/parser');

let server, base, repo;
const config = { deviceTz: -5, dedupMinutes: 2, offlineAfterMin: 3, apiToken: '' };

test.before(async () => {
  repo = openDb(':memory:');
  server = createServer({ repo, config, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); repo.close(); });

const send = (method, p, body) => fetch(base + p, { method, body }).then(async (r) => ({ status: r.status, text: await r.text() }));

test('lista de compatibilidad: modelos y variantes', () => {
  assert.ok(DEVICES.length >= 42);
  const cases = {
    'SpeedFace-V5L': 'SpeedFace-V5L', 'SpeedFace-V5L[P]': 'SpeedFace-V5L', 'SpeedFace-V4L Pro': 'SpeedFace-V4L',
    'ProFace X [TD]': 'ProFace-X', 'MB160/ID': 'MB160', 'uFace 800': 'uFace', 'Horus TL1 Pro': 'Horus TL1 Pro',
    'M2F PRO-UD': 'M2F PRO-UD', 'SenseFace 4A': 'SenseFace', 'M2 Pro': 'M2 Pro',
  };
  for (const [reported, expected] of Object.entries(cases)) assert.equal((matchModel(reported) || {}).model, expected, reported);
  assert.equal(matchModel('K40'), null);
  assert.equal(matchModel(''), null);
  assert.equal(matchModel('SpeedFace-V5L').access, true);
  assert.equal(matchModel('MB160').access, false);
});

test('firmware antiguo: rutas .aspx, nombres en Latin-1 y bytes nulos', async () => {
  const SN = 'OLDFW001';
  const hs = await send('GET', `/iclock/cdata.aspx?SN=${SN}&options=all`);
  assert.match(hs.text, /GET OPTION FROM: OLDFW001/);
  // "USER PIN=5\tName=José Muñoz" codificado en Latin-1 + relleno \0
  const latin1 = Buffer.concat([Buffer.from('USER PIN=5\tName=Jos\xe9 Mu\xf1oz\tPri=0\tCard=0\n', 'latin1'), Buffer.from([0, 0])]);
  const r = await send('POST', `/iclock/cdata.aspx?SN=${SN}&table=OPERLOG`, latin1);
  assert.equal(r.text, 'OK: 1');
  assert.equal(repo.getEmployee('5').name, 'José Muñoz');
  const att = await send('POST', `/iclock/cdata.aspx?SN=${SN}&table=ATTLOG&Stamp=9`, '5\t2026-11-19 07:59:00\t0\t1\t0\t0\n\0\0');
  assert.equal(att.text, 'OK: 1');
});

test('rostro luz visible (SpeedFace / MB-VL, push 2.4): opciones, BIODATA, fotos, querydata', async () => {
  const SN = 'VL5L0001';
  await send('GET', `/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1&language=69&pushcommkey=abc`);
  await send('POST', `/iclock/cdata?SN=${SN}&table=options`, '~DeviceName=SpeedFace-V5L[P],FWVersion=ZAM180-NF-Ver1.2.5,UserCount=3,FaceCount=3,FPCount=2,TransactionCount=10');
  let d = repo.getDevice(SN);
  assert.equal(d.push_ver, '2.4.1');
  assert.equal(d.model, 'SpeedFace-V5L[P]');
  assert.equal(d.firmware, 'ZAM180-NF-Ver1.2.5');
  assert.equal(d.face_count, 3);

  const bio = await send('POST', `/iclock/cdata?SN=${SN}&table=BIODATA`, 'BIODATA Pin=7\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=5\tMinorVer=8\tFormat=0\tTmp=AAAA\n');
  assert.equal(bio.text, 'OK: 1');
  assert.equal((await send('POST', `/iclock/cdata?SN=${SN}&table=ATTPHOTO`, 'PIN=7\nSN=VL5L0001\nsize=3\nCMD=uploadphoto\n\xff\xd8\xff')).text, 'OK: 1');
  // usuario con claves en minúscula/mixtas
  await send('POST', `/iclock/cdata?SN=${SN}&table=OPERLOG`, 'USER Pin=7\tName=Ana Ruiz\tPrivilege=0\tCardNo=12345\n');
  assert.equal(repo.getEmployee('7').card, '12345');
  // marcación por rostro (verify 15)
  await send('POST', `/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=1`, '7\t2026-11-19 08:01:00\t0\t15\t0\t0\t0\t0\t0\t0\n');
  // respuesta a DATA QUERY por la ruta querydata
  const q1 = await send('POST', `/iclock/querydata?SN=${SN}&type=tabledata&cmdid=4&tablename=user&count=1`, 'user uid=2\tpin=8\tname=Luis\tprivilege=0\tcardno=0\n');
  assert.equal(q1.text, 'OK: 1');
  assert.equal(repo.getEmployee('8').name, 'Luis');
  const q2 = await send('POST', `/iclock/querydata?SN=${SN}&type=tabledata&tablename=transaction`, 'transaction pin=8\ttime=2026-11-19 08:10:00\tverifytype=15\tinoutstate=0\n');
  assert.equal(q2.text, 'OK: 1');
  const punches = repo.punches('2026-11-19 00:00:00', '2026-11-19 23:59:59').filter((p) => p.device_sn === SN);
  assert.deepEqual(punches.map((p) => `${p.pin}@${p.ts.slice(11, 16)}/${p.verify}`), ['7@08:01/15', '8@08:10/15']);
  // INFO en getrequest con conteos de huella y rostro
  await send('GET', `/iclock/getrequest?SN=${SN}&INFO=ZAM180-NF-Ver1.2.5,4,2,12,192.168.1.20,10,7,12,4,111`);
  d = repo.getDevice(SN);
  assert.equal(d.user_count, 4);
  assert.equal(d.fp_count, 2);
  assert.equal(d.face_count, 4);
  // el panel lo marca como compatible y de acceso (T&A PUSH)
  const list = await fetch(`${base}/api/devices`).then((r) => r.json());
  const vl = list.find((x) => x.sn === SN);
  assert.equal(vl.compat.model, 'SpeedFace-V5L');
  assert.equal(vl.compat.access, true);
});

test('rutas desconocidas del protocolo responden OK (registry, push, ping, fdata)', async () => {
  for (const p of ['/iclock/registry?SN=X9', '/iclock/push?SN=X9', '/iclock/ping?SN=X9', '/iclock/fdata?SN=X9&table=ATTPHOTO']) {
    const r = await send(p.includes('registry') || p.includes('fdata') ? 'POST' : 'GET', p, p.includes('registry') ? 'DeviceType=acc' : undefined);
    assert.equal(r.status, 200, p);
    assert.equal(r.text, 'OK', p);
  }
});

test('handshake anuncia versión de protocolo del servidor', async () => {
  const r = await send('GET', '/iclock/cdata?SN=HS01&options=all&pushver=3.1.2');
  assert.match(r.text, /ServerVer=2\.4\.1/);
  assert.match(r.text, /PushProtVer=2\.4\.1/);
  assert.equal(repo.getDevice('HS01').push_ver, '3.1.2');
});

test('parseQueryData tolera ATTLOG plano', () => {
  const r = P.parseQueryData('ATTLOG', '9\t2026-11-19 09:00:00\t1\t2\t0\t0\n');
  assert.equal(r.punches[0].verifyLabel, 'tarjeta');
});

test('decodeBody: UTF-8 válido se respeta, inválido cae a Latin-1', () => {
  assert.equal(decodeBody(Buffer.from('Peña ñ', 'utf8')), 'Peña ñ');
  assert.equal(decodeBody(Buffer.from('Pe\xf1a', 'latin1')), 'Peña');
  assert.equal(decodeBody(Buffer.alloc(0)), '');
});

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }

test('HTTPS: el equipo puede hablar por TLS', { skip: !hasOpenssl && 'openssl no disponible' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iit-tls-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const tls = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, createRequestHandler({ repo, config, log: () => {} }));
  await new Promise((r) => tls.listen(0, '127.0.0.1', r));
  try {
    const body = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port: tls.address().port, path: '/iclock/cdata?SN=TLS001&options=all', rejectUnauthorized: false }, (res) => {
        let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve(s));
      }).on('error', reject);
    });
    assert.match(body, /GET OPTION FROM: TLS001/);
  } finally {
    tls.close();
  }
});
