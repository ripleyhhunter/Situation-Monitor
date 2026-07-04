# Situation Monitor — Full Assessment

**Reviewed:** 2026-07-03 · branch `master` @ `80a600d` (clean, matches `origin/master`)
**Method:** static reading + build/test/lint/type-check runs + live API probes, across 8 dimensions, with every medium-and-up finding re-checked by an independent adversarial verifier (56 confirmed, 11 downgraded to partial, 0 refuted). Confidence and severity are the post-verification values.

---

## Executive summary

Situation Monitor is a genuinely well-architected personal project that has drifted out of sync with itself. It aggregates ~22 real-time public data sources (Fire/EMS, traffic, crime, weather, air quality, aircraft, news, webcams) for two regions (DC/DMV and Boise) onto a Leaflet map, streaming to a SvelteKit SPA over SSE. The **region-pack design is the standout**: the aggregator iterates fetcher arrays with almost no hardcoded region knowledge, expensive work is gated on demand (PulsePoint scraping only runs with connected clients, OpenSky only when a client opts in), and failure isolation is consistent (fetchers never throw, Redis degrades to an in-memory map, rate limiting fails open). For a solo project this is a well-thought-out core.

The problem is that a **May 2026 multi-region refactor landed in the code but not everywhere it needed to**, and there is **no CI safety net to catch the gaps**. The single GitHub Actions workflow builds only the frontend — it never type-checks, tests, lints, or builds the backend. As a result:

- **The backend build is red on `master`** (`tsc` fails at `cache.ts:113`) and nobody's tooling noticed.
- **The public GitHub Pages site is dead** — it's hardwired to an ephemeral Cloudflare quick-tunnel hostname that no longer resolves (NXDOMAIN), so the deployed dashboard renders empty.
- **Two whole data feeds silently return nothing** (MD CHART incidents, PG County crime) and are logged as "success," so `/api/health` shows green.
- **The Boise region is half-broken**: its Fire/EMS incidents geocode against a DC-only bounding box (wrong locations), its crime layer flip-flops on/off every 10–15 minutes, and its Fire/EMS incidents are hidden by a DC-only jurisdiction filter.
- **A real XSS sink** exists: community-editable OpenSky aircraft metadata is interpolated unescaped into Leaflet popups on the public site.
- **Several unbounded-growth paths** will degrade a 24/7 process (cleared incidents are never deleted, server- or client-side).

None of this is fatal and the fixes are mostly small and local — but the project is currently in a state where the parts that *look* healthy (green CI, passing tests, a live-looking Pages URL) are the parts hiding the breakage.

**The five things that matter most, in order:**

1. **Add a CI quality gate** (backend `tsc --noEmit`, `vitest run`, lint, svelte-check). This is the root cause that let everything below rot silently, and it's ~15 lines of YAML.
2. **Fix the backend build** (`cache.ts:113`, a one-line type annotation) so a gate can go green.
3. **Fix or retire the deployment** — the Pages site is dead; decide between a stable tunnel (named Cloudflare Tunnel / Tailscale Funnel) and fully-local.
4. **Repair the silent-outage class**: MD CHART incidents, PG crime, the empty-snapshot cross-clear hole, and the "swallow errors → return `[]`" pattern that hid them.
5. **Fix the region-refactor gaps**: DC-hardcoded geocache, Boise crime flip-flop, DC-only jurisdiction filter, and the SSE initial-snapshot shape bugs.

**Overall health: fair, with an excellent foundation.** The architecture would earn a strong grade; the current *operational state* would not. Most of the gap is one CI job and a day of focused fixes away.

---

## Dimension weighting

| Dimension | Weight here | Why |
|---|---|---|
| Correctness / edge cases | **Highest** | This is a data-aggregation dashboard; wrong/stale/missing data is the core failure mode, and it's where most confirmed bugs are. |
| Build / tooling / CI | **High** | The absence of a backend gate is the *root cause* that let correctness bugs ship. |
| Architecture | High | Central to the project and genuinely its strength; worth crediting precisely. |
| Product fit / deployment | High | The public artifact is currently dead; the deployment model is the weakest product link. |
| Security | Medium | Real issues (XSS, tunnel exposure) but small blast radius: public data, one home machine, no credentials in the browser origin. |
| Testing | Medium | Backend has a real (if narrow) suite; frontend has none; one "test" is a live E2E. |
| Docs / hygiene | Medium | Drift wastes the owner's own future hours more than it blocks anyone. |
| Performance | Lower | Matters at the margins (marker churn, rebroadcast storms) but the app isn't under load. |

---

## Findings by dimension

Severity: **critical / high / medium / low / info**. Confidence: how far the claim was traced. Where verification changed the reviewer's call, the corrected value is shown and the reason noted.

### 1. Architecture & backend services

**Verdict: strong design, several real runtime bugs.** Clean region-pack layering, resource-aware polling, consistent failure isolation. The bugs are concentrated in lifecycle and multi-region edge cases.

**Strengths**
- Region-agnostic aggregator: iterates `allRegions` fetcher arrays, schedules per-region jobs only where fetchers exist, adding a region is a contained change (`aggregator.ts:156-237`, `regions/index.ts`).
- Demand-gated expensive work: PulsePoint scraping only when SSE clients connected; OpenSky only when a client opted in (`aggregator.ts:217-234`).
- Failure isolation: `BaseFetcher.fetch()` never throws, serves stale cache on error with retry/backoff/timeout; scheduler wraps every handler in try/catch (`fetchers/base.ts:30-134`, `scheduler.ts:30-42`).
- Graceful Redis degradation to in-memory cache; rate limiter fails open — the app runs fine with Docker/Redis absent, matching how it's actually run.
- Good operational visibility via `/api/health` (scheduler status, client count, Redis state, heap).

**Findings**

- **[HIGH, high] Cleared incidents are never evicted — unbounded Map growth.** `aggregator.ts:500` (`cleanupStaleIncidents`) and the cross-clear at `:464-474` only flip `status` to `'cleared'`; there is no `incidents.delete` anywhere in `packages/backend/src`. `database.ts` and Redis persistence (`persistIncidents`, `:149`) re-serialize the ever-growing array on every change. A 24/7 process accumulates every incident ever seen (DC+MoCo+PG crime kept 30 days then retained forever) until restart. *Fix: delete `status !== 'active'` entries older than a grace period; persist only actives.*

- **[HIGH, high] SSE initial dump sends the wrong `weather:current` shape, omits news, omits aircraft `regionId`.** `events.ts:49` sends `data.currentWeather`, which is a `Record<RegionId, …>` (`aggregator.ts:43,538-549`), but the client's `setCurrentWeather` (`weather.ts:11-14`) keys by `weather.regionId` — `undefined` on a record — so initial weather lands under `"undefined"` and never displays until the next *change-gated* broadcast (which may be hours). News is never sent in the dump at all; aircraft is sent without `regionId`. New clients show no current weather and an empty news panel on every load/reconnect. *Fix: in the dump, emit one `weather:current` and one `news:update` per non-null region, and group aircraft by `regionId`.*

- **[HIGH, high] Geocache is DC-hardcoded but drives the region-generic PulsePoint fetcher.** `geocache.ts:208` force-appends `", Washington, DC"` and `:176/:221-231` reject any result outside a DC bounding box. Boise Fire/EMS incidents (`regions/boise.ts` wires a PulsePoint agency) therefore never geocode — they fall back to hash-jittered positions around the Boise center, or a Boise street that also exists in DC pins a `regionId:'boise'` incident at DC coordinates and caches it 30 days. *Fix: parameterize the geocache with the region's city/state suffix and bbox (both already in `RegionPack`).*

- **[MEDIUM, high] Rate limiter: non-atomic read-then-set, TTL reset on every hit, single shared bucket behind the tunnel.** `rateLimit.ts:35` does GET then fire-and-forget SET(current+1) with no atomic INCR, and every allowed request re-arms the full 60s TTL. There is no `trust proxy`, so behind cloudflared every visitor is `127.0.0.1` — one global bucket (100 API/min, 10 SSE/min for *everyone*). A slow legitimate client (1 req/40s) accumulates to a 429 over ~66 min; one visitor's reconnect loop 429-locks SSE for all. *Fix: Redis `INCR`+`EXPIRE NX` (or fixed-window memory counter); set TTL only on key creation; `trust proxy` + key on `CF-Connecting-IP`.*

- **[MEDIUM, high] Cross-clear never fires on an empty snapshot.** `aggregator.ts:436` early-returns on an empty batch and the cross-clear derives its source from `newIncidents[0]?.source`, so when a complete-listing feed (MD CHART, dc-traffic, WMATA, AlertDC) goes from N incidents to 0, the N stay `'active'` until the 24h age sweep. This contradicts the `regions/types.ts:49` contract "absence implies cleared." *Fix: pass the source into `processIncidents` and run cross-clear even for an empty batch.*

- **[MEDIUM, medium] Scheduler has no overlap guard.** `scheduler.ts:30` `await`s the handler only for error logging; node-cron fires on every tick regardless of prior completion. A slow OpenSky (up to ~93s with retries) against a 5s-per-region cron stacks up to ~19 concurrent fetches — burning the very quota the client-gating protects. *Fix: per-task in-flight flag; skip or queue-one.*

- **[MEDIUM, high] `database.ts` is an in-memory Map; docs claim SQLite; `better-sqlite3` is a dead native dependency.** No source imports it (my grep for `sqlite` in `src` returned nothing); it only adds a native compile step to every install. CLAUDE.md/README describe "SQLite persistence." *Fix: remove `better-sqlite3` and correct the docs, or actually implement persistence.*

- **[MEDIUM, high] `cache.ts` memoryCache and geocache Map grow without eviction.** `cache.ts:144` always writes the memory map even when Redis is connected; the only prune is a narrow `get()` path when Redis is down. Geocache's module Map (`geocache.ts:18`) has no eviction and stores each address twice (raw + cleaned). Slow unbounded heap growth. *Fix: periodic expiry sweep (unref'd interval); cap/LRU the geocache.*

- **[LOW ▼ (was medium), high] Graceful shutdown fires async `aggregator.shutdown()` without awaiting.** `index.ts:60` discards the promise before `process.exit(0)`. *Verification downgrade:* Playwright installs its own SIGINT/SIGTERM handlers by default, so Chromium is not actually orphaned on Ctrl+C — the residual issue is the un-awaited cleanup and a `TypeError` if a signal arrives before `server` is assigned (`index.ts:88`). *Fix: `await aggregator.shutdown()`; guard `if (server)`.*

- **[LOW ▼ (was medium), high] `config.pollIntervals` / `cacheTtl` can never be overridden — hardcoded to `{}` before zod parsing (`config.ts:71`).** The configurable-interval design is dead; env tuning silently no-ops. *Verification downgrade:* the "invalid cron throws at startup" latent bug was refuted (node-cron 3.0.3 normalizes the boundary expressions). *Fix: read `POLL_INTERVAL_*` env into `rawConfig`, or delete the dead knobs.*

- **[LOW, info] Minor:** `getAll()` hardcodes region ids with no-op spread logic (`aggregator.ts:539`); SSE `broadcast` dead-client cleanup is unreachable and it hardcodes `Access-Control-Allow-Origin: *` overriding prod CORS on `/api/events` (`sse.ts:95`); `scheduleInterval`/`nextRun` are dead code.

### 2. Data fetchers — DC region

**Verdict: clean base class, two live-verified total outages, several systemic correctness gaps.**

**Strengths**
- `BaseFetcher.httpGet` centralizes AbortController timeout + backoff retries + stale-cache fallback (`base.ts:88-134`).
- `dc-traffic.ts` timestamp parsing is genuinely defensive (field-name casings, epoch heuristics, sanity windows; drops undated rows rather than defaulting to now).
- Geocoding respects OSM policy (1.1s serialized rate limit, Redis-persisted, stable hash fallback).
- `moco-crime.ts` filters the dataset's known 0.0 lat/lng "null island" rows.

**Findings**

- **[HIGH, high] MD CHART incidents read the wrong response envelope — traffic events/closures never load.** `mdchart-incidents.ts:76` looks for `.events`/`.closures`; both endpoints actually return `{data:[…]}` (verified live). Every poll returns `[]` logged as success — half the region's traffic coverage is permanently absent with zero errors. *Fix: parse `data` from both endpoints; treat a missing envelope as an error, not `[]`.*

- **[HIGH, high] PG County crime query is HTTP 400 on every poll — PG crime never loads.** `pg-crime.ts:56` sends an `MM/DD/YYYY` literal against a text column; the live endpoint returns `400 query.soql.type-mismatch` (verified). Even if fixed, the date parser at `:88` would throw on the real ISO format. *Fix: ISO date literal in `$where` (as `moco-crime` does), parse `record.date` directly, and validate `parseFloat` coords (`'0.0'` is truthy).*

- **[HIGH, high] Cross-clear never runs on an empty snapshot** — see the architecture section; the most common transition (N→0) leaves stale incidents up to 24h.

- **[MEDIUM, high] Twitter fetcher stamps `source: 'alertdc'`, so AlertDC and Twitter cross-clear each other.** `dcfireems-twitter.ts:217` uses `'alertdc'` as its source; both are in `sourcesWithCompleteListing` and run 2-min crons, so each AlertDC poll clears all Twitter incidents and vice-versa — active emergency alerts flicker. Dormant only because the paid token is likely unset. *Fix: give Twitter its own source and keep it out of complete-listing.*

- **[MEDIUM, high] ShotSpotter incidents flip-flop cleared↔active forever.** `dc-shotspotter.ts:130` always stamps `status:'active'` with months-old timestamps and `updatedAt = now`; the 10-min sweep clears all ~100 (past the 24h default), the 5-min cron resurrects them — constant SSE/DB churn and blinking markers. *Fix: add a long `expirationMs` entry or stop resurrecting; derive `updatedAt` from the feed's EDITED field.*

- **[MEDIUM, high] Normalizers stamp `updatedAt`/`lastUpdated` with wall-clock now → full rebroadcast every poll.** `dc-crime.ts:104` (and siblings) means every crime/camera record re-detects as "changed" once the cache TTL lapses: thousands of SSE `incident:update` events and a full Redis persist per cycle for data that didn't change. *Verification note:* the impact's "SQLite upserts" phrasing is wrong (the DB is in-memory), but the rebroadcast storm is confirmed. *Fix: derive `updatedAt` from feed fields or compare content.*

- **[MEDIUM, high] PulsePoint IDs are `hash(address+type)` — collisions and resurrection.** `pulsepoint.ts:433`/`:309` dedup by address alone; two simultaneous same-address calls collapse to one marker, and a new call weeks later at the same address+type resurrects an old cleared incident. *Fix: fold dispatch time into the id; dedup on address AND type.*

- **[MEDIUM, medium] PulsePoint browser contexts leak on failure; a crashed browser is never relaunched.** `pulsepoint.ts:134` creates a context whose handle is discarded; the failure path closes only the page (contexts aren't closed by `page.close()`), leaking one per failed fetch every 2 min. `getBrowser` checks only `!this.browser`, not `isConnected()`. *Fix: close the context on failure; relaunch when disconnected.*

- **[MEDIUM, medium] PulsePoint time parsing: midnight rollover → future timestamps; no `timezoneId` pinned.** `pulsepoint.ts:523` stamps scraped wall-clock onto today's date in server-local time; "11:55 PM" scraped at 12:10 AM lands ~23.75h in the future and evades the 24h sweep for ~2 days. *Fix: subtract a day if the time is ahead of now; set `timezoneId` on the context.*

- **[MEDIUM, high] AlertDC and Twitter use raw `fetch()` with no timeout.** `alertdc.ts:24`, `dcfireems-twitter.ts:119` bypass `BaseFetcher.httpGet`'s 30s AbortController; a hung TCP connection stalls the feed indefinitely while new 2-min crons pile up. *Fix: add AbortController, or an `httpGetText` helper on BaseFetcher.*

- **[MEDIUM, high] `dc-traffic`: one failed layer makes the snapshot partial, and cross-clear then wipes the survivor's counterparts.** `dc-traffic.ts:50` swallows per-layer errors; a transient Road Blocks failure while Road Closures succeeds marks every road-block incident cleared, resurrected next poll. *Fix: throw if any sub-fetch fails (serve stale) rather than returning a partial snapshot.*

- **[LOW ▼ (was medium), high] AlertDC `pubDate` parsed in server-local time though the feed emits US/Eastern.** `alertdc.ts:319` `new Date()` on a zone-less Eastern string skews every timestamp by the host offset (worse on Mountain-time Boise host). Same class in `pg-crime` (date-only as UTC midnight). *Fix: parse explicitly and convert from `America/New_York`.*

- **[LOW, various] Silent-empty pattern** (fetchers catch → return `[]` → recorded as success, defeating stale-cache and health — this is *how* the MD CHART bug stayed invisible); PulsePoint text-parser noise-line boundaries; OpenMHz is a dead placeholder always returning `[]` while docs list it live; WMATA alerts all pinned to DC center; DC cameras all link to one generic WeatherBug page.

### 3. Data fetchers — shared + Boise region

**Verdict: contract is genuinely multi-region; the Boise crime path is the weak spot.**

**Strengths**
- Every shared fetcher (NWS, Open-Meteo, AirNow, OpenSky, News) is constructor-parameterized with region config and region-suffixed cache keys; **no fetcher imports the `activeRegion` global** (CLAUDE.md's claim that some do is stale — the migration is actually complete).
- OpenSky OAuth2 lifecycle is well done: one shared module-level token, 60s expiry buffer, graceful anonymous fallback, 30-day metadata cache with 404 negative-caching.
- `news.ts` isolates per-feed errors so one dead RSS feed can't sink the batch.
- ITD WZDx defensively bbox-filters the statewide feed and wraps date parsing so malformed dates can't throw.

**Findings**

- **[HIGH, high] The entire Boise crime layer flip-flops cleared↔active every 10–15 min.** `bpd-crime.ts:110` stamps `updatedAt = now`; the live BPD feed currently lags **33 days**, so *all* ~1,600 records exceed the 30-day expiry (`aggregator.ts:491`) and the 10-min sweep clears the whole layer, the 15-min cron restores it — ~1,600 `incident:clear` + ~1,600 `incident:update` every cycle. Even at normal ~9-day lag the >30-day tail flip-flops, and `updatedAt:now` rebroadcasts all 2,000 regardless. *Fix: derive `updatedAt` from feed fields; exempt complete-listing/known-lagging sources from age cleanup or widen the window.*

- **[MEDIUM, high] BPD crime IDs collide — 21% of records share a DRNumber.** `bpd-crime.ts:100` keys on `DRNumber`, but the layer is per-charge (verified: 418/2000 duplicate rows, 375 multi-charge incidents); later rows overwrite earlier ones, so ~21% of records never appear and which charge shows is arbitrary. *Fix: append `OBJECTID`/`ChargeID` to the id, or aggregate charges per DRNumber.*

- **[MEDIUM, high] Aircraft cron fetches OpenSky for ALL regions whenever ANY client wants aircraft.** `aggregator.ts:229` gates on a region-blind `anyClientWantsAircraft()`; with two regions at 5s, 1,440 authed req/hr drains the 4,000-credit/day quota in <3h (anonymous 400 in ~17 min), half of it for a region nobody's viewing. *Fix: track wanted region(s) in `ClientPreferences` and gate per-region.*

- **[MEDIUM, high] ITD work zones older than 24h blink out ~1 min every 10 min.** `itd-wzdx.ts:122` — the 24h default sweep clears long-running zones (the normal case), re-added next traffic cron, despite `itd-wzdx` being in `sourcesWithCompleteListing`. *Fix: add to `expirationMs`, or exempt complete-listing sources from age cleanup.*

- **[MEDIUM, high] `findRelatedNews` matches on generic substrings.** `news.ts:183` links any article sharing a ≥5-char word or a street-type token ('police' matches every fire/police incident; 'street' relates everything) — the related-news feature returns mostly noise. *Fix: require multi-token/proximity matches; drop generic tokens.*

- **[LOW ▼ (was medium), high] AirNow timestamp mixes UTC date parse with server-local `setHours`, ignoring `LocalTimeZone`.** `airnow.ts:117` can stamp a 2 PM MDT observation as the previous day. *Verification note:* downgraded because there is currently no "observed at" display consuming it — latent, not user-visible today. *Fix: build from `DateObserved`+`HourObserved`+`LocalTimeZone`.*

- **[LOW/info] NWS zone-fallback dedup compares URL-form vs URN-form ids (never matches) and drops `status=actual`; Boise `areaKeyword: 'star'` substring-matches "started"; OpenSky token/metadata fetches have no timeout; `ItdWzdxFetcher` hardcodes `regionId 'boise'` and an unsuffixed cache key; static Boise webcams rebroadcast all 13 every 5 min via always-fresh `lastUpdated`.**

### 4. Frontend state layer

**Verdict: architecturally sound; the SSE handshake and reconnect behavior are the real problems.**

**Strengths**
- Region switching is clean: all stores are region-keyed or region-filtered via derived stores, the backend broadcasts every region to every client, so switching needs no SSE re-subscribe and no store clearing — both regions stay warm.
- Backend/frontend types are genuinely field-by-field in sync (`Incident`, `Camera`, `WeatherAlert`, `Aircraft`, `CurrentWeather`, `NewsItem`, unions).
- SSE reconnect avoids listener leaks (fresh EventSource per reconnect, exponential backoff with 30s cap, visibility-aware).
- Immutable store updates throughout; localStorage reads are validated against an allowlist.

**Findings**

- **[HIGH, high] No state reconciliation on SSE reconnect — cleared incidents remain ghost markers.** `sse.ts:39` attaches handlers with no refetch or reset on reconnect; the reconnect snapshot sends only *active* incidents (`events.ts:25-28`), backend writes no `id:` fields so Last-Event-ID replay is impossible, and clear paths skip already-cleared incidents so `incident:clear` is never re-sent. Laptop sleep / network blip / backend restart → incidents cleared during the gap stay "active" on the map until a hard reload. This is wrong data on a situational-awareness dashboard whose normal resume path *is* reconnect. *Fix: on reconnect, clear stores before the snapshot replays, or emit a `snapshot:complete` marker and prune, or refetch `GET /api/incidents`.*

- **[HIGH, high] SSE reconnection permanently gives up after ~3 min of backend downtime while the tab stays visible.** `sse.ts:147` stops after 10 attempts (~181s) and the visibilitychange handler only fires on a *transition* to visible, so a continuously-open tab never retries. Given the deployment (frontend on Pages, backend on the owner's machine), any overnight sleep/restart leaves the dashboard permanently disconnected showing stale data. *Fix: never stop retrying (keep the 30s cap); reset attempts on a visibility-triggered connect.*

- **[MEDIUM, high] Client-side incidents Map is never pruned.** `incidents.ts:25` `clearIncident` keeps the entry as `'cleared'`; `removeIncident`/`clearAllIncidents` have no callers. A 24/7 tab accumulates every incident ever received across both regions, with increasingly expensive full-Map copies/scans on every SSE message. *Fix: delete on clear (or sweep older-than-window).*

- **[MEDIUM, high] Aircraft-preference sync promised in comments was never implemented.** `sse.ts:46` opens EventSource with no aircraft param and never syncs preference after `connected`; backend defaults every client to `wantsAircraft=true` (`events.ts:13,19`), overriding the quota-saving `false`. So OpenSky is polled continuously whenever any tab is open despite the UI default being OFF, and an explicit OFF is reset to ON on every reconnect. *Fix: send the current `showAircraft` after `connected` and on every reconnect (or `?aircraft=` on the URL).*

- **[MEDIUM, high] Current-weather / news / aircraft initial-snapshot shape bugs** — see the backend `events.ts` finding; from the client side, current weather is dropped, news is empty up to 5 min, and initial aircraft lands under `"undefined"`.

- **[LOW/info] `incidentsByType` throws on an unknown `IncidentType` from a newer backend** (version-skew is routine here — Pages auto-deploys, backend is manual); no timezone handling for absolute times (a DC viewer on Boise sees times in their own zone, unlabeled); page title hardcoded `"Situation Monitor - DC"`; `notifications.ts` is entirely dead code; duplicated distance math in `geolocation.ts` vs `utils/geo.ts`; time-windowed derived stores don't recompute on clock ticks (24h count drifts stale in quiet periods).

### 5. Frontend UI components

**Verdict: good Svelte hygiene; one real XSS class and pervasive full-layer Leaflet rebuilds.**

**Strengths**
- Virtually all third-party text renders through auto-escaping Svelte expressions; **no `{@html}` anywhere**.
- Solid lifecycle: `map.remove()` on destroy, `<svelte:window>` auto-cleanup, Escape/backdrop close paths, aria-labels.
- YouTube embeds built only from a regex-extracted video ID, never the raw scraped URL; external links use `rel="noopener noreferrer"`.
- Keyed `{#each}` blocks throughout for stable reconciliation.

**Findings**

- **[HIGH, high] XSS: OpenSky aircraft metadata and callsign interpolated unescaped into Leaflet popup HTML.** `MapContainer.svelte:609` (`bindPopup(popupContent)`) with `popupContent` built from `meta.manufacturer/model/operator/owner` and `plane.callsign` (`:576-595`); Leaflet assigns string content via `node.innerHTML`. OpenSky's aircraft metadata is editable by any registered user, and callsigns come from spoofable ADS-B — a crafted record executes arbitrary JS in the `ripleyhhunter.github.io` origin when a viewer clicks the marker. Blast radius is small (no credentials in that origin) but it enables defacement/phishing of viewers. *Fix: an `escapeHtml()` on every interpolated field, or build popup DOM with `textContent`.*

- **[MEDIUM, high] XSS: Nominatim `display_name` interpolated unescaped into the search popup** (`MapContainer.svelte:312`), which auto-opens — a poisoned OSM name in the search viewbox is enough. Same one-helper fix.

- **[MEDIUM, high] Aircraft layer fully rebuilt every update tick — open popups destroyed every ~5–10s.** `MapContainer.svelte:515` `clearLayers()` + rebuild on every `aircraft:update`; a clicked aircraft popup is force-closed at the next tick and markers flicker/reset rotation. *Fix: diff by `aircraft.id`, `setLatLng`/`setIcon` on existing markers.*

- **[MEDIUM, high] Incident cluster group cleared and rebuilt on every store update** (`MapContainer.svelte:327`) — with hundreds of incidents, every SSE event re-clusters the whole set (flicker, lost spiderfy). On connect with N incidents this is ~N²/2 marker creations (visible jank on load/reconnect). *Fix: maintain `Map<id, marker>`; add/remove/update only the delta (`addLayers`/`removeLayers`).*

- **[MEDIUM, high] "Back to Dashboard" on the error page ignores `BASE_PATH` → 404 on Pages.** `+error.svelte:98` hardcodes `href="/"`; on `github.io/Situation-Monitor/` that lands on the org root. *Fix: `import { base } from '$app/paths'`.*

- **[MEDIUM, high] Boise PulsePoint incidents mapped to `'dc'` jurisdiction — DC-only filter silently hides Boise Fire/EMS.** `filters.ts:26` maps `source:'pulsepoint'` → `'dc'` unconditionally; unchecking "Washington, DC" removes every Ada County Fire/EMS incident. *Fix: make jurisdiction options region-aware; key on `incident.regionId`.*

- **[LOW/info] NWS alert popup is the same unescaped sink (low reachability — trusted gov source); heatmap toggle hides crime markers even if `leaflet.heat` failed to load; Reset Filters desyncs the server aircraft preference; search-marker removal timers stack; region-centering control shows a stale label after switch; Leaflet/MarkerCluster CSS loaded from unpkg CDN (no SRI); hardcoded "DC" branding in `app.html`.**

### 6. Security

**Verdict: reasonable for a personal project; issues cluster around the public tunnel; small blast radius.**

**Strengths**
- **No secrets ever committed** — `.env` is absent from all git history (`git log --all -- .env` is empty), `.env.example` is a clean template, keys flow only through zod-validated env config.
- **No SSRF surface** — no route proxies a user-supplied URL; geocoding goes browser→Nominatim directly.
- SQL injection is moot (in-memory Map); `{@html}` avoided; localStorage validated against an allowlist.
- Defense-in-depth scaffolding many solo projects lack: prod CORS allowlist, per-route rate limiters, structured error handler, safe 100kb `express.json()` default.

**Findings**

- **[MEDIUM, medium] Rate limiting is one shared bucket behind the tunnel, non-atomic, fail-open** — see the architecture section. Trivial ~2 req/s full-site DoS for other viewers; fast bursts bypass it entirely.
- **[MEDIUM, high] Third-party data interpolated unescaped into Leaflet popups (XSS)** — the OpenSky/Nominatim sinks above; called out here as the one genuine injection vector.
- **[MEDIUM ↔ (partial), high] Anyone with the tunnel URL can force Playwright scraping and drain OpenSky quota; SSE clients are uncapped; `clientId` is guessable.** `events.ts:76` `/preferences` acts on any posted `clientId` (weak `Date.now()+Math.random()` id); a held SSE connection keeps Chromium scraping every 2 min; `wantsAircraft=true` default drains OpenSky. *Fix: cap SSE clients, `crypto.randomUUID()` ids, bind preference updates to the caller's own connection, daily OpenSky budget guard.*
- **[LOW, medium] Backend almost certainly runs dev mode on the public tunnel** → wildcard CORS + stack traces with `C:\Users\Ripley\…` paths returned to any caller; SSE hardcodes `ACAO:*` even in prod. *Fix: `NODE_ENV=production` (after the build is fixed) + `CORS_ORIGINS`; gate stack traces; drop the hardcoded SSE ACAO.*
- **[LOW, high] `npm audit`: 6 prod vulns (1 high)** — but the express/qs/path-to-regexp ones look unreachable with this app's `/` and `/:id` routes and default query parsing. *Fix: `npm audit fix` (non-breaking); schedule node-cron 3→4 separately.*
- **[LOW/info] The tracked `*.db-wal` (4.2MB) republishes scraped public-source incident data** (not a secret, but repo bloat + PulsePoint ToS optics); the tunnel URL is in the public workflow; no `x-powered-by` disable / security headers (minor — JSON-only surface).

### 7. Testing & build

**Verdict: real but narrow backend suite; frontend has none; CI gates nothing that matters; build is red.**

**Strengths**
- The 5 non-PulsePoint backend files (32 tests) are genuine isolated unit tests — cache/node-cron/logger/aggregator mocked, routes via supertest, deterministic, <400ms.
- `BaseFetcher` (the shared path for all fetchers) has thorough contract coverage including stale-cache-on-error and error-with-no-cache.
- The exact CI command (frontend build) builds cleanly; `deploy.yml` itself is modern (npm ci, cached setup-node, OIDC Pages, concurrency).
- `vitest.config.ts` has sensible coverage config; `config.test.ts` properly isolates env with `vi.resetModules()`.

**Findings**

- **[HIGH, high] Backend build is broken on `master`.** `npm run build` → `cache.ts(113,34): error TS2345` (I reproduced this in my own build run). *Verification note:* the reviewer's "TS 5.9.3 regression / can't produce dist" was **downgraded to medium** — the code never type-checked under any `^5.5.4` version (it's a genuine type error, not drift), and because `tsconfig` lacks `noEmitOnError`, `tsc` still *emits* `dist/`, so `npm start` actually works. The real impact is: the build exits non-zero → any CI gate fails, and the error is one an editor surfaces constantly. *Fix: `withTimeout<string | null>(this.redis.get(key), …)` or type `redis` properly.*

- **[HIGH, high] CI has zero quality gates.** `deploy.yml` runs only `npm ci` + frontend build. On `master` right now: backend `tsc` fails, both workspaces' lint fails, svelte-check fails — all with green CI. *Fix: a job running backend `tsc --noEmit`, `vitest run` (excluding the live PulsePoint test), eslint both workspaces, svelte-check.*

- **[MEDIUM, high] `pulsepoint.test.ts` is an assertion-free live E2E in the default suite.** `:66` hits `https://web.pulsepoint.org` with real Chromium, 120s timeout, zero `expect()` (eslint flags the unused `expect`); it never imports the production scraper, so it protects nothing while making the suite depend on a third-party site. *Fix: move out of the default glob (`.e2e.ts` / `describe.skipIf`); write real unit tests against recorded DOM fixtures.*

- **[MEDIUM, high] The test run mutates git-tracked screenshots; 11 PNGs (~1.6MB) of live scrape output are committed.** `pulsepoint.test.ts:12` hardcodes `C:/Users/Ripley/…` and overwrites tracked PNGs (this happened during the review — I restored them). *Fix: gitignore + `git rm --cached test-screenshots/`; derive the dir from `os.tmpdir()`.*

- **[MEDIUM, high] `npm run test` hangs — backend script is bare `vitest` (watch mode).** `package.json:11`; under turbo it blocks forever. *Fix: `"test": "vitest run"` (+ separate `test:watch`).*

- **[MEDIUM, high] Lint broken in both workspaces (6 + 7 errors)** so the repo-wide `lint` always fails and provides zero signal (it's already flagging a real constant-truthiness bug that's lost in the noise). **svelte-check fails with 21 errors / 1 warning** (mostly Leaflet type imports + possibly-null `L` derefs in MapContainer). *Fix: clear the errors, then gate both in CI.*

- **[MEDIUM, high] Riskiest backend logic has zero coverage** — `processIncidents`/`cleanupStaleIncidents`, cache Redis→memory fallback, SSE lifecycle, and all fetcher normalizers are untested; the one file that already has a bug (`cache.ts`) is among them.

- **[LOW/info] Two incidents-route tests can't fail against no-op implementations; `scheduleInterval` silently halves the WMATA rate; frontend has zero tests and no runner.**

### 8. Docs, hygiene & product fit

**Verdict: docs lag the code by one major refactor; the deployment story is the biggest product gap.**

**Strengths**
- `.env.example` is the best doc in the repo — accurate on the region system and graceful degradation.
- Real in-code extension docs (`regions/index.ts` "To add a region" matches reality; CLAUDE.md's "Adding a New Data Source" checklist is still accurate).
- CLAUDE.md carries genuinely useful operational gotchas (PowerShell `rm -rf`, single-test vitest, CORS/PUBLIC_API_URL wiring).
- Dependency hygiene: lockfile committed, `engines` and `packageManager` pinned.

**Findings**

- **[HIGH, high] Public Pages site is dead — hardcoded ephemeral quick-tunnel URL no longer resolves.** `deploy.yml:35` bakes `meters-chief-alien-experiences.trycloudflare.com` (NXDOMAIN, verified); the live site (title still "Situation Monitor - DC") calls it for every SSE/API request and renders empty. Quick tunnels mint a new hostname per restart, so this breaks every time and needs a commit to rotate. *Fix: named Cloudflare Tunnel or Tailscale Funnel with the URL in a repo variable (the workflow already uses that pattern for `PUBLIC_REGION`), or drop the Pages deploy and stay local.*

- **[HIGH, high] Backend production build fails type-check; no CI catches it** — duplicate of the build finding, called out because it blocks a real `npm start`.

- **[MEDIUM, high] README describes the pre-multi-region app** — no Boise/REGION, wrong source count (16 vs 22), missing `/api/news`, broken screenshot link, placeholder clone URL. First impression + owner's own future reference are materially wrong. *Fix: rewrite from current code.*

- **[MEDIUM, high] CLAUDE.md architecture claims are stale** — "aggregator iterates `activeRegion`", "19 fetchers registered in `aggregator.ts`" (it imports zero; `dc.ts`+`boise.ts` wire 22), `PUBLIC_API_URL=localhost:3000`. This file steers AI-assisted coding, so wrong claims actively mislead future sessions. *Fix: update Overview, Region Pack, fetcher table authority, endpoints, Pages section.*

- **[MEDIUM, high] No LICENSE file despite a README "MIT" claim** — the public repo is legally all-rights-reserved. *Fix: add a real MIT LICENSE or drop the claim.*

- **[MEDIUM, high] Tracked binary junk** — 4.2MB `situation-monitor.db-wal` + 32KB `-shm` and ~2MB of PlayWright PNGs are tracked despite `.gitignore` rules; scraper runs dirty the tree. *Fix: `git rm --cached` them; add `test-screenshots/` and `pulsepoint-*.png` to `.gitignore`.*

- **[MEDIUM, high] Fresh-clone gap: Playwright browser install is documented nowhere; Docker is overstated as required.** A stranger follows quick-start, everything appears to work, but Fire/EMS silently fails because Chromium was never installed (the failure is swallowed to `[]`, so even `/api/health` looks fine). *Fix: add `npx playwright install chromium` (or a postinstall); mark Redis optional-with-fallback; note `start-monitor.bat` is personal/untracked.*

- **[MEDIUM, high] `.env.example` documents dead vars and a geo-filter trap.** `PUBLIC_REGION_LABEL`/`PUBLIC_DEFAULT_ZOOM` are read nowhere; setting Boise coords in `PUBLIC_DEFAULT_LAT/LNG` silently filters out every MD CHART camera/incident (>80km) while doing nothing to the map. *Fix: delete dead vars; move the DC proximity anchor into the DC region pack.*

- **[MEDIUM, high] `scanner-api` branch: 1,618 lines of unpushed work stranded on this machine, 6 months diverged.** A substantial live-scanner feature exists only locally with no remote backup and heavy conflict with the multi-region rework. *Fix: `git push -u origin scanner-api` as a backup, or deliberately delete after confirming master's link-out panel is the intended direction.*

- **[LOW/info] `.gitignore` contradicts tracked reality** (CLAUDE.md and `.claude/settings.local.json` both ignored *and* tracked); version frozen at 1.0.0, zero tags; backend runs dev-mode wide-open CORS on the public tunnel.

---

## Cross-cutting themes

Three root patterns generate most of the confirmed bugs:

1. **No backend CI gate.** Everything red on `master` (build, lint, type-check) is invisible because the one workflow only builds the frontend. Fixing this one thing changes the project's whole failure mode from "silent rot" to "caught at commit."

2. **"Swallow errors → return `[]`" everywhere.** Fetchers convert failures into empty successes, which defeats the (well-designed) stale-cache fallback and health reporting, and is precisely how two total feed outages (MD CHART, PG crime) stayed invisible. Letting `fetchFromApi` throw on real failures would surface them.

3. **The multi-region refactor is 90% done.** The core is clean and complete, but the last 10% left sharp edges: DC-hardcoded geocache, DC-only jurisdiction filter, region-blind aircraft gating, age-based cleanup that fights complete-listing feeds, and docs describing the old model. These are individually small and collectively make the Boise region roughly half-functional.

The `updatedAt = now` / cleanup-vs-complete-listing interaction also recurs across ShotSpotter, ITD, BPD, and normalizers — a shared "derive change/expiry from feed fields, not wall-clock" fix would calm several blinking-marker and rebroadcast-storm findings at once.
