'use strict';
/**
 * Cálculo de asistencia. Funciones puras sobre marcaciones ordenadas.
 * Las horas del equipo son locales "YYYY-MM-DD HH:MM:SS" sin zona: se tratan
 * como hora de pared (UTC interno) para no sufrir corrimientos de zona horaria.
 */

function toMs(ts) {
  const [d, t] = ts.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h, mi, s);
}

/** Elimina marcaciones del mismo empleado dentro de `minutes` (doble toque, varios equipos) */
function dedupe(punches, minutes = 2) {
  const win = minutes * 60000;
  const last = new Map();
  const out = [];
  for (const p of [...punches].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))) {
    const t = toMs(p.ts);
    const prev = last.get(p.pin);
    if (prev != null && t - prev < win) continue;
    last.set(p.pin, t);
    out.push(p);
  }
  return out;
}

/**
 * Reporte diario: por empleado y fecha → entrada, salida, horas trabajadas.
 * Las marcaciones se emparejan en orden (1ª-2ª, 3ª-4ª…), lo que soporta
 * almuerzos sin depender de que el empleado elija bien el estado en el equipo.
 */
function dailyReport(punches, { dedupMinutes = 2 } = {}) {
  const groups = new Map();
  for (const p of dedupe(punches, dedupMinutes)) {
    const date = p.ts.slice(0, 10);
    const key = `${p.pin}|${date}`;
    if (!groups.has(key)) groups.set(key, { pin: p.pin, name: p.name || '', department: p.department || '', date, marks: [] });
    groups.get(key).marks.push(p.ts.slice(11, 16));
  }

  const rows = [];
  for (const g of groups.values()) {
    let workedMin = 0;
    for (let i = 0; i + 1 < g.marks.length; i += 2) {
      workedMin += (toMs(`${g.date} ${g.marks[i + 1]}:00`) - toMs(`${g.date} ${g.marks[i]}:00`)) / 60000;
    }
    rows.push({
      pin: g.pin,
      name: g.name,
      department: g.department,
      date: g.date,
      firstIn: g.marks[0],
      lastOut: g.marks.length > 1 ? g.marks[g.marks.length - 1] : null,
      marks: g.marks,
      workedMinutes: Math.round(workedMin),
      worked: fmtHours(workedMin),
      incomplete: g.marks.length % 2 === 1,
    });
  }
  return rows.sort((a, b) => (a.date + a.pin).localeCompare(b.date + b.pin, 'es', { numeric: true }));
}

function fmtHours(min) {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** CSV con ; (Excel en español lo abre bien) y BOM UTF-8 para tildes */
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

module.exports = { dedupe, dailyReport, fmtHours, toCsv, toMs };
