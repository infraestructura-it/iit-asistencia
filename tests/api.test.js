'use strict';
/** API del panel: CRUD, validaciones, novedades, marcación manual y reportes */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createServer } = require('../src/app');

let server, base, repo;
const config = { deviceTz: -5, dedupMinutes: 2, offlineAfterMin: 3, apiToken: '' };

test.before(async () => {
  repo = openDb(':memory:');
  server = createServer({ repo, config, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); repo.close(); });

async function call(method, path, body) {
  const r = await fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

test('dispositivo: crear manualmente, validar, editar y usar su config en el handshake', async () => {
  assert.equal((await call('POST', '/api/devices', { sn: 'x', alias: '' })).status, 400);
  const r = await call('POST', '/api/devices', { sn: 'UFS2255100650', alias: 'M2 Pro', ip: '192.168.40.57', timezone: -5, delay: 10, trans_interval: 1, trans_times: '00:00;14:05' });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/api/devices', { sn: 'UFS2255100650', alias: 'otro' })).status, 409);
  const bad = await call('PUT', '/api/devices/UFS2255100650', { alias: 'M2', trans_times: '25h' });
  assert.equal(bad.status, 400);
  await call('PUT', '/api/devices/UFS2255100650', { alias: 'M2 Portería', ip: '192.168.40.57', timezone: -5, delay: 30, trans_interval: 2, trans_times: '12:00' });
  const hs = await fetch(`${base}/iclock/cdata?SN=UFS2255100650&options=all`).then((x) => x.text());
  assert.match(hs, /Delay=30/);
  assert.match(hs, /TransInterval=2/);
  assert.match(hs, /TransTimes=12:00/);
  const list = (await call('GET', '/api/devices')).data;
  assert.equal(list[0].alias, 'M2 Portería');
  assert.equal(list[0].online, true);
});

test('departamentos y horarios', async () => {
  assert.equal((await call('POST', '/api/schedules', { name: 'Malo', start_time: '8:00', end_time: '17:00' })).status, 400);
  const s = await call('POST', '/api/schedules', { name: 'Taller', start_time: '07:00', end_time: '16:00', tolerance_min: 5, break_min: 60, workdays: '1,2,3,4,5' });
  assert.ok(s.data.id);
  const d = await call('POST', '/api/departments', { code: 'D1', name: 'Corte', schedule_id: s.data.id });
  assert.ok(d.data.id);
  assert.equal((await call('POST', '/api/departments', { name: 'Corte' })).status, 409);
  const depts = (await call('GET', '/api/departments')).data;
  assert.equal(depts[0].schedule_name, 'Taller');
});

test('empleados: crear con validación, enviar al equipo, editar, borrar', async () => {
  const depts = (await call('GET', '/api/departments')).data;
  assert.equal((await call('POST', '/api/employees', { pin: 'abc', name: 'X' })).status, 400);
  assert.equal((await call('POST', '/api/employees', { pin: '10' })).status, 400);
  const e = await call('POST', '/api/employees', { pin: '10', name: 'Ana', last_name: 'Ruiz', department_id: depts[0].id, sendToDevices: true });
  assert.equal(e.status, 200);
  assert.equal(e.data.department_name, 'Corte');
  assert.ok(e.data.effective_schedule_id, 'hereda horario del departamento');
  const cmds = repo.listCommands('UFS2255100650');
  assert.match(cmds[0].command, /^DATA UPDATE USERINFO PIN=10\tName=Ana Ruiz/);
  assert.equal((await call('POST', '/api/employees', { pin: '10', name: 'Dup' })).status, 409);
  const u = await call('PUT', '/api/employees/10', { name: 'Ana María', last_name: 'Ruiz', department_id: depts[0].id, position: 'Cortadora', active: 1 });
  assert.equal(u.data.position, 'Cortadora');
  // el equipo NO sobrescribe un nombre ya editado en el panel
  repo.upsertEmployees([{ pin: '10', name: 'ANA', privilege: 0 }]);
  assert.equal(repo.getEmployee('10').name, 'Ana María');
  await call('POST', '/api/employees', { pin: '99', name: 'Temporal' });
  const del = await call('DELETE', '/api/employees/99?fromDevices=1');
  assert.equal(del.data.queued.length, 1);
  assert.match(repo.listCommands('UFS2255100650')[0].command, /^DATA DELETE USERINFO PIN=99/);
});

test('marcación manual: requiere motivo, no admite futuro y solo se borran las manuales', async () => {
  assert.equal((await call('POST', '/api/punches', { pin: '10', date: '2026-11-17', time: '08:00' })).status, 400);
  assert.equal((await call('POST', '/api/punches', { pin: '10', date: '2099-01-01', time: '08:00', note: 'x' })).status, 400);
  const ok = await call('POST', '/api/punches', { pin: '10', date: '2026-11-17', time: '07:02', note: 'Olvidó marcar' });
  assert.ok(ok.data.id);
  await fetch(`${base}/iclock/cdata?SN=UFS2255100650&table=ATTLOG`, { method: 'POST', body: '10\t2026-11-17 16:10:00\t1\t1\t0\t0\n' });
  const punches = (await call('GET', '/api/punches?from=2026-11-17')).data;
  assert.equal(punches.length, 2);
  const devicePunch = punches.find((p) => p.source === 'device');
  assert.equal((await call('DELETE', '/api/punches/' + devicePunch.id)).status, 400);
});

test('novedades: valida tipo y fechas', async () => {
  assert.equal((await call('POST', '/api/incidents', { pin: '10', type: 'XXX', from_date: '2026-11-18', to_date: '2026-11-18' })).status, 400);
  assert.equal((await call('POST', '/api/incidents', { pin: '10', type: 'VAC', from_date: '2026-11-20', to_date: '2026-11-18' })).status, 400);
  const r = await call('POST', '/api/incidents', { pin: '10', type: 'VAC', from_date: '2026-11-18', to_date: '2026-11-18', note: 'Día libre' });
  assert.ok(r.data.id);
  assert.equal((await call('GET', '/api/incidents?from=2026-11-01&to=2026-11-30')).data.length, 1);
  assert.equal((await call('GET', '/api/incident-types')).data.INC.label, 'Incapacidad');
});

test('festivos: automáticos de Colombia + propios', async () => {
  await call('POST', '/api/holidays', { date: '2026-12-24', name: 'Día de la empresa' });
  const h = (await call('GET', '/api/holidays?year=2026')).data;
  assert.equal(h.length, 19);
  assert.ok(h.find((x) => x.date === '2026-12-24').custom);
});

test('reportes: catálogo, columnas elegidas en orden y formatos', async () => {
  const cat = (await call('GET', '/api/reports')).data;
  assert.ok(cat.find((r) => r.id === 'summary'));
  const daily = (await call('GET', '/api/reports/daily?from=2026-11-17&to=2026-11-17&cols=worked,pin,noexiste')).data;
  assert.deepEqual(daily.columns.map((c) => c.key), ['worked', 'pin']);
  assert.equal(daily.rows[0].firstIn, '07:02');
  assert.equal(daily.rows[0].lastOut, '16:10');
  assert.equal(daily.rows[0].worked, '08:08'); // 9h08 − 60 min descanso (horario Taller)
  const abs = (await call('GET', '/api/reports/absences?from=2026-11-16&to=2026-11-18')).data;
  // Lun 16 festivo, Mar 17 trabajó, Mié 18 vacaciones → sin ausencias
  assert.equal(abs.rows.length, 0);
  const sum = (await call('GET', '/api/reports/summary?from=2026-11-16&to=2026-11-18')).data;
  assert.equal(sum.rows.find((r) => r.pin === '10').incidentDays, 1);

  const x = await call('GET', '/api/reports/summary?from=2026-11-16&to=2026-11-18&format=xlsx');
  assert.match(x.type, /spreadsheetml/);
  assert.equal(x.data.slice(0, 2).toString(), 'PK');
  const t = await call('GET', '/api/reports/transactions?from=2026-11-17&format=txt');
  assert.match(t.data.toString(), /^Código\tNombre/);
  assert.match(t.data.toString(), /Manual/);
  assert.equal((await call('GET', '/api/reports/nada')).status, 404);
  assert.equal((await call('GET', '/api/reports/daily?from=2026-11-18&to=2026-11-01')).status, 400);
});

test('tablero', async () => {
  const d = (await call('GET', '/api/dashboard')).data;
  assert.equal(typeof d.present, 'number');
  assert.equal(d.byHour.length, 24);
  assert.equal(d.devices.length, 1);
});

test('resincronizar: reinicia los stamps y encola CHECK', async () => {
  repo.setStamps('UFS2255100650', '500', '20');
  const r = await call('POST', '/api/devices/UFS2255100650/commands', { type: 'resync' });
  assert.equal(r.data.command, 'CHECK');
  assert.equal(repo.getDevice('UFS2255100650').att_stamp, 'None');
});
