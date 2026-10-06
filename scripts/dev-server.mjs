#!/usr/bin/env node
// dev-server.mjs — zero-dependency local server that mimics Vercel:
// serves the static site AND mounts api/wx.js at /api/wx so the weather
// proxy fallback works on your machine exactly like it will in production.
//
//     node scripts/dev-server.mjs          # http://localhost:8000
//     PORT=3000 node scripts/dev-server.mjs
//
// (A plain `python3 -m http.server` also works, but then /api/wx is a 404
// and weather will only load if aviationweather.gov allows CORS.)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import wxHandler from '../api/wx.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

/** Minimal shim so the Vercel-style (req, res) handler runs on Node's http module. */
function vercelShim(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { res.end(body); return res; };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/wx') {
      vercelShim(req, res, url);
      await wxHandler(req, res);
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`Not found: ${url.pathname}`); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
}).listen(PORT, () => {
  console.log(`Flight Planner dev server → http://localhost:${PORT}`);
  console.log('Static files from', ROOT, '· /api/wx proxied via api/wx.js');
});
