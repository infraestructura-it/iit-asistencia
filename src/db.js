'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  sn           TEXT PRIMARY KEY,
  alias        TEXT,
  ip           TEXT,
  firmware     TEXT,
  att_stamp    TEXT DEFAULT 'None',
  oper_stamp   TEXT DEFAULT 'None',
  user_count   INTEGER,
  punch_count  INTEGER,
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen    TEXT
);

CREATE TABLE IF NOT EXISTS areas (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS schedules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  start_time    TEXT NOT NULL DEFAULT '08:00',
  end_time      TEXT NOT NULL DEFAULT '17:00',
  tolerance_min INTEGER NOT NULL DEFAULT 5,
  break_min     INTEGER NOT NULL DEFAULT 60,
  workdays      TEXT NOT NULL DEFAULT '1,2,3,4,5'
);

CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT,
  name        TEXT NOT NULL UNIQUE,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employees (
  pin        TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  card       TEXT,
  privilege  INTEGER DEFAULT 0,
  department TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS punches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_sn  TEXT NOT NULL,
  pin        TEXT NOT NULL,
  ts         TEXT NOT NULL,
  status     INTEGER NOT NULL DEFAULT 0,
  verify     INTEGER NOT NULL DEFAULT 0,
  workcode   TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (device_sn, pin, ts)
);
CREATE INDEX IF NOT EXISTS ix_punches_ts ON punches (ts);
CREATE INDEX IF NOT EXISTS ix_punches_pin_ts ON punches (pin, ts);

CREATE TABLE IF NOT EXISTS commands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_sn   TEXT NOT NULL,
  command     TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending',
  return_code INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT,
  done_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_commands_dev_state ON commands (device_sn, state);

CREATE TABLE IF NOT EXISTS incidents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pin        TEXT NOT NULL,
  type       TEXT NOT NULL,
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_incidents_dates ON incidents (from_date, to_date);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_sn  TEXT,
  endpoint   TEXT,
  query      TEXT,
  body       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Columnas agregadas después de la v0.1 — se añaden sin borrar datos existentes
const MIGRATIONS = {
  devices: {
    area: 'TEXT',
    timezone: 'INTEGER NOT NULL DEFAULT -5',
    delay: 'INTEGER NOT NULL DEFAULT 10',
    trans_interval: 'INTEGER NOT NULL DEFAULT 1',
    trans_times: "TEXT NOT NULL DEFAULT '00:00;14:05'",
    attendance: 'INTEGER NOT NULL DEFAULT 1',
  },
  employees: {
    last_name: "TEXT NOT NULL DEFAULT ''",
    department_id: 'INTEGER REFERENCES departments(id) ON DELETE SET NULL',
    position: 'TEXT',
    hire_date: 'TEXT',
    schedule_id: 'INTEGER REFERENCES schedules(id) ON DELETE SET NULL',
  },
  punches: {
    source: "TEXT NOT NULL DEFAULT 'device'",
    note: 'TEXT',
  },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
  const n = db.prepare('SELECT COUNT(*) n FROM schedules').get().n;
  if (!n) db.prepare("INSERT INTO schedules (name, start_time, end_time) VALUES ('Jornada general', '08:00', '17:00')").run();
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return createRepo(db);
}

const EMP_SELECT = `
  SELECT e.*, d.name AS department_name,
         COALESCE(e.schedule_id, d.schedule_id) AS effective_schedule_id
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

const PUNCH_SELECT = `
  SELECT p.*, e.name, e.last_name, d.name AS department,
         COALESCE(e.schedule_id, d.schedule_id) AS schedule_id
  FROM punches p
  LEFT JOIN employees e ON e.pin = p.pin
  LEFT JOIN departments d ON d.id = e.department_id`;

function createRepo(db) {
  const st = {
    touchDevice: db.prepare(`
      INSERT INTO devices (sn, ip, last_seen) VALUES (?, ?, datetime('now'))
      ON CONFLICT(sn) DO UPDATE SET last_seen = datetime('now'), ip = COALESCE(excluded.ip, devices.ip)`),
    getDevice: db.prepare('SELECT * FROM devices WHERE sn = ?'),
    listDevices: db.prepare('SELECT * FROM devices ORDER BY alias, sn'),
    createDevice: db.prepare(`
      INSERT INTO devices (sn, alias, ip, area, timezone, delay, trans_interval, trans_times, attendance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateDevice: db.prepare(`
      UPDATE devices SET alias = ?, ip = ?, area = ?, timezone = ?, delay = ?, trans_interval = ?,
        trans_times = ?, attendance = ? WHERE sn = ?`),
    deleteDevice: db.prepare('DELETE FROM devices WHERE sn = ?'),
    setStamp: db.prepare('UPDATE devices SET att_stamp = COALESCE(?, att_stamp), oper_stamp = COALESCE(?, oper_stamp) WHERE sn = ?'),
    resetStamps: db.prepare("UPDATE devices SET att_stamp = 'None', oper_stamp = 'None' WHERE sn = ?"),
    setInfo: db.prepare('UPDATE devices SET firmware = COALESCE(?, firmware), user_count = COALESCE(?, user_count), punch_count = COALESCE(?, punch_count) WHERE sn = ?'),
    setAlias: db.prepare('UPDATE devices SET alias = ? WHERE sn = ?'),

    listAreas: db.prepare('SELECT * FROM areas ORDER BY name'),
    createArea: db.prepare('INSERT INTO areas (name) VALUES (?)'),
    deleteArea: db.prepare('DELETE FROM areas WHERE id = ?'),

    listSchedules: db.prepare('SELECT * FROM schedules ORDER BY name'),
    getSchedule: db.prepare('SELECT * FROM schedules WHERE id = ?'),
    createSchedule: db.prepare('INSERT INTO schedules (name, start_time, end_time, tolerance_min, break_min, workdays) VALUES (?, ?, ?, ?, ?, ?)'),
    updateSchedule: db.prepare('UPDATE schedules SET name = ?, start_time = ?, end_time = ?, tolerance_min = ?, break_min = ?, workdays = ? WHERE id = ?'),
    deleteSchedule: db.prepare('DELETE FROM schedules WHERE id = ?'),

    listDepartments: db.prepare(`
      SELECT d.*, s.name AS schedule_name, (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id) AS employees
      FROM departments d LEFT JOIN schedules s ON s.id = d.schedule_id ORDER BY d.name`),
    getDepartment: db.prepare('SELECT * FROM departments WHERE id = ?'),
    createDepartment: db.prepare('INSERT INTO departments (code, name, schedule_id) VALUES (?, ?, ?)'),
    updateDepartment: db.prepare('UPDATE departments SET code = ?, name = ?, schedule_id = ? WHERE id = ?'),
    deleteDepartment: db.prepare('DELETE FROM departments WHERE id = ?'),

    insertPunch: db.prepare(`
      INSERT OR IGNORE INTO punches (device_sn, pin, ts, status, verify, workcode, source, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    deletePunch: db.prepare("DELETE FROM punches WHERE id = ? AND source = 'manual'"),
    ensureEmployee: db.prepare('INSERT OR IGNORE INTO employees (pin) VALUES (?)'),
    upsertEmployee: db.prepare(`
      INSERT INTO employees (pin, name, card, privilege) VALUES (?, ?, ?, ?)
      ON CONFLICT(pin) DO UPDATE SET
        name = CASE WHEN employees.name = '' THEN excluded.name ELSE employees.name END,
        card = COALESCE(excluded.card, employees.card),
        privilege = excluded.privilege,
        updated_at = datetime('now')`),
    createEmployee: db.prepare(`
      INSERT INTO employees (pin, name, last_name, card, department_id, position, hire_date, schedule_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateEmployee: db.prepare(`
      UPDATE employees SET name = ?, last_name = ?, card = ?, department_id = ?, position = ?, hire_date = ?,
        schedule_id = ?, active = ?, updated_at = datetime('now') WHERE pin = ?`),
    deleteEmployee: db.prepare('DELETE FROM employees WHERE pin = ?'),
    listEmployees: db.prepare(`${EMP_SELECT} ORDER BY CAST(e.pin AS INTEGER), e.pin`),
    getEmployee: db.prepare(`${EMP_SELECT} WHERE e.pin = ?`),
    punchesRange: db.prepare(`${PUNCH_SELECT} WHERE p.ts >= ? AND p.ts <= ? ORDER BY p.ts`),
    punchesRangePin: db.prepare(`${PUNCH_SELECT} WHERE p.ts >= ? AND p.ts <= ? AND p.pin = ? ORDER BY p.ts`),

    listIncidents: db.prepare(`
      SELECT i.*, e.name, e.last_name FROM incidents i LEFT JOIN employees e ON e.pin = i.pin
      WHERE i.to_date >= ? AND i.from_date <= ? ORDER BY i.from_date DESC`),
    createIncident: db.prepare('INSERT INTO incidents (pin, type, from_date, to_date, note) VALUES (?, ?, ?, ?, ?)'),
    deleteIncident: db.prepare('DELETE FROM incidents WHERE id = ?'),
    listHolidays: db.prepare('SELECT * FROM holidays WHERE date >= ? AND date <= ? ORDER BY date'),
    upsertHoliday: db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name'),
    deleteHoliday: db.prepare('DELETE FROM holidays WHERE date = ?'),

    queueCmd: db.prepare('INSERT INTO commands (device_sn, command) VALUES (?, ?)'),
    pendingCmds: db.prepare(`SELECT * FROM commands WHERE device_sn = ? AND state = 'pending' ORDER BY id LIMIT 20`),
    markSent: db.prepare(`UPDATE commands SET state = 'sent', sent_at = datetime('now') WHERE id = ?`),
    markDone: db.prepare(`UPDATE commands SET state = ?, return_code = ?, done_at = datetime('now') WHERE id = ? AND device_sn = ?`),
    listCmds: db.prepare('SELECT * FROM commands WHERE device_sn = ? ORDER BY id DESC LIMIT 200'),
    listAllCmds: db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT 200'),
    requeueStale: db.prepare(`UPDATE commands SET state = 'pending' WHERE state = 'sent' AND sent_at < datetime('now', ?)`),
    raw: db.prepare('INSERT INTO raw_log (device_sn, endpoint, query, body) VALUES (?, ?, ?, ?)'),
    listRaw: db.prepare('SELECT id, device_sn, endpoint, query, substr(body, 1, 300) AS body, created_at FROM raw_log ORDER BY id DESC LIMIT 300'),
    pruneRaw: db.prepare(`DELETE FROM raw_log WHERE created_at < datetime('now', '-30 days')`),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const nn = (v) => (v === '' || v === undefined ? null : v);
  const dev = (d) => [
    nn(d.alias), nn(d.ip), nn(d.area), Number(d.timezone ?? -5), Number(d.delay ?? 10),
    Number(d.trans_interval ?? 1), d.trans_times || '00:00;14:05', d.attendance === false || d.attendance === 0 ? 0 : 1,
  ];
  const emp = (e) => [
    e.name || '', e.last_name || '', nn(e.card), nn(e.department_id), nn(e.position), nn(e.hire_date),
    nn(e.schedule_id), e.active === false || e.active === 0 ? 0 : 1,
  ];
  const sch = (s) => [s.name, s.start_time, s.end_time, Number(s.tolerance_min ?? 5), Number(s.break_min ?? 60), s.workdays || '1,2,3,4,5'];

  return {
    db,
    tx,
    // ── Equipos
    touchDevice: (sn, ip) => st.touchDevice.run(sn, ip || null),
    getDevice: (sn) => st.getDevice.get(sn),
    listDevices: () => st.listDevices.all(),
    createDevice: (d) => st.createDevice.run(d.sn, ...dev(d)),
    updateDevice: (sn, d) => st.updateDevice.run(...dev(d), sn),
    deleteDevice: (sn) => st.deleteDevice.run(sn).changes,
    setStamps: (sn, att, oper) => st.setStamp.run(att ?? null, oper ?? null, sn),
    resetStamps: (sn) => st.resetStamps.run(sn),
    setDeviceInfo: (sn, { firmware, userCount, punchCount }) =>
      st.setInfo.run(firmware ?? null, userCount ?? null, punchCount ?? null, sn),
    setAlias: (sn, alias) => st.setAlias.run(alias, sn),

    // ── Áreas
    listAreas: () => st.listAreas.all(),
    createArea: (name) => Number(st.createArea.run(name).lastInsertRowid),
    deleteArea: (id) => st.deleteArea.run(id).changes,

    // ── Horarios
    listSchedules: () => st.listSchedules.all(),
    getSchedule: (id) => st.getSchedule.get(id),
    createSchedule: (s) => Number(st.createSchedule.run(...sch(s)).lastInsertRowid),
    updateSchedule: (id, s) => st.updateSchedule.run(...sch(s), id).changes,
    deleteSchedule: (id) => st.deleteSchedule.run(id).changes,

    // ── Departamentos
    listDepartments: () => st.listDepartments.all(),
    getDepartment: (id) => st.getDepartment.get(id),
    createDepartment: (d) => Number(st.createDepartment.run(nn(d.code), d.name, nn(d.schedule_id)).lastInsertRowid),
    updateDepartment: (id, d) => st.updateDepartment.run(nn(d.code), d.name, nn(d.schedule_id), id).changes,
    deleteDepartment: (id) => st.deleteDepartment.run(id).changes,

    // ── Marcaciones
    /** Inserta un lote; devuelve cuántas eran nuevas (las repetidas se ignoran) */
    insertPunches: (sn, punches) =>
      tx(() => {
        let inserted = 0;
        for (const p of punches) {
          const r = st.insertPunch.run(sn, p.pin, p.ts, p.status ?? 0, p.verify ?? 0, p.workcode ?? null, 'device', null);
          if (r.changes) {
            inserted++;
            st.ensureEmployee.run(p.pin);
          }
        }
        return inserted;
      }),
    addManualPunch: ({ pin, ts, status = 0, note }) =>
      Number(st.insertPunch.run('MANUAL', pin, ts, status, 0, null, 'manual', nn(note)).lastInsertRowid),
    deleteManualPunch: (id) => st.deletePunch.run(id).changes,
    punches: (from, to, pin) => (pin ? st.punchesRangePin.all(from, to, pin) : st.punchesRange.all(from, to)),

    // ── Empleados
    upsertEmployees: (users) =>
      tx(() => {
        for (const u of users) st.upsertEmployee.run(u.pin, u.name || '', u.card || null, u.privilege || 0);
        return users.length;
      }),
    createEmployee: (e) => st.createEmployee.run(e.pin, ...emp(e)),
    updateEmployee: (pin, e) => st.updateEmployee.run(...emp(e), pin).changes,
    deleteEmployee: (pin) => st.deleteEmployee.run(pin).changes,
    listEmployees: () => st.listEmployees.all(),
    getEmployee: (pin) => st.getEmployee.get(pin),

    // ── Novedades y festivos
    listIncidents: (from, to) => st.listIncidents.all(from, to),
    createIncident: (i) => Number(st.createIncident.run(i.pin, i.type, i.from_date, i.to_date, nn(i.note)).lastInsertRowid),
    deleteIncident: (id) => st.deleteIncident.run(id).changes,
    listHolidays: (from = '0000-01-01', to = '9999-12-31') => st.listHolidays.all(from, to),
    upsertHoliday: (date, name) => st.upsertHoliday.run(date, name),
    deleteHoliday: (date) => st.deleteHoliday.run(date).changes,

    // ── Comandos y bitácora
    queueCommand: (sn, command) => Number(st.queueCmd.run(sn, command).lastInsertRowid),
    takeCommands: (sn) =>
      tx(() => {
        st.requeueStale.run('-10 minutes');
        const cmds = st.pendingCmds.all(sn);
        for (const c of cmds) st.markSent.run(c.id);
        return cmds;
      }),
    completeCommand: (sn, id, ret) => st.markDone.run(ret === 0 ? 'ok' : 'error', ret, id, sn),
    listCommands: (sn) => (sn ? st.listCmds.all(sn) : st.listAllCmds.all()),

    raw: (sn, endpoint, query, body) => st.raw.run(sn || null, endpoint, query, body ? String(body).slice(0, 20000) : null),
    listRaw: () => st.listRaw.all(),
    pruneRaw: () => st.pruneRaw.run(),
    close: () => db.close(),
  };
}

module.exports = { openDb };
