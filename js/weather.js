// weather.js — METAR/TAF from NOAA AWC (direct, then /api/wx proxy fallback),
// winds aloft from Open-Meteo, and plain-English decoders.
// Every exported fetch resolves to a status object; nothing here throws to the caller.

const NOAA_BASE = 'https://aviationweather.gov/api/data';
const PROXY_BASE = '/api/wx';
const TIMEOUT_MS = 9000;

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch METAR or TAF JSON for one or more stations.
 *
 * Order: the same-origin /api/wx proxy first, then aviationweather.gov directly.
 * NOAA sends no Access-Control-Allow-Origin header (verified), so a direct browser
 * fetch is rejected by CORS and the browser logs an error that JS cannot suppress.
 * Going proxy-first keeps the console clean wherever the proxy exists (Vercel,
 * scripts/dev-server.mjs); the direct attempt remains as a fallback for a plain
 * static server or if NOAA ever enables CORS.
 *
 * Resolves to { status: 'ok', data, source } | { status: 'not_found', source } | { status: 'error', message }.
 */
async function fetchNoaa(type, ids) {
  const idList = String(ids).toUpperCase();
  const attempts = [
    ['proxy', `${PROXY_BASE}?type=${type}&ids=${encodeURIComponent(idList)}`],
    ['NOAA direct', `${NOAA_BASE}/${type}?ids=${encodeURIComponent(idList)}&format=json`],
  ];
  const errors = [];

  for (const [source, url] of attempts) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.status === 204) return { status: 'not_found', source };
      if (!res.ok) {
        errors.push(`${source}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text.trim()) return { status: 'not_found', source };
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        errors.push(`${source}: unreadable response`);
        continue;
      }
      if (!Array.isArray(data)) {
        errors.push(`${source}: ${data?.error || 'unexpected response shape'}`);
        continue;
      }
      if (data.length === 0) return { status: 'not_found', source };
      return { status: 'ok', data, source };
    } catch (err) {
      const why = err.name === 'AbortError' ? 'timed out' : 'blocked or unreachable';
      errors.push(`${source}: ${why}`);
    }
  }
  return { status: 'error', message: `Weather service unavailable (${errors.join('; ')}).` };
}

// ---------- decoding helpers ----------

const WX_INTENSITY = { '-': 'light', '+': 'heavy' };
const WX_CODES = {
  VC: 'in the vicinity', MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting',
  BL: 'blowing', SH: 'showers of', TS: 'thunderstorm', FZ: 'freezing',
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets',
  GR: 'hail', GS: 'small hail', UP: 'unknown precipitation',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust', SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm', NSW: 'no significant weather',
};
const CLOUD_COVER = {
  SKC: 'sky clear', CLR: 'clear', NSC: 'no significant cloud', NCD: 'no cloud detected', CAVOK: 'ceiling and visibility OK',
  FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast', OVX: 'sky obscured', VV: 'vertical visibility',
};

/** "-SHRA BR" → "light showers of rain, mist" */
export function decodeWxString(wx) {
  if (!wx) return '';
  return String(wx)
    .trim()
    .split(/\s+/)
    .map((token) => {
      let t = token;
      const parts = [];
      if (WX_INTENSITY[t[0]]) {
        parts.push(WX_INTENSITY[t[0]]);
        t = t.slice(1);
      }
      if (t === 'NSW') return WX_CODES.NSW;
      let vicinity = false;
      while (t.length >= 2) {
        const code = t.slice(0, 2);
        t = t.slice(2);
        if (code === 'VC') { vicinity = true; continue; }
        // "SH" with nothing after it (e.g. VCSH) means plain "showers"
        if (code === 'SH' && t.length === 0) { parts.push('showers'); continue; }
        parts.push(WX_CODES[code] || code);
      }
      if (vicinity) parts.push('in the vicinity');
      return parts.join(' ');
    })
    .join(', ');
}

function fmtWind(wdir, wspd, wgst) {
  if (wspd === 0 || wspd === null || wspd === undefined) return 'Calm';
  const dir = wdir === 'VRB' || wdir === null ? 'variable' : `${String(wdir).padStart(3, '0')}°`;
  return `${dir} at ${wspd} kt${wgst ? `, gusting ${wgst} kt` : ''}`;
}

function fmtVis(visib) {
  if (visib === null || visib === undefined || visib === '') return null;
  const s = String(visib);
  return s.endsWith('+') ? `${s.slice(0, -1)}+ SM` : `${s} SM`;
}

function fmtClouds(clouds, vertVis) {
  if (vertVis) return `Sky obscured, vertical visibility ${vertVis.toLocaleString()} ft`;
  if (!Array.isArray(clouds) || clouds.length === 0) return 'No cloud data';
  return clouds
    .map((c) => {
      const cover = CLOUD_COVER[c.cover] || c.cover;
      if (c.base === null || c.base === undefined) return cover;
      return `${cover} at ${Number(c.base).toLocaleString()} ft`;
    })
    .join(', ');
}

function cToF(c) {
  return Math.round((c * 9) / 5 + 32);
}

function fmtZulu(unixSec) {
  const d = new Date(unixSec * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}${hh}${mm}Z`;
}

function ageMinutes(unixSec) {
  return Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 60));
}

/** Decode one NOAA METAR JSON object into label/value pairs. */
export function decodeMetar(m) {
  const rows = [];
  if (m.obsTime) rows.push(['Observed', `${fmtZulu(m.obsTime)} (${ageMinutes(m.obsTime)} min ago)`]);
  if (m.fltCat) rows.push(['Flight category', m.fltCat]);
  rows.push(['Wind', fmtWind(m.wdir, m.wspd, m.wgst)]);
  const vis = fmtVis(m.visib);
  if (vis) rows.push(['Visibility', vis]);
  if (m.wxString) rows.push(['Weather', decodeWxString(m.wxString)]);
  rows.push(['Sky', fmtClouds(m.clouds, m.vertVis)]);
  if (typeof m.temp === 'number') rows.push(['Temperature', `${m.temp} °C (${cToF(m.temp)} °F)`]);
  if (typeof m.dewp === 'number') rows.push(['Dew point', `${m.dewp} °C (${cToF(m.dewp)} °F)`]);
  if (typeof m.altim === 'number') rows.push(['Altimeter', `${(m.altim * 0.02953).toFixed(2)} inHg (${Math.round(m.altim)} hPa)`]);
  return rows;
}

/** Decode one NOAA TAF JSON object into { valid, periods: [{ when, text }] }. */
export function decodeTaf(t) {
  const valid = t.validTimeFrom && t.validTimeTo ? `${fmtZulu(t.validTimeFrom)} – ${fmtZulu(t.validTimeTo)}` : '';
  const periods = (t.fcsts || []).map((f) => {
    let when;
    const change = f.fcstChange || 'FM';
    if (change === 'TEMPO' || change === 'BECMG' || f.probability) {
      const label = f.probability ? `PROB${f.probability}` : change;
      when = `${label} ${fmtZulu(f.timeFrom)}–${fmtZulu(f.timeTo)}`;
    } else {
      when = `From ${fmtZulu(f.timeFrom)}`;
    }
    const bits = [`wind ${fmtWind(f.wdir, f.wspd, f.wgst).toLowerCase()}`];
    const vis = fmtVis(f.visib);
    if (vis) bits.push(`visibility ${vis}`);
    if (f.wxString) bits.push(decodeWxString(f.wxString));
    bits.push(fmtClouds(f.clouds, f.vertVis).toLowerCase());
    if (f.wshearHgt) bits.push(`wind shear at ${f.wshearHgt} ft`);
    return { when, text: bits.join('; ') };
  });
  return { valid, periods };
}

// ---------- public API ----------

/** METAR for one station. */
export async function getMetar(ident) {
  const r = await fetchNoaa('metar', ident);
  if (r.status !== 'ok') return r;
  const m = r.data[0];
  return { status: 'ok', source: r.source, raw: m.rawOb, decoded: decodeMetar(m), fltCat: m.fltCat || null, obsTime: m.obsTime || null };
}

/** TAF for one station. */
export async function getTaf(ident) {
  const r = await fetchNoaa('taf', ident);
  if (r.status !== 'ok') return r;
  const t = r.data[0];
  return { status: 'ok', source: r.source, raw: t.rawTAF, decoded: decodeTaf(t) };
}

/** METARs for several stations at once. Resolves to Map<ident, result>. */
export async function getMetars(idents) {
  const list = idents.map((i) => String(i).toUpperCase());
  const out = new Map(list.map((i) => [i, { status: 'not_found' }]));
  if (list.length === 0) return out;
  const r = await fetchNoaa('metar', list.join(','));
  if (r.status === 'error') {
    for (const i of list) out.set(i, r);
    return out;
  }
  if (r.status === 'ok') {
    for (const m of r.data) {
      const id = String(m.icaoId || '').toUpperCase();
      if (out.has(id)) out.set(id, { status: 'ok', source: r.source, raw: m.rawOb, decoded: decodeMetar(m), fltCat: m.fltCat || null, obsTime: m.obsTime || null });
    }
  }
  return out;
}

// ---------- winds aloft (Open-Meteo) ----------

/** Standard-atmosphere pressure levels available from Open-Meteo, with approximate altitudes. */
export const PRESSURE_LEVELS = [
  { hpa: 925, ft: 2500 },
  { hpa: 850, ft: 5000 },
  { hpa: 700, ft: 10000 },
  { hpa: 600, ft: 14000 },
];

export function nearestPressureLevel(altitudeFt) {
  return PRESSURE_LEVELS.reduce((best, l) =>
    Math.abs(l.ft - altitudeFt) < Math.abs(best.ft - altitudeFt) ? l : best,
  );
}

/**
 * Forecast wind at the pressure level nearest `altitudeFt`, at the given point, for the current UTC hour.
 * Resolves to { ok: true, dir, speed, level, time } | { ok: false, message }.
 */
export async function getWindsAloft(lat, lon, altitudeFt) {
  const level = nearestPressureLevel(altitudeFt);
  const spdKey = `wind_speed_${level.hpa}hPa`;
  const dirKey = `wind_direction_${level.hpa}hPa`;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${spdKey},${dirKey}&wind_speed_unit=kn&forecast_days=2&timezone=UTC`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, message: `Open-Meteo returned HTTP ${res.status}.` };
    const json = await res.json();
    const times = json?.hourly?.time;
    const speeds = json?.hourly?.[spdKey];
    const dirs = json?.hourly?.[dirKey];
    if (!Array.isArray(times) || !Array.isArray(speeds) || !Array.isArray(dirs)) {
      return { ok: false, message: 'Open-Meteo response did not include wind data.' };
    }
    // Nearest hour to now
    const now = Date.now();
    let idx = 0;
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const diff = Math.abs(new Date(`${t}:00Z`).getTime() - now);
      if (diff < bestDiff) { bestDiff = diff; idx = i; }
    });
    const speed = speeds[idx];
    const dir = dirs[idx];
    if (typeof speed !== 'number' || typeof dir !== 'number') {
      return { ok: false, message: 'Open-Meteo has no wind value for the current hour.' };
    }
    return { ok: true, dir: Math.round(dir), speed: Math.round(speed), level, time: `${times[idx]}Z` };
  } catch (err) {
    const why = err.name === 'AbortError' ? 'timed out' : 'unreachable';
    return { ok: false, message: `Winds aloft unavailable (Open-Meteo ${why}).` };
  }
}
