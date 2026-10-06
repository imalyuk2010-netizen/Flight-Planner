// aircraft.js — load the aircraft list and resolve the user's selection
// (a preset or custom numbers) into planning figures.

export const CUSTOM_ID = 'custom';

let _catalog = null;

/** Load data/aircraft.json once. Returns { note, aircraft[] }. */
export async function loadAircraft(url = 'data/aircraft.json') {
  if (_catalog) return _catalog;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load aircraft list (HTTP ${res.status}).`);
  const json = await res.json();
  if (!json || !Array.isArray(json.aircraft) || json.aircraft.length === 0) {
    throw new Error('Aircraft list is empty or malformed.');
  }
  _catalog = { note: json._note || '', aircraft: json.aircraft };
  return _catalog;
}

export function getAircraftById(id) {
  return _catalog?.aircraft.find((a) => a.id === id) || null;
}

/**
 * Resolve the selection into { name, cruise_ktas_8000, burn_gph, usable_fuel_gal, isCustom }.
 * `custom` is { ktas, gph, usable } from the custom inputs (strings or numbers).
 * Throws an Error with a user-readable message if the numbers are unusable.
 */
export function resolveAircraft(selectedId, custom = {}) {
  if (selectedId === CUSTOM_ID) {
    const ktas = Number(custom.ktas);
    const gph = Number(custom.gph);
    const usable = Number(custom.usable);
    if (!(ktas > 0)) throw new Error('Custom aircraft: enter a cruise speed greater than 0 KTAS.');
    if (!(gph > 0)) throw new Error('Custom aircraft: enter a fuel burn greater than 0 gph.');
    if (!(usable > 0)) throw new Error('Custom aircraft: enter usable fuel greater than 0 gal.');
    return { name: 'Custom aircraft', cruise_ktas_8000: ktas, burn_gph: gph, usable_fuel_gal: usable, isCustom: true };
  }
  const a = getAircraftById(selectedId);
  if (!a) throw new Error('Select an aircraft.');
  return { ...a, isCustom: false };
}
