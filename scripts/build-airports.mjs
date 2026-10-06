#!/usr/bin/env node
// build-airports.mjs — one-time data build.
//
// Downloads the OurAirports dataset (public domain) and writes a lean
// data/airports.json containing every large/medium/small airport worldwide
// with its longest runway. Run from the project root:
//
//     node scripts/build-airports.mjs
//
// No npm dependencies. Requires Node 18+ (built-in fetch).

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const RUNWAYS_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const KEEP_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'data', 'airports.json');

/** Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas/newlines, "" escapes. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Turn parsed rows into objects keyed by header name. */
function toRecords(rows) {
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function download(url) {
  process.stdout.write(`Downloading ${url} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  console.log(`${(text.length / 1e6).toFixed(1)} MB`);
  return text;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const [airportsCsv, runwaysCsv] = await Promise.all([download(AIRPORTS_URL), download(RUNWAYS_URL)]);

  console.log('Parsing …');
  const airports = toRecords(parseCSV(airportsCsv));
  const runways = toRecords(parseCSV(runwaysCsv));

  // Longest open runway per airport ident.
  const longest = new Map();
  for (const rw of runways) {
    if (rw.closed === '1') continue;
    const len = num(rw.length_ft);
    if (len === null || len <= 0) continue;
    const prev = longest.get(rw.airport_ident);
    if (!prev || len > prev.length_ft) {
      longest.set(rw.airport_ident, { length_ft: len, surface: (rw.surface || '').trim() });
    }
  }

  const out = [];
  let skippedNoCoords = 0;
  for (const a of airports) {
    if (!KEEP_TYPES.has(a.type)) continue;
    const ident = (a.ident || '').trim();
    if (!ident) continue;
    const lat = num(a.latitude_deg);
    const lon = num(a.longitude_deg);
    if (lat === null || lon === null) { skippedNoCoords++; continue; }
    const rw = longest.get(ident);
    out.push({
      ident,
      name: (a.name || '').trim(),
      municipality: (a.municipality || '').trim(),
      iso_region: (a.iso_region || '').trim(),
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      elevation_ft: num(a.elevation_ft),
      runway_length_ft: rw ? rw.length_ft : null,
      runway_surface: rw ? rw.surface : null,
    });
  }

  out.sort((x, y) => x.ident.localeCompare(y.ident));

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify({
    source: 'OurAirports (https://ourairports.com/data/) — public domain',
    generated: new Date().toISOString(),
    count: out.length,
    airports: out,
  });
  await writeFile(OUT_PATH, json);

  const byType = airports.reduce((m, a) => { m[a.type] = (m[a.type] || 0) + 1; return m; }, {});
  console.log(`Airports in source: ${airports.length} (${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  console.log(`Kept: ${out.length} large/medium/small with ident (${skippedNoCoords} skipped for missing coordinates)`);
  console.log(`With runway data: ${out.filter((a) => a.runway_length_ft).length}`);
  console.log(`Wrote ${OUT_PATH} (${(json.length / 1e6).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
