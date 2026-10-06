// airports.js — load data/airports.json, autocomplete search, alternate finder.

import { haversineNM, distanceToRouteSegmentNM } from './nav.js';

let _airports = [];
let _byIdent = new Map();
let _index = []; // pre-lowercased search fields

/** Load and index the airport database. Returns the number of airports loaded. */
export async function loadAirports(url = 'data/airports.json') {
  if (_airports.length) return _airports.length;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Could not load airport database (HTTP ${res.status}). ` +
        'If you are running locally, generate it first with: node scripts/build-airports.mjs',
    );
  }
  const json = await res.json();
  const list = Array.isArray(json) ? json : json?.airports;
  if (!Array.isArray(list) || list.length === 0) throw new Error('Airport database is empty or malformed.');

  _airports = list;
  _byIdent = new Map(list.map((a) => [a.ident.toUpperCase(), a]));
  _index = list.map((a) => ({
    a,
    ident: a.ident.toUpperCase(),
    name: (a.name || '').toLowerCase(),
    city: (a.municipality || '').toLowerCase(),
  }));
  return _airports.length;
}

export function airportCount() {
  return _airports.length;
}

export function getAirport(ident) {
  return _byIdent.get(String(ident || '').trim().toUpperCase()) || null;
}

/**
 * Autocomplete. Ranks exact ident > ident prefix > city prefix > name prefix > substring.
 * Within a rank, larger airports (longer runway) come first.
 */
export function searchAirports(query, limit = 8) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const qU = q.toUpperCase();
  const qL = q.toLowerCase();

  const scored = [];
  for (const e of _index) {
    let score;
    if (e.ident === qU) score = 0;
    else if (e.ident.startsWith(qU)) score = 1;
    else if (e.city.startsWith(qL)) score = 2;
    else if (e.name.startsWith(qL)) score = 3;
    else if (e.ident.includes(qU)) score = 4;
    else if (e.city.includes(qL) || e.name.includes(qL)) score = 5;
    else continue;
    scored.push({ score, a: e.a });
    if (scored.length > 400) break; // plenty to rank from; keeps typing snappy
  }
  scored.sort(
    (x, y) =>
      x.score - y.score ||
      (y.a.runway_length_ft || 0) - (x.a.runway_length_ft || 0) ||
      x.a.name.localeCompare(y.a.name),
  );
  return scored.slice(0, limit).map((s) => s.a);
}

/**
 * Alternates: airports within `maxOffsetNM` of the great-circle route segment,
 * with a runway ≥ `minRunwayFt`, excluding departure/destination,
 * sorted by distance from destination. Returns up to `limit` entries with
 * `distFromRouteNM` and `distFromDestNM` attached.
 */
export function findAlternates(dep, dest, { maxOffsetNM = 25, minRunwayFt = 2500, limit = 5 } = {}) {
  // Coarse bounding box first (25 NM ≈ 0.42° lat), then exact spherical distance.
  const pad = maxOffsetNM / 60 + 0.1;
  const minLat = Math.min(dep.lat, dest.lat) - pad;
  const maxLat = Math.max(dep.lat, dest.lat) + pad;
  const cosLat = Math.max(0.2, Math.cos(((dep.lat + dest.lat) / 2) * (Math.PI / 180)));
  const lonPad = pad / cosLat;
  const minLon = Math.min(dep.lon, dest.lon) - lonPad;
  const maxLon = Math.max(dep.lon, dest.lon) + lonPad;

  const out = [];
  for (const a of _airports) {
    if (a.ident === dep.ident || a.ident === dest.ident) continue;
    if (!(a.runway_length_ft >= minRunwayFt)) continue;
    if (a.lat < minLat || a.lat > maxLat || a.lon < minLon || a.lon > maxLon) continue;
    const off = distanceToRouteSegmentNM(dep.lat, dep.lon, dest.lat, dest.lon, a.lat, a.lon);
    if (off > maxOffsetNM) continue;
    out.push({
      ...a,
      distFromRouteNM: off,
      distFromDestNM: haversineNM(dest.lat, dest.lon, a.lat, a.lon),
    });
  }
  out.sort((x, y) => x.distFromDestNM - y.distFromDestNM);
  return out.slice(0, limit);
}

/** "KSMF — Sacramento Intl (Sacramento, US-CA)" */
export function describeAirport(a) {
  const where = [a.municipality, a.iso_region].filter(Boolean).join(', ');
  return `${a.ident} — ${a.name}${where ? ` (${where})` : ''}`;
}
