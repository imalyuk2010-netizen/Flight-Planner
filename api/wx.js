// api/wx.js — Vercel serverless function.
// Proxies NOAA Aviation Weather Center METAR/TAF requests so the browser
// doesn't depend on aviationweather.gov's CORS behaviour.
//
//   GET /api/wx?type=metar&ids=KSMF
//   GET /api/wx?type=taf&ids=KSMF,KOAK
//
// No API key is required by NOAA. Responses are passed through unchanged
// (JSON array; empty array when the station is unknown).

const ALLOWED_TYPES = new Set(['metar', 'taf']);
const IDS_PATTERN = /^[A-Za-z0-9]{3,4}(,[A-Za-z0-9]{3,4}){0,9}$/; // up to 10 stations
const UPSTREAM_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const type = String(req.query.type || 'metar').toLowerCase();
  const ids = String(req.query.ids || '').toUpperCase();

  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'type must be metar or taf' });
  if (!IDS_PATTERN.test(ids)) return res.status(400).json({ error: 'ids must be 1–10 comma-separated station identifiers' });

  const url = `https://aviationweather.gov/api/data/${type}?ids=${encodeURIComponent(ids)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'flight-planner (student VFR planning project)' },
    });
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // METARs update hourly-ish; cache briefly at the edge to be polite to NOAA.
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(upstream.status).send(body);
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'NOAA request timed out' : `NOAA request failed: ${err.message}`;
    return res.status(502).json({ error: msg });
  } finally {
    clearTimeout(timer);
  }
}
