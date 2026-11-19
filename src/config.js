'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Carga mínima de .env (sin dependencias)
function loadEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

module.exports = {
  port: Number(process.env.PORT || 8081),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'asistencia.db'),
  deviceTz: Number(process.env.DEVICE_TZ ?? -5),
  dedupMinutes: Number(process.env.DEDUP_MINUTES ?? 2),
  offlineAfterMin: Number(process.env.OFFLINE_AFTER_MIN ?? 3),
  apiToken: process.env.API_TOKEN || '',
};
