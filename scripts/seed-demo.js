'use strict';
/**
 * Carga datos de demostración en una BD aparte (no toca la real).
 * Uso:  node scripts/seed-demo.js ./data/demo.db
 *       DB_PATH=./data/demo.db PORT=8099 npm start
 */
const { openDb } = require('../src/db');

const file = process.argv[2] || './data/demo.db';
const repo = openDb(file);
const SN = 'UFS2255100650';

if (!repo.getDevice(SN)) repo.createDevice({ sn: SN, alias: 'M2 Pro', ip: '192.168.40.57', area: 'Produccion', timezone: -5 });
repo.touchDevice(SN, '192.168.40.57');
repo.setDeviceInfo(SN, { firmware: 'Ver 8.0.4.7-20240510', userCount: 12, punchCount: 4718 });
try { repo.createArea('Produccion'); } catch {}

const gen = repo.listSchedules()[0].id;
const night = repo.createSchedule({ name: 'Nocturno', start_time: '22:00', end_time: '06:00', tolerance_min: 10, break_min: 30, workdays: '1,2,3,4,5,6' });
const depts = ['Corte', 'Costura', 'Administración'].map((name, i) => {
  try { return repo.createDepartment({ code: `D0${i + 1}`, name, schedule_id: i === 1 ? night : gen }); } catch { return repo.listDepartments().find((d) => d.name === name).id; }
});

const people = [
  ['Ana', 'Rodríguez'], ['Carlos', 'Gómez'], ['Luisa', 'Martínez'], ['Jorge', 'Pérez'], ['Diana', 'López'], ['Andrés', 'Ramírez'],
  ['Paola', 'Torres'], ['Felipe', 'Castro'], ['Sandra', 'Moreno'], ['Juan', 'Herrera'], ['Camila', 'Vargas'], ['Mauricio', 'Rojas'],
];
people.forEach(([n, l], i) => {
  const pin = String(i + 1);
  if (!repo.getEmployee(pin)) repo.createEmployee({ pin, name: n, last_name: l, department_id: depts[i % 3], position: i % 3 === 2 ? 'Auxiliar' : 'Operario', hire_date: '2025-02-01', active: 1 });
});

// Marcaciones de las últimas 3 semanas (laborables), con tardanzas y olvidos
const pad = (n) => String(n).padStart(2, '0');
const punches = [];
const now = new Date(Date.now() - 5 * 3600000);
for (let d = 20; d >= 0; d--) {
  const day = new Date(now.getTime() - d * 86400000);
  const date = day.toISOString().slice(0, 10);
  const wd = day.getUTCDay();
  if (wd === 0) continue;
  people.forEach((_, i) => {
    const pin = String(i + 1);
    const seed = (i * 31 + d * 7) % 23;
    if (seed === 3) return; // ausente
    if (i % 3 === 1) { // nocturno
      if (d === 0) return;
      punches.push({ pin, ts: `${date} 21:${pad(45 + (seed % 14))}:00` });
      const next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10);
      if (d > 0) punches.push({ pin, ts: `${next} 06:${pad(seed % 20)}:00` });
      return;
    }
    if (wd === 6) return;
    const late = seed % 6 === 0 ? 12 + seed : seed % 4;
    punches.push({ pin, ts: `${date} 0${late > 59 ? 9 : 8}:${pad(late % 60)}:00` });
    if (d === 0) return;
    if (seed !== 7) {
      punches.push({ pin, ts: `${date} 12:${pad(seed % 10)}:00` });
      punches.push({ pin, ts: `${date} 13:0${seed % 9}:00` });
    }
    punches.push({ pin, ts: `${date} 17:${pad(seed % 3 === 0 ? 45 : 2 + seed)}:00` });
  });
}
const n = repo.insertPunches(SN, punches.map((p) => ({ ...p, status: 0, verify: 1, workcode: null })));
const t = now.toISOString().slice(0, 10);
repo.createIncident({ pin: '5', type: 'VAC', from_date: t, to_date: new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10), note: 'Vacaciones aprobadas' });
repo.createIncident({ pin: '9', type: 'INC', from_date: new Date(now.getTime() - 9 * 86400000).toISOString().slice(0, 10), to_date: new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10), note: 'Incapacidad EPS' });
console.log(`Demo lista en ${file}: ${people.length} empleados, ${n} marcaciones nuevas`);
repo.close();
