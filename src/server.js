'use strict';
const config = require('./config');
const { openDb } = require('./db');
const { createServer } = require('./app');

const repo = openDb(config.dbPath);
const server = createServer({ repo, config });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ El puerto ${config.port} ya está en uso por otro programa (¿frp, BioTime, IIS?).`);
    console.error('  Cambia PORT en el archivo .env (ej. PORT=8095) y vuelve a ejecutar npm start.\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`IIT Asistencia escuchando en http://0.0.0.0:${config.port}`);
  console.log(`  Panel:      http://localhost:${config.port}/`);
  console.log(`  Biométrico: Servidor = IP de este equipo, Puerto = ${config.port} (modo ADMS / Cloud)`);
  console.log(`  Base de datos: ${config.dbPath}`);
});

// Mantenimiento: limpiar bitácora cruda > 30 días
setInterval(() => repo.pruneRaw(), 6 * 3600000).unref();

function shutdown() {
  console.log('Cerrando…');
  server.close(() => { repo.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
