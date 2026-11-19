'use strict';
/** Una BD creada con la v0.1 se actualiza sin perder datos */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');

test('migración desde v0.1', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iit-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE devices (sn TEXT PRIMARY KEY, alias TEXT, ip TEXT, firmware TEXT, att_stamp TEXT DEFAULT 'None', oper_stamp TEXT DEFAULT 'None',
      user_count INTEGER, punch_count INTEGER, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE employees (pin TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', card TEXT, privilege INTEGER DEFAULT 0, department TEXT,
      active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE punches (id INTEGER PRIMARY KEY AUTOINCREMENT, device_sn TEXT NOT NULL, pin TEXT NOT NULL, ts TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0, verify INTEGER NOT NULL DEFAULT 0, workcode TEXT, received_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (device_sn, pin, ts));
    INSERT INTO devices (sn, alias) VALUES ('OLD1', 'Viejo');
    INSERT INTO employees (pin, name) VALUES ('1', 'Juan');
    INSERT INTO punches (device_sn, pin, ts) VALUES ('OLD1', '1', '2026-11-18 08:00:00');
  `);
  old.close();

  const repo = openDb(file);
  assert.equal(repo.getDevice('OLD1').alias, 'Viejo');
  assert.equal(repo.getDevice('OLD1').delay, 10);
  assert.equal(repo.getEmployee('1').name, 'Juan');
  assert.equal(repo.getEmployee('1').last_name, '');
  const [p] = repo.punches('2026-11-18 00:00:00', '2026-11-18 23:59:59');
  assert.equal(p.source, 'device');
  assert.equal(repo.listSchedules().length, 1);
  repo.close();
  // Abrir de nuevo no falla (migración idempotente)
  openDb(file).close();
});
