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
  last_seen    TEXT NOT NULL DEFAULT (datetime('now'))
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

-- La restricción UNIQUE es la defensa principal contra duplicados:
-- el equipo puede reenviar el mismo lote las veces que quiera.
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
  state       TEXT NOT NULL DEFAULT 'pending', -- pending | sent | ok | error
  return_code INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT,
  done_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_commands_dev_state ON commands (device_sn, state);

-- Bitácora cruda: todo lo que llega del equipo, para auditoría y depuración
CREATE TABLE IF NOT EXISTS raw_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_sn  TEXT,
  endpoint   TEXT,
  query      TEXT,
  body       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const st = {
    touchDevice: db.prepare(`
      INSERT INTO devices (sn, ip) VALUES (?, ?)
      ON CONFLICT(sn) DO UPDATE SET last_seen = datetime('now'), ip = excluded.ip`),
    getDevice: db.prepare('SELECT * FROM devices WHERE sn = ?'),
    listDevices: db.prepare('SELECT * FROM devices ORDER BY alias, sn'),
    setStamp: db.prepare('UPDATE devices SET att_stamp = COALESCE(?, att_stamp), oper_stamp = COALESCE(?, oper_stamp) WHERE sn = ?'),
    setInfo: db.prepare('UPDATE devices SET firmware = COALESCE(?, firmware), user_count = COALESCE(?, user_count), punch_count = COALESCE(?, punch_count) WHERE sn = ?'),
    setAlias: db.prepare('UPDATE devices SET alias = ? WHERE sn = ?'),
    insertPunch: db.prepare(`
      INSERT OR IGNORE INTO punches (device_sn, pin, ts, status, verify, workcode)
      VALUES (?, ?, ?, ?, ?, ?)`),
    ensureEmployee: db.prepare('INSERT OR IGNORE INTO employees (pin) VALUES (?)'),
    upsertEmployee: db.prepare(`
      INSERT INTO employees (pin, name, card, privilege) VALUES (?, ?, ?, ?)
      ON CONFLICT(pin) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE employees.name END,
        card = COALESCE(excluded.card, employees.card),
        privilege = excluded.privilege,
        updated_at = datetime('now')`),
    updateEmployee: db.prepare(`
      UPDATE employees SET name = COALESCE(?, name), department = COALESCE(?, department),
        active = COALESCE(?, active), updated_at = datetime('now') WHERE pin = ?`),
    listEmployees: db.prepare('SELECT * FROM employees ORDER BY CAST(pin AS INTEGER), pin'),
    getEmployee: db.prepare('SELECT * FROM employees WHERE pin = ?'),
    punchesRange: db.prepare(`
      SELECT p.*, e.name, e.department FROM punches p
      LEFT JOIN employees e ON e.pin = p.pin
      WHERE p.ts >= ? AND p.ts <= ? ORDER BY p.ts`),
    punchesRangePin: db.prepare(`
      SELECT p.*, e.name, e.department FROM punches p
      LEFT JOIN employees e ON e.pin = p.pin
      WHERE p.ts >= ? AND p.ts <= ? AND p.pin = ? ORDER BY p.ts`),
    queueCmd: db.prepare('INSERT INTO commands (device_sn, command) VALUES (?, ?)'),
    pendingCmds: db.prepare(`SELECT * FROM commands WHERE device_sn = ? AND state = 'pending' ORDER BY id LIMIT 20`),
    markSent: db.prepare(`UPDATE commands SET state = 'sent', sent_at = datetime('now') WHERE id = ?`),
    markDone: db.prepare(`UPDATE commands SET state = ?, return_code = ?, done_at = datetime('now') WHERE id = ? AND device_sn = ?`),
    listCmds: db.prepare('SELECT * FROM commands WHERE device_sn = ? ORDER BY id DESC LIMIT 100'),
    requeueStale: db.prepare(`UPDATE commands SET state = 'pending' WHERE state = 'sent' AND sent_at < datetime('now', ?)`),
    raw: db.prepare('INSERT INTO raw_log (device_sn, endpoint, query, body) VALUES (?, ?, ?, ?)'),
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

  return {
    db,
    touchDevice: (sn, ip) => st.touchDevice.run(sn, ip || null),
    getDevice: (sn) => st.getDevice.get(sn),
    listDevices: () => st.listDevices.all(),
    setStamps: (sn, att, oper) => st.setStamp.run(att ?? null, oper ?? null, sn),
    setDeviceInfo: (sn, { firmware, userCount, punchCount }) =>
      st.setInfo.run(firmware ?? null, userCount ?? null, punchCount ?? null, sn),
    setAlias: (sn, alias) => st.setAlias.run(alias, sn),

    /** Inserta un lote; devuelve cuántas eran nuevas (las repetidas se ignoran) */
    insertPunches: (sn, punches) =>
      tx(() => {
        let inserted = 0;
        for (const p of punches) {
          const r = st.insertPunch.run(sn, p.pin, p.ts, p.status, p.verify, p.workcode);
          if (r.changes) {
            inserted++;
            st.ensureEmployee.run(p.pin);
          }
        }
        return inserted;
      }),

    upsertEmployees: (users) =>
      tx(() => {
        for (const u of users) st.upsertEmployee.run(u.pin, u.name || '', u.card || null, u.privilege || 0);
        return users.length;
      }),
    updateEmployee: (pin, { name, department, active }) =>
      st.updateEmployee.run(name ?? null, department ?? null, active == null ? null : active ? 1 : 0, pin),
    listEmployees: () => st.listEmployees.all(),
    getEmployee: (pin) => st.getEmployee.get(pin),

    punches: (from, to, pin) => (pin ? st.punchesRangePin.all(from, to, pin) : st.punchesRange.all(from, to)),

    queueCommand: (sn, command) => Number(st.queueCmd.run(sn, command).lastInsertRowid),
    /** Toma comandos pendientes y los marca como enviados (reintento si no responde en 10 min) */
    takeCommands: (sn) =>
      tx(() => {
        st.requeueStale.run('-10 minutes');
        const cmds = st.pendingCmds.all(sn);
        for (const c of cmds) st.markSent.run(c.id);
        return cmds;
      }),
    completeCommand: (sn, id, ret) => st.markDone.run(ret === 0 ? 'ok' : 'error', ret, id, sn),
    listCommands: (sn) => st.listCmds.all(sn),

    raw: (sn, endpoint, query, body) => st.raw.run(sn || null, endpoint, query, body ? String(body).slice(0, 20000) : null),
    pruneRaw: () => st.pruneRaw.run(),
    close: () => db.close(),
  };
}

module.exports = { openDb };
