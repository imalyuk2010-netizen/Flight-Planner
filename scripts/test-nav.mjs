#!/usr/bin/env node
// test-nav.mjs — sanity checks for the navigation math. Run: node scripts/test-nav.mjs
// Uses only Node's built-in assert; no dependencies.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  haversineNM, initialBearing, windTriangle, tasAtAltitude, vfrAltitudeCheck,
  fuelVerdict, reserveMinutes, tripFuelGal, crossTrackDistanceNM, distanceToRouteSegmentNM,
} from '../js/nav.js';

const results = [];
function check(name, fn) {
  try { const out = fn(); results.push(['PASS', name, out]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Well-known airport coordinates (from OurAirports).
const KSFO = { lat: 37.6188, lon: -122.375 };
const KLAX = { lat: 33.9425, lon: -118.408 };
const KSMF = { lat: 38.6954, lon: -121.591 };
const KOAK = { lat: 37.7213, lon: -122.221 };

check('KSFO→KLAX distance ~290–300 NM', () => {
  const d = haversineNM(KSFO.lat, KSFO.lon, KLAX.lat, KLAX.lon);
  assert.ok(d >= 290 && d <= 300, `got ${d}`);
  return `${d.toFixed(1)} NM`;
});
check('KSMF→KOAK distance ~60–70 NM', () => {
  const d = haversineNM(KSMF.lat, KSMF.lon, KOAK.lat, KOAK.lon);
  assert.ok(d >= 60 && d <= 70, `got ${d}`);
  return `${d.toFixed(1)} NM`;
});
check('KSFO→KLAX true course is southeast-ish (~135–140°)', () => {
  const tc = initialBearing(KSFO.lat, KSFO.lon, KLAX.lat, KLAX.lon);
  assert.ok(tc >= 130 && tc <= 145, `got ${tc}`);
  return `${tc.toFixed(1)}°`;
});
check('Bearing due north = 0°, due east ≈ 90°', () => {
  assert.ok(near(initialBearing(0, 0, 1, 0), 0, 1e-9));
  assert.ok(near(initialBearing(0, 0, 0, 1), 90, 1e-9));
  return 'ok';
});

const TAS = 120;
check('Zero wind → GS = TAS, heading = course', () => {
  const r = windTriangle({ trueCourse: 90, tas: TAS, windDir: 0, windSpeed: 0 });
  assert.ok(r.ok);
  assert.ok(near(r.groundSpeed, TAS, 1e-9), `GS ${r.groundSpeed}`);
  assert.ok(near(r.trueHeading, 90, 1e-9));
  return `GS ${r.groundSpeed}`;
});
check('Pure 20 kt headwind → GS = TAS − 20', () => {
  const r = windTriangle({ trueCourse: 90, tas: TAS, windDir: 90, windSpeed: 20 });
  assert.ok(r.ok);
  assert.ok(near(r.groundSpeed, TAS - 20, 1e-9), `GS ${r.groundSpeed}`);
  assert.ok(near(r.wca, 0, 1e-9));
  return `GS ${r.groundSpeed}, WCA ${r.wca}`;
});
check('Pure 20 kt tailwind → GS = TAS + 20', () => {
  const r = windTriangle({ trueCourse: 90, tas: TAS, windDir: 270, windSpeed: 20 });
  assert.ok(r.ok);
  assert.ok(near(r.groundSpeed, TAS + 20, 1e-9), `GS ${r.groundSpeed}`);
  return `GS ${r.groundSpeed}, WCA ${r.wca.toFixed(3)}`;
});
check('Direct crosswind from the right → crab right, GS < TAS', () => {
  // Course 360, wind from 090 at 20 kt: crab right (positive WCA), GS = TAS·cos(WCA)
  const r = windTriangle({ trueCourse: 360, tas: TAS, windDir: 90, windSpeed: 20 });
  assert.ok(r.ok);
  assert.ok(r.wca > 0, `WCA ${r.wca}`);
  assert.ok(near(r.wca, (Math.asin(20 / TAS) * 180) / Math.PI, 1e-9));
  assert.ok(near(r.groundSpeed, TAS * Math.cos(Math.asin(20 / TAS)), 1e-9));
  assert.ok(near(r.trueHeading, r.wca, 1e-9)); // 360 + WCA wraps to WCA
  return `WCA +${r.wca.toFixed(2)}°, GS ${r.groundSpeed.toFixed(1)}`;
});
check('Textbook example: TC 090, TAS 120, wind 045/30 → WCA ≈ +10.2°, GS ≈ 97', () => {
  const r = windTriangle({ trueCourse: 90, tas: 120, windDir: 45, windSpeed: 30 });
  assert.ok(r.ok);
  // WCA = asin(30·sin(−45°)/120) = asin(−0.1768) = −10.18° → crab LEFT (wind from the left-front)
  assert.ok(near(r.wca, -10.18, 0.05), `WCA ${r.wca}`);
  // GS = 120·cos(WCA) − 30·cos(−45°) = 118.1 − 21.2 = 96.9
  assert.ok(near(r.groundSpeed, 96.9, 0.1), `GS ${r.groundSpeed}`);
  return `WCA ${r.wca.toFixed(2)}°, TH ${r.trueHeading.toFixed(1)}°, GS ${r.groundSpeed.toFixed(1)}`;
});
check('Crosswind exceeding TAS → clear error, not NaN', () => {
  const r = windTriangle({ trueCourse: 0, tas: 100, windDir: 90, windSpeed: 130 });
  assert.equal(r.ok, false);
  assert.ok(/exceeds TAS/.test(r.error));
  return r.error;
});
check('Headwind exceeding TAS → clear error', () => {
  const r = windTriangle({ trueCourse: 0, tas: 100, windDir: 0, windSpeed: 110 });
  assert.equal(r.ok, false);
  return r.error;
});

check('TAS altitude approximation: 120 KTAS@8000 → 114 @5500, 124.8 @10000', () => {
  assert.ok(near(tasAtAltitude(120, 8000), 120, 1e-9));
  assert.ok(near(tasAtAltitude(120, 5500), 114, 1e-9));
  assert.ok(near(tasAtAltitude(120, 10000), 124.8, 1e-9));
  return 'ok';
});

check('Fuel: 2.0 h × 9.5 gph + 1.2 taxi = 20.2 gal', () => {
  assert.ok(near(tripFuelGal(2, 9.5), 20.2, 1e-9));
  return 'ok';
});
check('Reserves: VFR day 30, VFR night 45', () => {
  assert.equal(reserveMinutes('day'), 30);
  assert.equal(reserveMinutes('night'), 45);
  return 'ok';
});
check('Verdicts: GO / TIGHT / NO-GO', () => {
  assert.equal(fuelVerdict({ tripGal: 20, reserveGal: 5, usableGal: 53, gph: 10 }).verdict, 'GO');    // 28 gal margin = 168 min
  assert.equal(fuelVerdict({ tripGal: 44, reserveGal: 5, usableGal: 53, gph: 10 }).verdict, 'TIGHT'); // 4 gal = 24 min
  assert.equal(fuelVerdict({ tripGal: 50, reserveGal: 5, usableGal: 53, gph: 10 }).verdict, 'NO-GO');
  return 'ok';
});

check('91.159: eastbound 5500 legal, 6500 not; westbound 6500 legal, 5500 not', () => {
  assert.equal(vfrAltitudeCheck(90, 5500).legal, true);
  assert.equal(vfrAltitudeCheck(90, 6500).legal, false);
  assert.deepEqual(vfrAltitudeCheck(90, 6500).suggestions, [5500, 7500]);
  assert.equal(vfrAltitudeCheck(270, 6500).legal, true);
  assert.equal(vfrAltitudeCheck(270, 5500).legal, false);
  assert.equal(vfrAltitudeCheck(270, 6000).legal, false);
  assert.deepEqual(vfrAltitudeCheck(270, 6000).suggestions, [4500, 6500]);
  assert.equal(vfrAltitudeCheck(179.9, 7500).legal, true);
  assert.equal(vfrAltitudeCheck(180, 7500).legal, false);
  assert.equal(vfrAltitudeCheck(90, 18000).applies, false);
  assert.equal(vfrAltitudeCheck(90, 2500).applies, false);
  return 'ok';
});

check('Cross-track: point 0.5° north of an eastbound equator route ≈ 30 NM left', () => {
  const xt = crossTrackDistanceNM(0, 0, 0, 10, 0.5, 5);
  assert.ok(near(Math.abs(xt), 30, 0.1), `got ${xt}`);
  assert.ok(xt < 0, 'north of an eastbound track should be LEFT (negative)');
  const seg = distanceToRouteSegmentNM(0, 0, 0, 10, 0.5, 5);
  assert.ok(near(seg, 30, 0.1));
  // Beyond the end of the segment, distance is measured from the endpoint.
  const beyond = distanceToRouteSegmentNM(0, 0, 0, 10, 0, 12);
  assert.ok(near(beyond, 120, 0.5), `got ${beyond}`);
  return `${xt.toFixed(2)} NM`;
});

// Optional: verify against the generated airport database if present.
try {
  const json = JSON.parse(await readFile(new URL('../data/airports.json', import.meta.url), 'utf8'));
  const by = new Map(json.airports.map((a) => [a.ident, a]));
  check(`airports.json loads (${json.airports.length} airports) and has KSFO/KLAX/KSMF/KOAK`, () => {
    for (const id of ['KSFO', 'KLAX', 'KSMF', 'KOAK']) assert.ok(by.get(id), `missing ${id}`);
    const d1 = haversineNM(by.get('KSFO').lat, by.get('KSFO').lon, by.get('KLAX').lat, by.get('KLAX').lon);
    const d2 = haversineNM(by.get('KSMF').lat, by.get('KSMF').lon, by.get('KOAK').lat, by.get('KOAK').lon);
    return `KSFO→KLAX ${d1.toFixed(1)} NM, KSMF→KOAK ${d2.toFixed(1)} NM (from dataset coords)`;
  });
} catch {
  results.push(['SKIP', 'airports.json not generated yet (run scripts/build-airports.mjs)', '']);
}

let failed = 0;
for (const [status, name, detail] of results) {
  if (status === 'FAIL') failed++;
  console.log(`${status.padEnd(4)} ${name}${detail ? `  →  ${detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
