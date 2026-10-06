// nav.js — pure navigation / performance math. No DOM, no network.
// Every function here is deterministic so it can be unit-tested from Node.

export const EARTH_RADIUS_NM = 3440.065;
export const TAXI_RUNUP_GAL = 1.2;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Normalize an angle in degrees to [0, 360). */
export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle distance in nautical miles (haversine). */
export function haversineNM(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing (true course) from point 1 to point 2, degrees [0, 360). */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/**
 * Point along the great circle from 1 to 2 at fraction f (0 = start, 1 = end).
 * Uses spherical linear interpolation so the path is a true great circle.
 */
export function intermediatePoint(lat1, lon1, lat2, lon2, f) {
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);
  const δ = haversineNM(lat1, lon1, lat2, lon2) / EARTH_RADIUS_NM; // angular distance
  if (δ === 0) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lon: toDeg(Math.atan2(y, x)),
  };
}

/** Great-circle midpoint. */
export function midpoint(lat1, lon1, lat2, lon2) {
  return intermediatePoint(lat1, lon1, lat2, lon2, 0.5);
}

/** Array of [lat, lon] pairs along the great circle, for drawing on a map. */
export function greatCirclePath(lat1, lon1, lat2, lon2, steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const p = intermediatePoint(lat1, lon1, lat2, lon2, i / steps);
    pts.push([p.lat, p.lon]);
  }
  return pts;
}

/**
 * Cross-track distance (NM) of point 3 from the great-circle route 1→2.
 * Positive = right of track, negative = left of track.
 */
export function crossTrackDistanceNM(lat1, lon1, lat2, lon2, lat3, lon3) {
  const δ13 = haversineNM(lat1, lon1, lat3, lon3) / EARTH_RADIUS_NM;
  const θ13 = toRad(initialBearing(lat1, lon1, lat3, lon3));
  const θ12 = toRad(initialBearing(lat1, lon1, lat2, lon2));
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_NM;
}

/** Along-track distance (NM) from point 1 to the closest point on the route to point 3. */
export function alongTrackDistanceNM(lat1, lon1, lat2, lon2, lat3, lon3) {
  const δ13 = haversineNM(lat1, lon1, lat3, lon3) / EARTH_RADIUS_NM;
  const δxt = crossTrackDistanceNM(lat1, lon1, lat2, lon2, lat3, lon3) / EARTH_RADIUS_NM;
  const cosRatio = Math.cos(δ13) / Math.cos(δxt);
  const δat = Math.acos(Math.max(-1, Math.min(1, cosRatio)));
  // Sign: is the point ahead of (or behind) the start along the route?
  const θ13 = toRad(initialBearing(lat1, lon1, lat3, lon3));
  const θ12 = toRad(initialBearing(lat1, lon1, lat2, lon2));
  const sign = Math.cos(θ13 - θ12) >= 0 ? 1 : -1;
  return sign * δat * EARTH_RADIUS_NM;
}

/**
 * Shortest distance (NM) from point 3 to the great-circle *segment* 1→2.
 * Beyond either endpoint, falls back to distance from that endpoint.
 */
export function distanceToRouteSegmentNM(lat1, lon1, lat2, lon2, lat3, lon3) {
  const routeLen = haversineNM(lat1, lon1, lat2, lon2);
  const along = alongTrackDistanceNM(lat1, lon1, lat2, lon2, lat3, lon3);
  if (along < 0) return haversineNM(lat1, lon1, lat3, lon3);
  if (along > routeLen) return haversineNM(lat2, lon2, lat3, lon3);
  return Math.abs(crossTrackDistanceNM(lat1, lon1, lat2, lon2, lat3, lon3));
}

/**
 * True airspeed adjusted for altitude.
 * APPROXIMATION: TAS ≈ cruise_KTAS(8000) × (1 + 0.02 × (alt − 8000) / 1000).
 * Real TAS depends on power setting, temperature, and the specific POH tables.
 */
export function tasAtAltitude(cruiseKtas8000, altitudeFt) {
  return cruiseKtas8000 * (1 + 0.02 * ((altitudeFt - 8000) / 1000));
}

/**
 * Wind triangle.
 *   angle       = windDir − trueCourse   (wind direction is where the wind comes FROM)
 *   WCA         = asin( windSpeed × sin(angle) / TAS )
 *   trueHeading = trueCourse + WCA
 *   groundSpeed = TAS × cos(WCA) − windSpeed × cos(angle)
 *
 * Returns { ok: true, wca, trueHeading, groundSpeed, headwind, crosswind }
 * or      { ok: false, error } when the wind exceeds what the aircraft can correct for.
 * Angles in degrees, speeds in knots. WCA is positive = crab right.
 */
export function windTriangle({ trueCourse, tas, windDir, windSpeed }) {
  if (!(tas > 0)) return { ok: false, error: 'TAS must be greater than zero.' };
  if (!(windSpeed >= 0)) return { ok: false, error: 'Wind speed must be zero or greater.' };

  const angle = toRad(windDir - trueCourse);
  const ratio = (windSpeed * Math.sin(angle)) / tas;

  if (Math.abs(ratio) > 1) {
    return {
      ok: false,
      error: `Crosswind component (${Math.abs(windSpeed * Math.sin(angle)).toFixed(0)} kt) exceeds TAS (${tas.toFixed(0)} kt). No heading can hold this course.`,
    };
  }

  const wca = Math.asin(ratio);
  const groundSpeed = tas * Math.cos(wca) - windSpeed * Math.cos(angle);

  if (groundSpeed <= 0) {
    return {
      ok: false,
      error: `Headwind (${(windSpeed * Math.cos(angle)).toFixed(0)} kt) equals or exceeds TAS (${tas.toFixed(0)} kt). Ground speed would be zero or negative.`,
    };
  }

  return {
    ok: true,
    wca: toDeg(wca),
    trueHeading: normalizeDeg(trueCourse + toDeg(wca)),
    groundSpeed,
    headwind: windSpeed * Math.cos(angle),   // + headwind, − tailwind
    crosswind: windSpeed * Math.sin(angle),  // + from the right, − from the left
  };
}

/** Time enroute in hours. */
export function timeEnrouteHours(distanceNM, groundSpeedKt) {
  return distanceNM / groundSpeedKt;
}

/** Trip fuel in gallons: enroute burn + taxi/run-up allowance. */
export function tripFuelGal(hours, gph, taxiGal = TAXI_RUNUP_GAL) {
  return hours * gph + taxiGal;
}

/**
 * Required VFR fuel reserve in minutes, per 14 CFR 91.151: day 30 min, night 45 min.
 */
export function reserveMinutes(dayNight) {
  return dayNight === 'night' ? 45 : 30;
}

export function reserveFuelGal(dayNight, gph) {
  return (reserveMinutes(dayNight) / 60) * gph;
}

/**
 * Fuel verdict.
 *   NO-GO : trip + legal reserve exceeds usable fuel on board.
 *   TIGHT : legal, but less than 30 extra minutes of fuel beyond the legal reserve.
 *   GO    : at least 30 extra minutes beyond the legal reserve.
 */
export function fuelVerdict({ tripGal, reserveGal, usableGal, gph }) {
  const requiredGal = tripGal + reserveGal;
  const marginGal = usableGal - requiredGal;
  const marginMin = gph > 0 ? (marginGal / gph) * 60 : 0;
  let verdict;
  if (marginGal < 0) verdict = 'NO-GO';
  else if (marginMin < 30) verdict = 'TIGHT';
  else verdict = 'GO';
  return { verdict, requiredGal, marginGal, marginMin };
}

/**
 * VFR cruising altitude check, 14 CFR 91.159.
 * Applies above 3,000 ft AGL and below 18,000 ft MSL:
 *   magnetic course   0–179 → odd  thousands + 500 (3,500, 5,500, 7,500 …)
 *   magnetic course 180–359 → even thousands + 500 (4,500, 6,500, 8,500 …)
 *
 * NOTE: this app passes TRUE course as an approximation for MAGNETIC course.
 * Near the boundaries (~000/180) magnetic variation can flip the answer.
 */
export function vfrAltitudeCheck(courseDeg, altitudeFt) {
  const course = normalizeDeg(courseDeg);
  const eastbound = course < 180;
  const rule = eastbound ? 'odd thousands + 500' : 'even thousands + 500';
  const legalFor = (alt) => {
    const thousands = Math.floor(alt / 1000);
    const remainder = alt - thousands * 1000;
    if (remainder !== 500) return false;
    return eastbound ? thousands % 2 === 1 : thousands % 2 === 0;
  };

  if (altitudeFt >= 18000) {
    return {
      applies: false,
      legal: false,
      rule,
      eastbound,
      message: '18,000 ft MSL and above is Class A airspace — VFR flight is not permitted.',
      suggestions: [],
    };
  }

  // Candidate legal altitudes near the requested one
  const base = Math.floor(altitudeFt / 1000) * 1000;
  const candidates = [];
  for (let alt = base - 2000; alt <= base + 3000; alt += 1000) {
    const c = alt + 500;
    if (c >= 3500 && c < 18000 && legalFor(c)) candidates.push(c);
  }
  candidates.sort((a, b) => Math.abs(a - altitudeFt) - Math.abs(b - altitudeFt));
  const suggestions = candidates.slice(0, 2).sort((a, b) => a - b);

  if (altitudeFt < 3500) {
    return {
      applies: false,
      legal: true,
      rule,
      eastbound,
      message:
        '91.159 hemispheric rule only applies above 3,000 ft AGL. At this altitude, check terrain and minimum safe altitudes (91.119) instead.',
      suggestions,
    };
  }

  const legal = legalFor(altitudeFt);
  return {
    applies: true,
    legal,
    rule,
    eastbound,
    message: legal
      ? `Legal VFR cruising altitude for a ${eastbound ? 'eastbound (000–179°)' : 'westbound (180–359°)'} course (${rule}).`
      : `Non-standard for a ${eastbound ? 'eastbound (000–179°)' : 'westbound (180–359°)'} course. Rule: ${rule}. Nearest legal: ${suggestions.map((s) => s.toLocaleString() + ' ft').join(' or ')}.`,
    suggestions,
  };
}

/** Format hours as "1h 23m". */
export function formatHours(hours) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

/** Format degrees as 3-digit "045°". */
export function formatDeg(deg) {
  return String(Math.round(normalizeDeg(deg)) % 360).padStart(3, '0') + '°';
}
