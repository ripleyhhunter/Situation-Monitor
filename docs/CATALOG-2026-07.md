# Situation Monitor — Feature & Source Catalog

**Date:** 2026-07-04 · **Method:** 8 parallel live probes (every endpoint below was fetched
and verified with real data on this date — no candidate is listed on documentation alone),
ranked by impact ÷ effort for a real-time situational-awareness map of DC and Boise.
Constraints honored: free, keyless, runs on the owner's machine.

This is the follow-on to `ASSESSMENT-2026-07.md` / `ROADMAP-2026-07.md`: those fixed what
was broken; this catalog records what was worth **building next**, what was rejected, and why.

---

## Build list (in order)

| # | Feature | Region | Effort | Verdict / basis |
|---|---------|--------|:---:|-----------------|
| 1 | **Desktop notifications + proximity alerts** | both | S-M | The service existed as dead code. Settings UI, region/freshness/severity/radius gating, SSE wiring. No external dependency. |
| 2 | **Precipitation radar overlay** (RainViewer tiles, IEM fallback) | both | S | Verified live: index JSON + real tiles (10-min frames, <5 min stale). Free tier confirmed for personal use, attribution mandatory, `nowcast` now empty (past-frames only). Color scheme 8 suits the dark basemap; `maxNativeZoom: 7`. |
| 3 | **Wildfire layer** (NIFC WFIGS current incident locations) | both | M | Verified live: 5 current fires inside the Idaho envelope (one discovered hours before the probe), same-day `ModifiedOnDateTime`, keyless, CORS-open, envelope filters work. "Current" layer semantics = removed when contained/out, which is exactly presence-implies-active. DC envelope legitimately 0. |
| 4 | **Boise crime upgrade: Ada County CrimeMapper** | boise | M | **Correction found during the build:** CrimeMapper's *Boise PD* rows backfill over 1-3 months (18 rows in the trailing 30 days vs ~940/month once settled — verified with per-window counts), while the city's own `bpd-crime` layer runs only ~2 weeks behind for BPD. So this did **not** replace `bpd-crime`; the two run side by side, partitioned by agency: `ada-crime` covers ACSO/Meridian/Garden City (fresh at ~1-2 days, point geometry, dedupe by Case_Number) with Boise PD excluded via the where clause to prevent double-plotting. |
| 5 | **ACHD road closures** (RITA_Public layer 0) | boise | S-M | Verified live: 226 "Current Projects" polylines incl. explicit "Road Closure" type, edited in ~2h batches on business days. ACHD owns nearly all Boise-area surface streets — this is the local-road complement to the ITD state-highway WZDx feed. |
| 6 | **Idaho 511 cameras** | boise | M | Verified live: keyless internal endpoints of the 511 map. 234 camera sites / 252 image feeds in the Treasure Valley; city cams refresh every 15 s (18 KB JPEGs), freeway cams every 60 s. `mapIcons/Cameras` gives all positions in one 56 KB GET; images load on demand via `/map/Cctv/{imageId}` (CORS `*`). Replaces the "ITD camera API needs a key" limitation. |
| 7 | **DC coverage bundle: MDOT WZDx + VDOT NoVA + DC 311** | dc | M-L | All verified live: MDOT WZDx GeoJSON regenerates every 60 s (8 events in the DC bbox); VDOT 511's keyless GeoJSON layer feeds (incidents/construction/Waze) close the app's Northern-Virginia gap — the only keyless NoVA source found; DC 311 is genuinely near-real-time (newest record 9 min old at probe), filtered to situational categories (wires down, signals out, flooding, trees down). |
| 8 | **Hazards: USGS earthquakes + NWS river gauges** | both | M | Verified live. Quakes: FDSN point-radius query; Boise 200 km ≈ 9 events/30 d (usually non-empty), DC ≈ 1/30 d (honestly empty). Gauges: NWPS API with stage + flood-category thresholds; BIGI1 (Boise R. at Glenwood), BRKM2 (Potomac at Little Falls), GTND2 (Georgetown) verified. Gauges surface as incidents only when ≥ action stage, so the layer is quiet until it matters. |
| 9 | **OpenMHz scanner — real implementation (DC)** | dc | M | The stub's "no public API / 403" conclusion is wrong: the 403 is a User-Agent blocklist; any custom UA passes. Verified live: `dcfd` (DC Fire/EMS) newest call 54 s old; `ffxco`/`mocomdps`/`pgcomd` equally live. `/talkgroups` maps ids to names; `/calls/newer?time=` supports incremental polls. **Boise: zero Idaho systems on OpenMHz (0 of 446)** — the link-out panel stays. |
| 10 | **SQLite persistence + history & trends** | platform | L | `database.ts` is an in-memory mirror today; nothing survives restart except the Redis active-snapshot. Durable incident history enables a trends panel (counts by type/hour), restart continuity, and future analysis. |
| 11 | **PWA installability** | platform | S-M | Manifest + icons + minimal service worker (network-first, SSE-safe). Pairs with notifications. |
| 12 | **Idaho 511 live events + public-safety feed ranking** (added 2026-07-04, user ask: "less traffic, more police/EMS/fire") | boise + UI | M | Verified live: `mapIcons/Incidents` + `mapIcons/WazeIncidents` with DataTables detail rows — real-time crashes, stopped vehicles, road hazards, vehicle fires (4 live I-84 events at probe, minutes-to-hours old, platform-carried `lastUpdated`). Jams and Waze closure reports dropped (WZDx/ACHD already cover closures). Complete listing: ITD removes cleared events (observed live during the build: 4 → 1 within the hour). Paired with `feedRank` sidebar ordering: fire/EMS/gunshot > crime/weather/hazard > live traffic events > `ongoing` roadwork/311 — so ~420 Treasure Valley work zones can no longer bury a dispatch. |

## Rejected / deferred — and why

- **Boise `BPD_CallsForService`** (the roadmap's "near-real-time" hope) — **rejected as a map layer.**
  Live probe: it is a once-daily batch load (~9 AM Mountain, covering the prior day; newest record
  was 30 h old), and layer 0 is a geometry-less **table** — no lat/lng, no address; location is only
  census tract / neighborhood strings, nulled on sensitive categories. A "yesterday's calls" choropleth
  is possible but is a different, lower-value feature. Ada County CrimeMapper (#4) is the better feed.
- **Ada County Sheriff dispatch log** — **does not exist publicly anymore.** Full sitemap enumeration
  found no dispatch-log page; the county's channel for CAD data is now a records request.
- **DC 911/CAD calls-for-service** — DC publishes **no** such dataset (only an aggregate performance
  dashboard). DC 311 (#7) is the nearest live proxy.
- **Valley Regional Transit GTFS-RT** — deferred. Feeds are keyless and live (verified: S3 protobuf,
  header timestamp < 60 s), but they are protobuf (new dependency), alerts carry no coordinates
  (need static-GTFS joins), and the holiday probe showed zero active vehicles. Real feature, weak
  impact-per-effort right now.
- **Capital Bikeshare GBFS** — verified working (843 stations, 60 s TTL) but it's ambient city data,
  not situational awareness. Skipped.
- **Virginia's registered WZDx feed (SmarterRoads)** — token-gated, violates the keyless constraint.
  The VDOT 511 layer feeds (#7) cover the same ground keyless.
- **OpenMHz for Boise** — no Idaho system exists (verified against all 446 systems). Re-check occasionally.
- **Nixle/Everbridge public-safety alerts (Boise)** — the public RSS endpoints are dead
  (301/404 on every historic URL pattern, probed 2026-07-04); Everbridge retired unauthenticated
  feeds. Agency alerts now require an account or scraping social media. No keyless path.
- **A third region** — the architecture supports it, but deepening the two real regions dominates
  speculative breadth on every impact axis. Nothing here blocks adding one later.
- **Saved map views** — genuinely small, but below everything above on impact; localStorage presets
  can ride along with any later frontend PR.

## Source-of-truth notes for implementers

- **US Census Bureau geocoder** (added 2026-07-04, geocoding-accuracy fix): free, keyless,
  authoritative for house-numbered US addresses —
  `geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=...&benchmark=Public_AR_Current&format=json`.
  Primary resolver in `services/geocache.ts`; Nominatim is fallback-only (intersections, bare
  streets) because it fuzzy-matches wrong streets and rate-blocks this IP (429) under load —
  two backends geocoding from one machine exceeded its 1 req/sec policy, and every 429 was
  silently becoming a fabricated quadrant-fallback pin (66% of live DC PulsePoint incidents
  at the time of diagnosis).

- **RainViewer**: index `https://api.rainviewer.com/public/weather-maps.json` → tiles
  `{host}{path}/256/{z}/{x}/{y}/8/1_1.png`. Frame paths are opaque hashes that die when they age out
  of the 2 h window — always rebuild from a fresh index. Attribution "Weather data by RainViewer" required.
  Fallback: IEM `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png`.
- **WFIGS**: `services3.arcgis.com/T4QMspbfLg3qTGWY/.../WFIGS_Incident_Locations_Current/FeatureServer/0/query`
  with an envelope filter per region; perimeters layer exists but is heavyweight (117 KB for 3 features) —
  points first, perimeters only if wanted later with `geometryPrecision=5`.
- **CrimeMapper**: `gisprodapi.adacounty.id.gov/arcgis/rest/services/CrimeMapper/Public_Crime/MapServer/1`;
  dates are epoch ms; one row per offense (dedupe by `Case_Number`); ~1-2 day reporting lag; daily refresh.
- **Idaho 511**: positions via GET `/map/mapIcons/Cameras` (itemId ↔ GetData id); metadata via POST
  `/List/GetData/Cameras` form-encoded `draw=1&start=N&length=100` (silently empty on GET — length capped
  at 100, paginate ×5); images `/map/Cctv/{imageId}` (from `images[].imageUrl`, **not** the site id).
  Undocumented internals of the public map — parse defensively, throw on drift.
- **MDOT WZDx**: `https://filter.ritis.org/wzdx_v4.1/mdot.geojson`, 60 s regeneration, WZDx v4.1 schema.
- **VDOT 511**: layer catalog at `https://511.vdot.virginia.gov/services/map/layers/map`; GeoJSON layers under
  `data.511-atis-ttrip-prod.iteriscloud.com/datasets/...`. No per-event timestamps on incidents — treat
  presence-in-feed as active (complete-listing semantics), statewide → bbox-filter to NoVA.
- **DC 311**: `maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/13`, poll via
  `orderByFields=ADDDATE DESC` + `resultRecordCount` (a `where=ADDDATE>epoch` count query 400'd once);
  filter `SERVICECODEDESCRIPTION` to situational categories.
- **USGS quakes**: FDSN `query?format=geojson&latitude=..&longitude=..&maxradiuskm=200&starttime=<now-7d>`;
  coordinates are [lon, lat, depth], time epoch ms.
- **NWPS gauges**: `api.water.noaa.gov/nwps/v1/gauges?bbox...&srid=EPSG_4326` — **without `srid` the API
  returns 200 with an empty list** (silent failure). Sentinels −9999/−999 = missing. `primary`/`secondary`
  semantics flip per gauge (BIGI1 primary is flow; BRKM2 primary is stage) — branch on `primaryUnit`.
- **OpenMHz**: any custom `User-Agent` passes (default curl/node UAs are 403-blocked). `/talkgroups` is a
  dict keyed by number-string, not an array; `srcList[].src` is a string. `/calls/newer?time=<epoch-ms>`
  for incremental polls. Unofficial API — poll politely (≥2 min).

All the invariants from the fix cycle apply to every new fetcher: **throw on contract drift** (never
return `[]` for a failure), **derive `updatedAt` from feed fields**, **fetch window must match the
aggregator `expirationMs`** for that source, register only through the **region pack**, and declare
`incidentSource` + `sourcesWithCompleteListing` for snapshot feeds.
