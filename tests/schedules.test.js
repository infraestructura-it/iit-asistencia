'use strict';
/** Horarios, turnos nocturnos, festivos, ausencias y resumen */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dailyReport, absenceReport, summaryReport, eachDate, weekday } = require('../src/attendance');
const { colombianHolidays, easter } = require('../src/holidays-co');

const DAY = { id: 1, name: 'General', start_time: '08:00', end_time: '17:00', tolerance_min: 5, break_min: 60, workdays: '1,2,3,4,5' };
const NIGHT = { id: 2, name: 'Nocturno', start_time: '22:00', end_time: '06:00', tolerance_min: 10, break_min: 30, workdays: '1,2,3,4,5,6' };
const schedules = new Map([[1, DAY], [2, NIGHT]]);
const p = (pin, ts, schedule_id = 1) => ({ pin, ts, schedule_id, name: 'X' });

test('tardanza solo si pasa la tolerancia', () => {
  const rows = dailyReport([
    p('1', '2026-11-18 08:05:00'), p('1', '2026-11-18 17:00:00'),
    p('2', '2026-11-18 08:06:00'), p('2', '2026-11-18 17:00:00'),
  ], { schedules });
  assert.equal(rows.find((r) => r.pin === '1').lateMinutes, 0);
  assert.equal(rows.find((r) => r.pin === '2').lateMinutes, 6);
  assert.equal(rows.find((r) => r.pin === '2').status, 'Tarde');
});

test('2 marcaciones: descuenta el descanso; 4 marcaciones: no', () => {
  const two = dailyReport([p('1', '2026-11-18 08:00:00'), p('1', '2026-11-18 17:00:00')], { schedules })[0];
  assert.equal(two.worked, '08:00');
  assert.equal(two.overtimeMinutes, 0);
  const four = dailyReport([p('1', '2026-11-18 08:00:00'), p('1', '2026-11-18 12:00:00'), p('1', '2026-11-18 12:30:00'), p('1', '2026-11-18 18:00:00')], { schedules })[0];
  assert.equal(four.worked, '09:30');
  assert.equal(four.overtime, '01:30');
});

test('salida temprana', () => {
  const r = dailyReport([p('1', '2026-11-18 08:00:00'), p('1', '2026-11-18 16:30:00')], { schedules })[0];
  assert.equal(r.earlyMinutes, 30);
});

test('turno nocturno: la salida de madrugada pertenece al día de entrada', () => {
  const rows = dailyReport([p('7', '2026-11-18 21:58:00', 2), p('7', '2026-11-19 06:05:00', 2)], { schedules });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-11-18');
  assert.equal(rows[0].firstIn, '21:58');
  assert.equal(rows[0].lastOut, '06:05');
  assert.equal(rows[0].worked, '07:37'); // 8h07 − 30 min de descanso
  assert.equal(rows[0].lateMinutes, 0);
  assert.equal(rows[0].incomplete, false);
});

test('festivo: sin tardanza y todo es extra', () => {
  const r = dailyReport([p('1', '2026-11-16 09:00:00'), p('1', '2026-11-16 13:00:00')], { schedules, holidays: ['2026-11-16'] })[0];
  assert.equal(r.status, 'Festivo');
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.overtime, '04:00');
});

test('ausencias: respeta días laborables, festivos, novedades, ingreso y fecha actual', () => {
  const employees = [
    { pin: '1', name: 'Ana', active: 1, effective_schedule_id: 1 },
    { pin: '2', name: 'Beto', active: 1, effective_schedule_id: 1, hire_date: '2026-11-19' },
    { pin: '3', name: 'Ceci', active: 0, effective_schedule_id: 1 },
    { pin: '4', name: 'Dani', active: 1, effective_schedule_id: null },
  ];
  const daily = dailyReport([p('1', '2026-11-17 08:00:00'), p('1', '2026-11-17 17:00:00')], { schedules });
  // Lun 16 (festivo), Mar 17 (trabajó), Mié 18 (vacaciones), Jue 19, Vie 20 (futuro), Sáb 21, Dom 22
  const abs = absenceReport(employees, daily, {
    from: '2026-11-16', to: '2026-11-22', schedules, today: '2026-11-19', holidays: ['2026-11-16'],
    incidents: [{ pin: '1', type: 'VAC', from_date: '2026-11-18', to_date: '2026-11-18' }],
  });
  assert.deepEqual(abs.map((a) => `${a.pin}@${a.date}`), ['1@2026-11-19', '2@2026-11-19']);
});

test('resumen por empleado suma días, tardanzas, ausencias y novedades', () => {
  const employees = [{ pin: '1', name: 'Ana', active: 1, effective_schedule_id: 1 }, { pin: '2', name: 'Beto', active: 1, effective_schedule_id: 1 }];
  const daily = dailyReport([
    p('1', '2026-11-17 08:20:00'), p('1', '2026-11-17 17:00:00'),
    p('1', '2026-11-18 08:00:00'), p('1', '2026-11-18 18:00:00'),
  ], { schedules });
  const absences = [{ pin: '2', name: 'Beto', department: '', date: '2026-11-17' }];
  const incidents = [{ pin: '2', type: 'INC', from_date: '2026-11-18', to_date: '2026-11-20' }];
  const [ana, beto] = summaryReport(employees, daily, absences, { incidents, from: '2026-11-16', to: '2026-11-19' });
  assert.equal(ana.days, 2);
  assert.equal(ana.lateCount, 1);
  assert.equal(ana.lateMinutes, 20);
  assert.equal(ana.overtime, '01:00');
  assert.equal(beto.absences, 1);
  assert.equal(beto.incidentDays, 2); // recortado al período
  assert.equal(beto.incidents, 'INC:2');
});

test('eachDate y weekday', () => {
  assert.deepEqual(eachDate('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(weekday('2026-11-16'), 1);
  assert.equal(weekday('2026-11-22'), 7);
});

test('Pascua (fechas conocidas)', () => {
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  assert.equal(iso(easter(2025)), '2025-04-20');
  assert.equal(iso(easter(2026)), '2026-04-05');
  assert.equal(iso(easter(2027)), '2027-03-28');
});

test('festivos de Colombia 2026 (calendario oficial)', () => {
  assert.deepEqual(colombianHolidays(2026).map((h) => h.date), [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
    '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16',
    '2026-12-08', '2026-12-25',
  ]);
});

test('festivos trasladables siempre caen en lunes', () => {
  for (const y of [2025, 2026, 2027, 2028]) {
    for (const h of colombianHolidays(y)) {
      if (['Año Nuevo', 'Día del Trabajo', 'Día de la Independencia', 'Batalla de Boyacá', 'Inmaculada Concepción', 'Navidad', 'Jueves Santo', 'Viernes Santo'].includes(h.name)) continue;
      assert.equal(new Date(h.date + 'T00:00:00Z').getUTCDay(), 1, `${y} ${h.name} ${h.date}`);
    }
  }
});
