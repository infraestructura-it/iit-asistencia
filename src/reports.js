'use strict';
/**
 * Catálogo de reportes. Cada reporte declara sus columnas (el panel deja elegir
 * cuáles mostrar y en qué orden) y una función que arma las filas.
 */
const { dailyReport, absenceReport, summaryReport, toCsv } = require('./attendance');
const { colombianHolidays } = require('./holidays-co');
const { buildXlsx } = require('./xlsx');

const INCIDENT_TYPES = {
  VAC: { label: 'Vacaciones', color: '#2563eb' },
  INC: { label: 'Incapacidad', color: '#dc2626' },
  PER: { label: 'Permiso', color: '#d97706' },
  LIC: { label: 'Licencia', color: '#7c3aed' },
  CAL: { label: 'Calamidad doméstica', color: '#0891b2' },
  COM: { label: 'Comisión de trabajo', color: '#059669' },
};

const VERIFY = { 0: 'Contraseña', 1: 'Huella', 2: 'Tarjeta', 3: 'Contraseña', 4: 'Tarjeta', 15: 'Rostro', 25: 'Palma' };
const STATUS = { 0: 'Entrada', 1: 'Salida', 2: 'Salida descanso', 3: 'Regreso descanso', 4: 'Entrada extra', 5: 'Salida extra' };

const C = (key, label, def = true) => ({ key, label, default: def });

const REPORTS = {
  transactions: {
    title: 'Transacciones',
    description: 'Todas las marcaciones tal como llegaron del equipo',
    columns: [
      C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('date', 'Fecha'), C('time', 'Hora'),
      C('statusLabel', 'Estado'), C('verifyLabel', 'Verificación'), C('device', 'Equipo'), C('source', 'Origen', false), C('note', 'Nota', false),
    ],
  },
  firstlast: {
    title: 'Primera y última marcación',
    description: 'Entrada y salida de cada día',
    columns: [C('date', 'Fecha'), C('day', 'Día'), C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('firstIn', 'Entrada'), C('lastOut', 'Salida'), C('worked', 'Horas')],
  },
  daily: {
    title: 'Asistencia diaria',
    description: 'Tardanzas, salidas tempranas y horas extra según el horario',
    columns: [
      C('date', 'Fecha'), C('day', 'Día'), C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('schedule', 'Horario'),
      C('firstIn', 'Entrada'), C('lastOut', 'Salida'), C('worked', 'Horas'), C('lateMinutes', 'Min. tarde'),
      C('earlyMinutes', 'Min. salida temprana'), C('overtime', 'Horas extra'), C('marks', 'Marcaciones', false), C('status', 'Estado'),
    ],
  },
  summary: {
    title: 'Resumen por empleado',
    description: 'Totales del período (para nómina)',
    columns: [
      C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('days', 'Días trabajados'), C('absences', 'Ausencias'),
      C('incidentDays', 'Días novedad'), C('incidents', 'Detalle novedades', false), C('lateCount', 'Llegadas tarde'), C('lateMinutes', 'Min. tarde'),
      C('earlyCount', 'Salidas tempranas'), C('incomplete', 'Jornadas incompletas'), C('worked', 'Horas trabajadas'), C('overtime', 'Horas extra'),
      C('workedMinutes', 'Minutos trabajados', false), C('overtimeMinutes', 'Minutos extra', false),
    ],
  },
  absences: {
    title: 'Ausencias',
    description: 'Días laborables sin marcación ni novedad registrada',
    columns: [C('date', 'Fecha'), C('day', 'Día'), C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('schedule', 'Horario')],
  },
  incidents: {
    title: 'Novedades',
    description: 'Vacaciones, incapacidades, permisos y licencias',
    columns: [C('pin', 'Código'), C('name', 'Nombre'), C('typeLabel', 'Tipo'), C('from_date', 'Desde'), C('to_date', 'Hasta'), C('days', 'Días'), C('note', 'Observación')],
  },
  late: {
    title: 'Llegadas tarde',
    description: 'Solo los días con tardanza',
    columns: [C('date', 'Fecha'), C('day', 'Día'), C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('schedule', 'Horario'), C('firstIn', 'Entrada'), C('lateMinutes', 'Min. tarde')],
  },
  overtime: {
    title: 'Horas extra',
    description: 'Solo los días con horas extra',
    columns: [C('date', 'Fecha'), C('day', 'Día'), C('pin', 'Código'), C('name', 'Nombre'), C('department', 'Departamento'), C('firstIn', 'Entrada'), C('lastOut', 'Salida'), C('worked', 'Horas'), C('overtime', 'Horas extra')],
  },
};

function holidaysFor(repo, from, to) {
  const years = new Set([from.slice(0, 4), to.slice(0, 4)].map(Number));
  const map = new Map();
  for (const y of years) for (const h of colombianHolidays(y)) map.set(h.date, h.name);
  for (const h of repo.listHolidays(from, to)) map.set(h.date, h.name);
  return [...map.keys()].filter((d) => d >= from && d <= to);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
}

/** Arma un reporte: { title, columns, rows } */
function buildReport(repo, type, { from, to, pin, departmentId, today }, config) {
  const def = REPORTS[type];
  if (!def) return null;
  const schedules = new Map(repo.listSchedules().map((s) => [s.id, s]));
  const deptName = departmentId ? (repo.getDepartment(departmentId) || {}).name : null;
  const inDept = (r) => !deptName || r.department === deptName || r.department_name === deptName;
  const byPin = (r) => !pin || r.pin === pin;

  // Un día extra al final para capturar la salida de madrugada de turnos nocturnos
  const toPlus = new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const all = repo.punches(`${from} 00:00:00`, `${toPlus} 23:59:59`, pin || null).filter(inDept);
  const punches = all.filter((p) => p.ts <= `${to} 23:59:59`);
  const employees = repo.listEmployees().filter(byPin).filter(inDept);
  const incidents = repo.listIncidents(from, to).filter(byPin).filter((i) => employees.some((e) => e.pin === i.pin));
  let rows;

  if (type === 'transactions') {
    rows = punches.map((p) => ({
      ...p,
      name: [p.name, p.last_name].filter(Boolean).join(' '),
      date: p.ts.slice(0, 10), time: p.ts.slice(11, 19),
      statusLabel: STATUS[p.status] || p.status, verifyLabel: p.source === 'manual' ? 'Manual' : VERIFY[p.verify] || p.verify,
      device: p.device_sn === 'MANUAL' ? 'Manual' : (repo.getDevice(p.device_sn) || {}).alias || p.device_sn,
      source: p.source === 'manual' ? 'Manual' : 'Equipo',
    }));
  } else if (type === 'incidents') {
    rows = incidents.map((i) => ({
      ...i, name: [i.name, i.last_name].filter(Boolean).join(' '),
      typeLabel: (INCIDENT_TYPES[i.type] || {}).label || i.type, days: daysBetween(i.from_date, i.to_date),
    }));
  } else {
    const holidays = holidaysFor(repo, from, toPlus);
    const daily = dailyReport(all, { dedupMinutes: config.dedupMinutes, schedules, holidays }).filter((r) => r.date >= from && r.date <= to);
    if (type === 'firstlast' || type === 'daily') rows = daily;
    else if (type === 'late') rows = daily.filter((r) => r.lateMinutes > 0);
    else if (type === 'overtime') rows = daily.filter((r) => r.overtimeMinutes > 0);
    else {
      const absences = absenceReport(employees, daily, { from, to, schedules, today, holidays, incidents });
      rows = type === 'absences' ? absences : summaryReport(employees, daily, absences, { incidents, from, to });
    }
  }
  return { type, title: def.title, from, to, columns: def.columns, rows };
}

/** Selecciona columnas pedidas (en ese orden) o las por defecto */
function pickColumns(def, cols) {
  if (!cols) return def.columns.filter((c) => c.default);
  const wanted = String(cols).split(',').map((s) => s.trim());
  const chosen = wanted.map((k) => def.columns.find((c) => c.key === k)).filter(Boolean);
  return chosen.length ? chosen : def.columns.filter((c) => c.default);
}

function exportReport(report, columns, format) {
  const base = `${report.type}_${report.from}_${report.to}`;
  if (format === 'xlsx') {
    return {
      filename: `${base}.xlsx`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: buildXlsx({ title: `${report.title} — ${report.from} a ${report.to}`, sheetName: report.title, columns, rows: report.rows }),
    };
  }
  if (format === 'txt') {
    // Texto plano separado por tabulaciones (formato típico de importación en nómina)
    const val = (v) => (v == null ? '' : Array.isArray(v) ? v.join(' ') : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v).replace(/[\t\r\n]/g, ' '));
    const lines = [columns.map((c) => c.label).join('\t'), ...report.rows.map((r) => columns.map((c) => val(r[c.key])).join('\t'))];
    return { filename: `${base}.txt`, type: 'text/plain; charset=utf-8', content: lines.join('\r\n') + '\r\n' };
  }
  return { filename: `${base}.csv`, type: 'text/csv; charset=utf-8', content: toCsv(report.rows, columns) };
}

module.exports = { REPORTS, INCIDENT_TYPES, buildReport, pickColumns, exportReport, holidaysFor, STATUS, VERIFY };
