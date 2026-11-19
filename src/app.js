'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAdmsHandler } = require('./adms/handler');
const { createApi } = require('./api');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const MAX_BODY = 10 * 1024 * 1024; // lotes grandes de ATTLOG tras días sin red

/** Manejador común para HTTP y HTTPS */
function createRequestHandler({ repo, config, log = console.log }) {
  const adms = createAdmsHandler({ repo, config, log });
  const api = createApi({ repo, config });

  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      const body = decodeBody(Buffer.concat(chunks));
      try {
        if (url.pathname.toLowerCase().startsWith('/iclock')) return await adms(req, res, url, body);
        if (url.pathname.startsWith('/api/')) return await api(req, res, url, body);
        return serveStatic(url.pathname, res);
      } catch (err) {
        log(`[http] ${err.stack || err}`);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    });
  };
}

function createServer(opts) {
  return http.createServer(createRequestHandler(opts));
}

/**
 * Los firmwares nuevos envían UTF-8; algunos antiguos envían los nombres en Latin-1
 * (José → "Jos\xe9"). Si el cuerpo no es UTF-8 válido se decodifica como Latin-1.
 */
const utf8 = new TextDecoder('utf-8', { fatal: true });
function decodeBody(buf) {
  if (!buf.length) return '';
  try { return utf8.decode(buf); } catch { return buf.toString('latin1'); }
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('No encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

module.exports = { createServer, createRequestHandler, decodeBody };
