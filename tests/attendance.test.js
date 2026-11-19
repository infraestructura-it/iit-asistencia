'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupe, dailyReport, fmtHours, toCsv } = require('../src/attendance');

const p = (pin, ts, extra = {}) => ({ pin, ts, ...extra });

test('dedupe: doble toque dentro de la ventana se descarta', () => {
  const out = dedupe([p('1', '2026-11-19 08:00:00'), p('1', '2026-11-19 08:01:10'), p('1', '2026-11-19 08:05:00'), p('2', '2026-11-19 08:00:30')], 2);
  assert.deepEqual(out.map((x) => `${x.pin}@${x.ts.slice(11)}`), ['1@08:00:00', '2@08:00:30', '1@08:05:00']);
});

test('dedupe: no depende del orden de entrada', () => {
  const out = dedupe([p('1', '2026-11-19 17:00:00'), p('1', '2026-11-19 08:00:00')], 2);
  assert.equal(out[0].ts, '2026-11-19 08:00:00');
});

test('dailyReport: jornada con almuerzo (4 marcaciones)', () => {
  const rows = dailyReport([
    p('1', '2026-11-19 07:00:00', { name: 'Juan' }), p('1', '2026-11-19 12:00:00'),
    p('1', '2026-11-19 13:00:00'), p('1', '2026-11-19 17:30:00'),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstIn, '07:00');
  assert.equal(rows[0].lastOut, '17:30');
  assert.equal(rows[0].worked, '09:30');
  assert.equal(rows[0].incomplete, false);
  assert.equal(rows[0].name, 'Juan');
});

test('dailyReport: marcación impar queda como incompleta', () => {
  const [r] = dailyReport([p('5', '2026-11-19 08:00:00'), p('5', '2026-11-19 12:00:00'), p('5', '2026-11-19 13:00:00')]);
  assert.equal(r.incomplete, true);
  assert.equal(r.worked, '04:00');
});

test('dailyReport: separa por día y por empleado', () => {
  const rows = dailyReport([
    p('2', '2026-11-18 08:00:00'), p('2', '2026-11-18 16:00:00'),
    p('2', '2026-11-19 08:00:00'), p('10', '2026-11-19 09:00:00'),
  ]);
  assert.deepEqual(rows.map((r) => `${r.date}/${r.pin}`), ['2026-11-18/2', '2026-11-19/2', '2026-11-19/10']);
  assert.equal(rows[2].lastOut, null);
});

test('fmtHours', () => {
  assert.equal(fmtHours(0), '00:00');
  assert.equal(fmtHours(605), '10:05');
  assert.equal(fmtHours(-3), '00:00');
});

test('toCsv: BOM, separador ; y escape de comillas', () => {
  const s = toCsv([{ a: 'x;y', b: 'di "hola"', c: ['08:00', '17:00'] }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
  assert.ok(s.startsWith('﻿A;B;C\r\n'));
  assert.ok(s.includes('"x;y";"di ""hola""";08:00 17:00'));
});
