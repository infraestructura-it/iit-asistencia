'use strict';
const config = require('./config');
const { openDb } = require('./db');
const fs = require('node:fs');
const https = require('node:https');
const { createServer, createRequestHandler } = require('./app');

const repo = openDb(config.dbPath);
const server = createServer({ repo, config });

// Si PORT no está fijado (.env o variable de entorno) se prueban los siguientes puertos libres.
// Si está fijado, se respeta: el biométrico necesita un puerto estable.
const MAX_TRIES = config.portExplicit ? 1 : 20;
let port = config.port;
let tries = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && ++tries < MAX_TRIES) {
    console.log(`  Puerto ${port} ocupado, probando ${port + 1}…`);
    port += 1;
    return server.listen(port, '0.0.0.0');

// HTTPS opcional: HTTPS_PORT + TLS_CERT + TLS_KEY en .env
if (config.httpsPort && config.tlsCert && config.tlsKey) {
  try {
    const tls = https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }, createRequestHandler({ repo, config }));
    tls.on('error', (err) => console.error(`✖ HTTPS en puerto ${config.httpsPort}: ${err.message}`));
    tls.listen(config.httpsPort, '0.0.0.0', () => console.log(`  HTTPS:      puerto ${config.httpsPort} (activa "HTTPS" en el equipo)`));
  } catch (err) {
    console.error(`✖ No se pudo leer el certificado TLS: ${err.message}`);
  }
}
  }
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ El puerto ${port} ya está en uso por otro programa (¿frp, BioTime, IIS?).`);
    console.error('  Cambia PORT en el archivo .env (ej. PORT=18090) y vuelve a ejecutar npm start.\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.on('listening', () => {
  console.log(`IIT Asistencia escuchando en http://0.0.0.0:${port}`);
  console.log(`  Panel:      http://localhost:${port}/`);
  console.log(`  Biométrico: Servidor = IP de este equipo, Puerto = ${port} (modo ADMS / Cloud)`);
  if (!config.portExplicit) console.log(`  Tip: fija PORT=${port} en .env para que el puerto no cambie entre arranques.`);
  console.log(`  Base de datos: ${config.dbPath}`);
});

server.listen(port, '0.0.0.0');

// HTTPS opcional: HTTPS_PORT + TLS_CERT + TLS_KEY en .env
if (config.httpsPort && config.tlsCert && config.tlsKey) {
  try {
    const tls = https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }, createRequestHandler({ repo, config }));
    tls.on('error', (err) => console.error(`✖ HTTPS en puerto ${config.httpsPort}: ${err.message}`));
    tls.listen(config.httpsPort, '0.0.0.0', () => console.log(`  HTTPS:      puerto ${config.httpsPort} (activa "HTTPS" en el equipo)`));
  } catch (err) {
    console.error(`✖ No se pudo leer el certificado TLS: ${err.message}`);
  }
}

// Mantenimiento: limpiar bitácora cruda > 30 días
setInterval(() => repo.pruneRaw(), 6 * 3600000).unref();

function shutdown() {
  console.log('Cerrando…');
  server.close(() => { repo.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
