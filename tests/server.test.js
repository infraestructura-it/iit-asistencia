'use strict';
/** Pruebas de integración: simula un biométrico real hablando ADMS con el servidor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createServer } = require('../src/app');

const SN = 'TEST0001';
let server, base, repo;
const config = { deviceTz: -5, dedupMinutes: 2, offlineAfterMin: 3, apiToken: '' };

test.before(async () => {
  repo = openDb(':memory:');
  server = createServer({ repo, config, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); repo.close(); });

const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, text: await r.text() }));
const post = (p, body, type = 'text/plain') =>
  fetch(base + p, { method: 'POST', body, headers: { 'Content-Type': type } }).then(async (r) => ({ status: r.status, text: await r.text() }));

test('handshake registra el equipo y responde opciones', async () => {
  const r = await get(`/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1`);
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(`GET OPTION FROM: ${SN}`));
  assert.ok(repo.getDevice(SN));
});

test('ATTLOG: guarda marcaciones y reenvío no duplica', async () => {
  const body = '1\t2026-11-19 07:00:00\t0\t1\t0\t0\n1\t2026-11-19 17:00:00\t1\t1\t0\t0\n2\t2026-11-19 08:00:00\t0\t15\t0\t0\n';
  const r1 = await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=100`, body);
  assert.equal(r1.text, 'OK: 3');
  const r2 = await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=100`, body); // el equipo reintenta
  assert.equal(r2.text, 'OK: 3');
  assert.equal(repo.punches('2026-11-19 00:00:00', '2026-11-19 23:59:59').length, 3);
  assert.equal(repo.getDevice(SN).att_stamp, '100');
});

test('el siguiente handshake devuelve el stamp guardado', async () => {
  const r = await get(`/iclock/cdata?SN=${SN}&options=all`);
  assert.match(r.text, /ATTLOGStamp=100/);
});

test('OPERLOG: crea/actualiza empleados con nombre', async () => {
  const r = await post(`/iclock/cdata?SN=${SN}&table=OPERLOG&OpStamp=55`, 'USER PIN=1\tName=Juan\tPri=0\tCard=0\nUSER PIN=2\tName=Ana\tPri=0\tCard=999\n');
  assert.equal(r.text, 'OK: 2');
  assert.equal(repo.getEmployee('1').name, 'Juan');
  assert.equal(repo.getEmployee('2').card, '999');
});

test('ciclo de comandos: API encola → getrequest entrega → devicecmd confirma', async () => {
  const q = await fetch(`${base}/api/devices/${SN}/commands`, { method: 'POST', body: JSON.stringify({ type: 'info' }) }).then((r) => r.json());
  assert.ok(q.id);
  const g = await get(`/iclock/getrequest?SN=${SN}&INFO=Ver 8.0.4,2,5,3,192.168.1.50`);
  assert.equal(g.text, `C:${q.id}:INFO\n`);
  assert.equal(repo.getDevice(SN).user_count, 2);
  assert.equal((await get(`/iclock/getrequest?SN=${SN}`)).text, 'OK'); // ya no está pendiente
  await post(`/iclock/devicecmd?SN=${SN}`, `ID=${q.id}&Return=0&CMD=INFO\n`);
  assert.equal(repo.listCommands(SN)[0].state, 'ok');
});

test('API: reporte diario y CSV', async () => {
  const rows = await fetch(`${base}/api/report/daily?from=2026-11-19&to=2026-11-19`).then((r) => r.json());
  const juan = rows.find((r) => r.pin === '1');
  assert.equal(juan.worked, '10:00');
  assert.equal(juan.name, 'Juan');
  const csv = await fetch(`${base}/api/reports/daily?from=2026-11-19&format=csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Juan/);
});

test('API: devices muestra en línea', async () => {
  const d = await fetch(`${base}/api/devices`).then((r) => r.json());
  assert.equal(d[0].sn, SN);
  assert.equal(d[0].online, true);
});

test('API: comando inválido → 400; equipo inexistente → 404', async () => {
  const a = await fetch(`${base}/api/devices/${SN}/commands`, { method: 'POST', body: JSON.stringify({ type: 'formatear' }) });
  assert.equal(a.status, 400);
  const b = await fetch(`${base}/api/devices/NOEXISTE/commands`, { method: 'POST', body: JSON.stringify({ type: 'info' }) });
  assert.equal(b.status, 404);
});

test('API con token exige autorización', async () => {
  config.apiToken = 'secreto';
  try {
    assert.equal((await fetch(`${base}/api/devices`)).status, 401);
    assert.equal((await fetch(`${base}/api/devices`, { headers: { Authorization: 'Bearer secreto' } })).status, 200);
    // el biométrico NO usa token: ADMS debe seguir funcionando
    assert.equal((await get(`/iclock/getrequest?SN=${SN}`)).status, 200);
  } finally {
    config.apiToken = '';
  }
});

test('panel estático y bloqueo de path traversal', async () => {
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/..%2Fpackage.json')).status, 404);
});
