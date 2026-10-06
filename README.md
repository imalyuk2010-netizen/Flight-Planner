# Flight Planner — VFR Cross-Country Planning Aid

> **Disclaimer — read this first.** Flight Planner is a **training and planning aid**. It is **not for actual navigation**. Aircraft performance numbers are approximate planning values, not POH/AFM data. Winds are a single forecast sample. Always verify with official sources — current sectional/terminal charts, a standard weather briefing (1-800-WX-BRIEF / Leidos / ForeFlight), NOTAMs, and the POH for the specific aircraft you fly — before any flight.

A single-page web app that does the arithmetic of a VFR cross-country navigation log the way a student pilot is taught to do it on an E6B — and shows its work.

Built for the Congressional App Challenge. No frameworks, no build step: plain HTML, CSS, and vanilla JavaScript (ES modules).

## What it does

Enter a departure, a destination, an aircraft, an altitude, and fuel on board. Flight Planner returns:

| Output | How it is computed |
|---|---|
| **Distance** | Great-circle (haversine), Earth radius 3440.065 NM |
| **True course** | Initial great-circle bearing from departure to destination |
| **True airspeed** | `cruise KTAS @ 8,000 × (1 + 0.02 × (alt − 8,000) / 1,000)` — an approximation, labeled as such |
| **Wind correction angle, true heading, ground speed** | Wind triangle: `θ = wind dir − TC`, `WCA = asin(W·sin θ / TAS)`, `TH = TC + WCA`, `GS = TAS·cos WCA − W·cos θ`. If the crosswind component exceeds TAS the app says so instead of returning NaN. |
| **Time enroute** | `distance / ground speed` |
| **Fuel required** | `time × gph + 1.2 gal` taxi/run-up allowance |
| **Legal reserve** | 14 CFR 91.151: VFR day 30 min, VFR night 45 min — at cruise burn |
| **GO / TIGHT / NO-GO** | NO-GO if trip + reserve > usable fuel on board · TIGHT if legal but < 30 extra minutes beyond the reserve · GO otherwise |
| **VFR cruising altitude check** | 14 CFR 91.159: course 0–179° → odd thousands + 500; 180–359° → even thousands + 500. Flags a non-standard altitude and suggests the nearest legal ones. Uses **true** course as an approximation for **magnetic** course — the app says so. |
| **Fuel cost** | trip fuel × price per gallon (default $6.50, editable) |
| **Winds aloft** | Open-Meteo forecast at the route midpoint, at the pressure level nearest your altitude (925 hPa ≈ 2,500 ft, 850 ≈ 5,000, 700 ≈ 10,000, 600 ≈ 14,000). Or enter winds manually from an FB forecast. |
| **Weather** | Current METAR and TAF for both airports — raw text plus a plain-English decode, from NOAA Aviation Weather Center |
| **Alternates** | Airports within 25 NM of the route with a runway ≥ 2,500 ft, nearest to the destination first (top 5), with current METARs for the top 3 |
| **Map** | Leaflet + OpenStreetMap, great-circle route drawn, departure/destination/alternates marked |

Every failure mode — airport database missing, weather service down, station not a reporting station, wind exceeding TAS, forecast unavailable — produces a readable message instead of a blank screen. If winds aloft can't be fetched, results are computed with zero wind and clearly labeled as such.

## Why it exists

Cross-country planning is where the pieces of primary flight training come together: dead reckoning, the wind triangle, fuel law, the hemispheric rule. Most free tools either hide the math or ignore the regulations. This app keeps the formulas visible (they're printed on the results cards) so a student can check them against an E6B and a paper nav log.

## Project layout

```
flight-planner/
  index.html                 page structure
  style.css                  styles (responsive, works on a phone)
  js/
    nav.js                   pure math: haversine, bearing, wind triangle, fuel, reserves, 91.159
    weather.js               METAR/TAF fetch + decode, winds aloft (Open-Meteo)
    airports.js              airport database load, autocomplete search, alternate finder
    aircraft.js              aircraft catalog + custom aircraft
    ui.js                    form, map, and result rendering
    scroll.js                smooth scrolling (Lenis from jsDelivr), hero parallax, reveals, progress bar
  data/
    aircraft.json            ~30 GA aircraft, approximate planning figures
    airports.json            GENERATED — 47,985 airports worldwide (see below)
  scripts/
    build-airports.mjs       one-time: OurAirports CSV → data/airports.json
    dev-server.mjs           zero-dependency local server that also serves /api/wx
    test-nav.mjs             sanity checks for the navigation math
  api/
    wx.js                    Vercel serverless proxy for aviationweather.gov
  vercel.json                cache headers for data/
```

## Running it locally

You need [Node.js](https://nodejs.org) 18 or newer (only for the scripts — the site itself has no dependencies).

```bash
# 1. Generate the airport database (downloads ~17 MB from OurAirports, writes ~9 MB JSON)
node scripts/build-airports.mjs

# 2. Check the math
node scripts/test-nav.mjs

# 3. Serve the site (includes the /api/wx weather proxy, like Vercel does)
node scripts/dev-server.mjs
# → open http://localhost:8000
```

Any static file server also works (`python3 -m http.server 8000`), but then `/api/wx` doesn't exist and METAR/TAF will fail with a readable message, because aviationweather.gov does not allow cross-origin browser requests. Everything else (route, winds aloft, map, alternates) still works.

## Data sources and licenses

| Source | Used for | License / terms | Key needed |
|---|---|---|---|
| [OurAirports](https://ourairports.com/data/) (`airports.csv`, `runways.csv`) | Airport database | Public domain | No |
| [NOAA Aviation Weather Center Data API](https://aviationweather.gov/data/api/) | METAR / TAF | US Government work, public domain | No |
| [Open-Meteo](https://open-meteo.com/) | Winds aloft (pressure-level forecast) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), free for non-commercial use | No |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles via [Leaflet](https://leafletjs.com/) 1.9.4 (from cdnjs) | Map | ODbL (data), [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) | No |

Aircraft figures in `data/aircraft.json` are approximate planning values compiled for typical configurations at ~65–75 % power around 8,000 ft. They are **not** POH data.

### Notes on the APIs

- NOAA returns **HTTP 204 with an empty body** for an unknown station; the app treats that as "not a reporting station."
- NOAA sends no CORS headers, so the browser calls the same-origin `/api/wx` proxy first and only falls back to a direct request if the proxy is unavailable.
- This is a VFR-only planner: IFR rules (91.167 reserves, IFR altitudes, alternate requirements) are intentionally not modeled.

## Deploying (GitHub + Vercel)

See the step-by-step guide at the bottom of this file if you've never done it. Short version: push this folder to a GitHub repository, import it into Vercel, and Vercel will serve the static files and turn `api/wx.js` into a serverless function automatically. No environment variables or keys are needed.

## Verification performed

- `node scripts/test-nav.mjs`: 18/18 checks pass — KSFO→KLAX 293.3 NM, KSMF→KOAK 65.6 NM; zero wind GS = TAS; 20 kt headwind GS = TAS − 20; 20 kt tailwind GS = TAS + 20; textbook example TC 090 / TAS 120 / wind 045@30 → WCA −10.2°, GS 96.9; wind-exceeds-TAS returns a clear error; 91.159 cases; reserves.
- Loaded in a browser via `scripts/dev-server.mjs`: live KSMF METAR/TAF decoded; Open-Meteo winds used in the wind triangle; alternates with METARs; station-not-found and forecast-unavailable paths render readable messages; console clean.

---

## Appendix: pushing to GitHub and deploying on Vercel (first time)

**A. Put the code on GitHub**

1. Create a free account at https://github.com if you don't have one.
2. Click **New repository** (the "+" in the top right). Name it `flight-planner`, leave it **Public**, do **not** add a README/.gitignore (this folder already has them). Click **Create repository**.
3. GitHub shows a page with commands. In Terminal, inside the `flight-planner` folder, run:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/flight-planner.git
   git push -u origin main
   ```
   The first push asks you to log in — GitHub will open a browser window, or you can use a personal access token as the password.
4. Refresh the repository page: your files are there.

**B. Deploy on Vercel**

1. Go to https://vercel.com and sign up **with your GitHub account** (that's what links them).
2. Click **Add New… → Project**. Vercel lists your GitHub repositories; click **Import** next to `flight-planner`.
3. Leave every setting at its default: Framework Preset **Other**, no build command, output directory blank. Click **Deploy**.
4. About a minute later you get a URL like `https://flight-planner-xxxx.vercel.app`. Open it — the map, weather (through `/api/wx`), and everything else should work.
5. From now on, every `git push` to `main` redeploys automatically.

If something fails, the Vercel dashboard → your project → **Deployments** → click the deployment → **Functions** tab shows the log for `api/wx`.
