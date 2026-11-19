'use strict';
/**
 * Cálculo de asistencia. Funciones puras (sin BD) para poder probarlas.
 * Las horas del equipo son locales "YYYY-MM-DD HH:MM:SS" sin zona: se tratan
 * como hora de pared (UTC interno) para no sufrir corrimientos de zona horaria.
 */

function toMs(ts) {
  const [d, t] = ts.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h, mi, s || 0);
}

/** "HH:MM" -> minutos del día */
function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function fmtHours(min) {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Días ISO entre from y to inclusive */
function eachDate(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 1 = lunes … 7 = domingo */
function weekday(date) {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

const DAY_NAMES = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function isWorkday(schedule, date) {
  if (!schedule) return false;
  return String(schedule.workdays || '').split(',').map(Number).includes(weekday(date));
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

function fullName(p) {
  return [p.name, p.last_name].filter(Boolean).join(' ');
}

/**
 * Reporte diario: por empleado y fecha.
 * - Las marcaciones se emparejan en orden (1ª-2ª, 3ª-4ª…).
 * - Si solo hay 2 marcaciones y el horario tiene descanso, se descuenta el descanso
 *   (el empleado no marcó almuerzo) cuando la jornada supera 5 horas.
 * - Con horario: tardanza (si pasa la tolerancia), salida temprana y horas extra.
 * @param schedules Map<id, schedule>
 */
function isNight(s) {
  return s && toMin(s.end_time) < toMin(s.start_time);
}

function prevDate(date) {
  return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

function dailyReport(punches, { dedupMinutes = 2, schedules = new Map(), holidays = [] } = {}) {
  const hol = new Set(holidays);
  const groups = new Map();
  for (const p of dedupe(punches, dedupMinutes)) {
    const schedule = p.schedule_id != null ? schedules.get(Number(p.schedule_id)) || null : null;
    let date = p.ts.slice(0, 10);
    let min = toMin(p.ts.slice(11, 16));
    // Turno nocturno: marcaciones de madrugada (hasta 4 h después de la salida) son del día anterior
    if (isNight(schedule) && min <= toMin(schedule.end_time) + 240) {
      date = prevDate(date);
      min += 1440;
    }
    const key = `${p.pin}|${date}`;
    if (!groups.has(key)) {
      groups.set(key, { pin: p.pin, name: fullName(p), department: p.department || '', date, schedule, marks: [] });
    }
    groups.get(key).marks.push({ hhmm: p.ts.slice(11, 16), min });
  }

  const rows = [];
  for (const g of groups.values()) {
    g.marks.sort((a, b) => a.min - b.min);
    const m = g.marks.map((x) => x.min);
    let workedMin = 0;
    for (let i = 0; i + 1 < m.length; i += 2) workedMin += m[i + 1] - m[i];
    const s = g.schedule;
    if (s && m.length === 2 && s.break_min > 0 && workedMin > 300) workedMin -= s.break_min;

    const first = m[0];
    const last = m.length > 1 ? m[m.length - 1] : null;
    let lateMin = 0, earlyMin = 0, overtimeMin = 0, expectedMin = 0;
    const isHoliday = hol.has(g.date);
    if (s && isHoliday) {
      // Festivo: no hay tardanza ni salida temprana; todo lo trabajado es extra (recargo festivo)
      overtimeMin = last != null ? workedMin : 0;
    } else if (s) {
      const start = toMin(s.start_time);
      const end = toMin(s.end_time) + (isNight(s) ? 1440 : 0);
      const late = first - start;
      lateMin = late > s.tolerance_min ? late : 0;
      if (last != null) earlyMin = Math.max(0, end - last);
      if (isWorkday(s, g.date)) expectedMin = end - start - s.break_min;
      overtimeMin = last != null ? Math.max(0, workedMin - expectedMin) : 0;
    }
    const odd = m.length % 2 === 1;
    rows.push({
      pin: g.pin,
      name: g.name,
      department: g.department,
      date: g.date,
      day: DAY_NAMES[weekday(g.date)],
      schedule: s ? s.name : '',
      firstIn: g.marks[0].hhmm,
      lastOut: last != null ? g.marks[g.marks.length - 1].hhmm : null,
      marks: g.marks.map((x) => x.hhmm),
      workedMinutes: Math.round(workedMin),
      worked: fmtHours(workedMin),
      lateMinutes: lateMin,
      earlyMinutes: earlyMin,
      overtimeMinutes: Math.round(overtimeMin),
      overtime: fmtHours(overtimeMin),
      incomplete: odd,
      holiday: isHoliday,
      status: odd ? 'Incompleta' : isHoliday ? 'Festivo' : lateMin ? 'Tarde' : 'Normal',
    });
  }
  return rows.sort((a, b) => (a.date + a.pin).localeCompare(b.date + b.pin, 'es', { numeric: true }));
}

/**
 * Ausencias: días laborables del horario sin ninguna marcación.
 * No cuenta días futuros (`today`), anteriores al ingreso, ni festivos.
 */
function incidentIndex(incidents = []) {
  const idx = new Map();
  for (const i of incidents) {
    for (const d of eachDate(i.from_date, i.to_date)) idx.set(`${i.pin}|${d}`, i);
  }
  return idx;
}

function absenceReport(employees, daily, { from, to, schedules = new Map(), today, holidays = [], incidents = [] }) {
  const worked = new Set(daily.map((r) => `${r.pin}|${r.date}`));
  const inc = incidentIndex(incidents);
  const hol = new Set(holidays);
  const out = [];
  for (const e of employees) {
    if (!e.active) continue;
    const s = schedules.get(Number(e.effective_schedule_id));
    if (!s) continue;
    for (const date of eachDate(from, to)) {
      if (today && date > today) break;
      if (e.hire_date && date < e.hire_date) continue;
      if (hol.has(date) || !isWorkday(s, date) || worked.has(`${e.pin}|${date}`) || inc.has(`${e.pin}|${date}`)) continue;
      out.push({ pin: e.pin, name: fullName(e), department: e.department_name || '', date, day: DAY_NAMES[weekday(date)], schedule: s.name });
    }
  }
  return out.sort((a, b) => (a.date + a.pin).localeCompare(b.date + b.pin, 'es', { numeric: true }));
}

/** Resumen por empleado para el período */
function summaryReport(employees, daily, absences, { incidents = [], from, to } = {}) {
  const by = new Map();
  const get = (pin, name, department) => {
    if (!by.has(pin)) {
      by.set(pin, { pin, name, department, days: 0, absences: 0, incidentDays: 0, incidentTypes: {}, lateCount: 0, lateMinutes: 0, earlyCount: 0, incomplete: 0, workedMinutes: 0, overtimeMinutes: 0 });
    }
    return by.get(pin);
  };
  for (const e of employees) if (e.active) get(e.pin, fullName(e), e.department_name || '');
  for (const r of daily) {
    const s = get(r.pin, r.name, r.department);
    s.days++;
    if (r.lateMinutes) { s.lateCount++; s.lateMinutes += r.lateMinutes; }
    if (r.earlyMinutes) s.earlyCount++;
    if (r.incomplete) s.incomplete++;
    s.workedMinutes += r.workedMinutes;
    s.overtimeMinutes += r.overtimeMinutes;
  }
  for (const a of absences) get(a.pin, a.name, a.department).absences++;
  for (const i of incidents) {
    if (!by.has(i.pin)) continue;
    const s = by.get(i.pin);
    const days = eachDate(i.from_date < (from || i.from_date) ? from : i.from_date, i.to_date > (to || i.to_date) ? to : i.to_date).length;
    s.incidentDays += days;
    s.incidentTypes[i.type] = (s.incidentTypes[i.type] || 0) + days;
  }
  return [...by.values()]
    .map((s) => ({
      ...s, worked: fmtHours(s.workedMinutes), overtime: fmtHours(s.overtimeMinutes),
      incidents: Object.entries(s.incidentTypes).map(([t, n]) => `${t}:${n}`).join(' '),
    }))
    .sort((a, b) => a.pin.localeCompare(b.pin, 'es', { numeric: true }));
}

/** CSV con ; (Excel en español lo abre bien) y BOM UTF-8 para tildes */
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

module.exports = { dedupe, dailyReport, absenceReport, incidentIndex, isNight, summaryReport, fmtHours, toCsv, toMs, toMin, eachDate, weekday, isWorkday };
