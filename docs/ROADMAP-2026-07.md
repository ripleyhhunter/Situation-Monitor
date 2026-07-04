# Situation Monitor — Improvement Roadmap

> **Status (2026-07-03, branch `assessment-fixes`, 34 commits): every code item on this roadmap is done except the decisions below, and the full branch diff passed a fresh-context 16-agent adversarial review (its 6 confirmed findings — including two regressions the branch itself introduced — are fixed in the final commit).**
> - **Tier 0 complete** (build fix, CI gate, runnable tests, lint/check clean, binaries untracked).
> - **Tier 1 complete except 1.1** (both dead feeds fixed & verified live, cross-clear, reconnect + timer-stacking fix + heartbeat watchdog, snapshot, XSS, memory bounds).
> - **Tier 2 complete** (region-scoped geocache, churn fixes, jurisdiction filter, per-region OpenSky gating, related-news region + precision — all verified live).
> - **Tier 3 complete**: BPD id collisions (verified live: 233 unique ids), Twitter source separation, dc-traffic partial snapshots, raw-fetch timeouts, AlertDC Eastern-time parsing (DST-verified), AirNow site-local timestamps, scheduler overlap guard (verified live), rate limiter atomic fixed-window (behaviorally verified), Leaflet diff-not-rebuild (browser-verified), PulsePoint hardening (context leak, browser relaunch, timezone-pinned parsing with midnight rollover, time-in-id identity, throw-on-failure — verified with a full live scrape: 119 real incidents, zero future-dated timestamps).
> - **Tier 4 complete**: LICENSE, .gitignore/settings.local, .env.example, better-sqlite3 removed, CLAUDE.md + README rewritten, semver-compatible dep refresh, frontend vitest suite (11 tests) wired into CI alongside the 32 backend tests.
> - **Yours to decide**: 1.1 deployment (named tunnel / Tailscale / local-only), scanner-api branch fate, whether to commit ASSESSMENT.md/ROADMAP.md, the express-5 / vite-6 / node-cron-4 major migrations.

Ranked by **impact ÷ effort**. Effort is rough: **S** ≈ minutes–1h, **M** ≈ a few hours, **L** ≈ a day+. Each item cites the finding it resolves (see `ASSESSMENT.md`). Do them roughly top-to-bottom; the tiers are the real decision points.

The ordering logic: fix the *root cause* (no CI) and the things that make the project **look** healthier than it is (dead site, red build, silent outages) before the long tail of correctness polish. A green CI gate is first because it's what stops all of this from silently regressing again.

---

## Tier 0 — Stop the bleeding (do this first, ~half a day total)

These are individually tiny and collectively flip the project from "silently broken" to "known-good."

| # | Change | Effort | Impact | Finding |
|---|--------|:---:|--------|---------|
| 0.1 | **Fix the backend build**: annotate `withTimeout<string \| null>(this.redis.get(key), …)` at `cache.ts:113` (or type the `redis` field). | **S** | Unblocks every gate below and a real `npm start`. | Build broken (HIGH) |
| 0.2 | **Add a CI quality gate** — one workflow (or steps before deploy) running backend `tsc --noEmit`, `vitest run` (excluding the live PulsePoint test), eslint both workspaces, svelte-check. | **M** | This is the root-cause fix. Turns silent rot into commit-time failures. Do 0.1, 0.3, 0.4 first so it can go green. | CI zero gates (HIGH) |
| 0.3 | **Make tests runnable in CI**: backend `"test": "vitest run"`; move `pulsepoint.test.ts` out of the default glob (`.e2e.ts` or `describe.skipIf(!RUN_E2E)`). | **S** | `npm test` stops hanging; suite stops depending on a third-party site. | Watch-mode hang, live E2E (MEDIUM) |
| 0.4 | **Clear the lint / svelte-check errors** (6 + 7 eslint, 21 svelte-check — mostly unused vars, Leaflet type imports, possibly-null `L` derefs). | **M** | Lets 0.2 gate lint/types; surfaces the real constant-truthiness bug now lost in noise. | Lint/check broken (MEDIUM) |
| 0.5 | **Un-track binary junk**: `git rm --cached packages/backend/data/*.db-* packages/backend/test-screenshots/* packages/backend/pulsepoint-*.png`; add them to `.gitignore`; point the test screenshot dir at `os.tmpdir()`. | **S** | Stops repo bloat and tree-dirtying scraper runs; removes republished scraped data. | Tracked junk (MEDIUM) |

---

## Tier 1 — Fix what's actually broken for users (~1–2 days)

Real, confirmed, user-visible breakage. Highest impact-per-unit-effort after Tier 0.

| # | Change | Effort | Impact | Finding |
|---|--------|:---:|--------|---------|
| 1.1 | **Decide and fix the deployment.** Options: (a) named Cloudflare Tunnel / Tailscale Funnel with the URL in a repo variable; (b) drop Pages, run fully local. Either way, un-hardcode `deploy.yml:35`. | **M–L** | The public artifact is currently dead. This is the single most visible "is this project alive" signal. | Dead Pages site (HIGH) |
| 1.2 | **Fix the two silent feed outages**: MD CHART incidents (parse the `{data:[]}` envelope, `mdchart-incidents.ts:76`) and PG crime (ISO date in `$where` + parse ISO, `pg-crime.ts:56/88`). | **M** | Restores two advertised data feeds that return nothing today. | MD CHART, PG crime (HIGH) |
| 1.3 | **Stop swallowing fetcher errors** — let `fetchFromApi` throw on real failures so `BaseFetcher`'s stale-cache + health reporting work; reserve `return []` for genuinely empty feeds. | **M** | Systemic: this is *how* 1.2 stayed invisible. Future outages become visible in `/api/health`. | Silent-empty pattern (LOW, but root cause) |
| 1.4 | **Fix the empty-snapshot cross-clear hole** — pass the source into `processIncidents` and run cross-clear even for an empty batch (`aggregator.ts:436`). | **M** | Stale traffic/transit/alert incidents stop lingering up to 24h after a feed empties. | Cross-clear on empty (HIGH/MEDIUM) |
| 1.5 | **Reconnect reconciliation + never-give-up retry** (frontend `sse.ts`): on reconnect, clear stores before the snapshot replays (or refetch `GET /api/incidents`); drop the 10-attempt ceiling. | **M** | Kills ghost incidents after sleep/restart and the "permanently disconnected" state — critical for an always-open dashboard. | Reconnect ghosts + give-up (HIGH) |
| 1.6 | **Fix the SSE initial snapshot** (`events.ts`): emit one `weather:current` and one `news:update` per non-null region, and group aircraft by `regionId`. | **S–M** | New clients stop showing no weather / empty news / dropped aircraft on every load. | Snapshot shape (HIGH) |
| 1.7 | **Escape third-party data in Leaflet popups** — one `escapeHtml()` on aircraft metadata/callsign, Nominatim name, NWS fields (`MapContainer.svelte:312/425/609`). | **S** | Closes the one real XSS vector on the public site. | Popup XSS (HIGH/MEDIUM) |
| 1.8 | **Bound memory growth**: delete `status !== 'active'` incidents after a grace period, server-side (`aggregator.ts` cleanup + persist only actives) and client-side (`incidents.ts` `clearIncident` → delete). | **M** | Prevents slow degradation of the 24/7 process and long-lived tabs. | Unbounded incidents (HIGH ×2) |

---

## Tier 2 — Finish the multi-region refactor (~1 day)

Boise is roughly half-functional. These make it real.

| # | Change | Effort | Impact | Finding |
|---|--------|:---:|--------|---------|
| 2.1 | **Parameterize the geocache** with the region's city/state suffix + bbox (both already in `RegionPack`), instead of hardcoded DC (`geocache.ts:208/176`). | **M** | Boise Fire/EMS incidents get correct locations instead of hash-jittered / DC-mislocated pins. | DC-hardcoded geocache (HIGH) |
| 2.2 | **Fix the Boise crime flip-flop**: derive `updatedAt` from feed fields and exempt complete-listing / known-lagging sources from age-based cleanup (`bpd-crime.ts:110`, `aggregator.ts:487-493`). | **M** | Boise crime layer stops disappearing every 10–15 min and spamming ~3,200 SSE events/cycle. | BPD flip-flop (HIGH) |
| 2.3 | **Make the jurisdiction filter region-aware** and key the PulsePoint→jurisdiction mapping on `incident.regionId` (`filters.ts:26`). | **S–M** | Boise Fire/EMS stops being silently hidden by a DC-only filter. | Jurisdiction filter (MEDIUM) |
| 2.4 | **Gate aircraft fetching per-region**: track wanted region(s) in `ClientPreferences` (`aggregator.ts:229`, `sse.ts`). | **M** | Halves (or better) OpenSky quota burn; stops fetching for unviewed regions. | Aircraft all-regions (MEDIUM) |
| 2.5 | **Same cleanup-vs-complete-listing fix for ShotSpotter and ITD WZDx** (they blink the same way as 2.2). | **S** | Stops blinking markers + churn on two more layers. | ShotSpotter / ITD (MEDIUM) |
| 2.6 | **Route related-news through the incident's region** (`news.ts:39` → pass `incident.regionId`) and tighten `findRelatedNews` matching (multi-token). | **S–M** | Boise incidents stop matching DC news; related-news stops returning noise. | Related-news region + noise (MEDIUM) |

---

## Tier 3 — Correctness & robustness polish (pick as time allows)

Individually smaller impact; several share a fix.

- **Normalizer rebroadcast storm** — derive `updatedAt` from feed fields (REPORT_DAT/EDITED/etc.) so crime/camera polls stop re-flagging thousands of unchanged records (`dc-crime.ts:104` + siblings). *M — shares a fix with 2.2/2.5.*
- **PulsePoint hardening** — stable ids that fold in dispatch time; close leaked browser contexts on failure and relaunch a dead browser; fix midnight-rollover time parsing + pin `timezoneId` (`pulsepoint.ts`). *M.*
- **BPD crime id collisions** — append `OBJECTID` to the id (`bpd-crime.ts:100`). *S.*
- **Twitter source separation** — give the Twitter fetcher its own `source` so it stops cross-clearing AlertDC (`dcfireems-twitter.ts:217`). *S.*
- **`dc-traffic` partial-snapshot fix** — throw if any layer fails rather than returning a partial complete-listing snapshot (`dc-traffic.ts:50`). *S.*
- **Timeouts on raw `fetch()`** — AlertDC, Twitter, OpenSky token/metadata (add AbortController). *S–M.*
- **Timezone correctness** — AlertDC/AirNow/pg-crime parse zone-less strings in server-local time; parse against the region timezone. *M.*
- **Scheduler overlap guard** — per-task in-flight flag (`scheduler.ts:30`). *S.*
- **Leaflet diff-not-rebuild** — maintain `Map<id, marker>` for incidents and aircraft; add/remove/update deltas (`MapContainer.svelte:327/515`). Fixes cluster flicker, destroyed popups, and load-time jank. *M.*
- **Rate limiter** — atomic `INCR`+`EXPIRE NX`, `trust proxy` + `CF-Connecting-IP` if a tunnel stays (`rateLimit.ts`). *M.*
- **Error-page `BASE_PATH`** — `import { base } from '$app/paths'` (`+error.svelte:98`). *S.*
- **Shutdown** — `await aggregator.shutdown()` + guard `if (server)` (`index.ts:60`). *S.*
- **Unknown-IncidentType guard** in `incidentsByType` (`incidents.ts:65`) — prevents a store-graph crash on frontend/backend version skew. *S.*
- **Heartbeat staleness watchdog** (discovered during 1.5 verification) — a dead SSE stream behind a proxy dies silently without firing `onerror`; the client should force a reconnect when `lastEventTime` is older than ~3 missed heartbeats (~90s). *S.*

---

## Tier 4 — Hygiene & docs (low urgency, real payoff for future-you)

- **Add a LICENSE file** (MIT, matching the README claim) — the repo is legally all-rights-reserved without it. *S.*
- **Rewrite README** from current code — multi-region, region switcher, full endpoint table, 22 sources, REGION env vars, real/removed screenshot, real clone URL. *M.*
- **Update CLAUDE.md** — kill the stale `activeRegion` / "19 fetchers in aggregator.ts" / localhost claims; move fetcher-table authority to `dc.ts`/`boise.ts`. *S–M.*
- **Document Playwright install** (`npx playwright install chromium` or a postinstall); mark Redis optional; note `start-monitor.bat` is personal/untracked. *S.*
- **Clean `.env.example`** — delete dead `PUBLIC_REGION_LABEL`/`PUBLIC_DEFAULT_ZOOM`; move the DC 80km proximity anchor out of `PUBLIC_DEFAULT_LAT/LNG` into the DC region pack. *S.*
- **Resolve `.gitignore` contradictions** — un-ignore CLAUDE.md (it's deliberately committed), `git rm --cached .claude/settings.local.json`. *S.*
- **Decide `scanner-api`'s fate** — `git push -u origin scanner-api` as a backup, or delete after confirming master's link-out panel is the direction. It's 1,618 lines living on one disk. *S (but decide deliberately).*
- **Remove dead code** — `notifications.ts` (frontend, never imported), `openmhz.ts` placeholder, `scheduleInterval`/`nextRun`, `activeRegion` export, `better-sqlite3` dependency. *S.*
- **`npm audit fix`** (non-breaking) for the 6 prod advisories; schedule node-cron 3→4 separately. *S.*
- **Harden the public backend** (if the tunnel stays) — `NODE_ENV=production` + `CORS_ORIGINS`, `crypto.randomUUID()` client ids, cap SSE clients, bind `/preferences` to the caller's own connection, gate stack traces, drop the hardcoded SSE `ACAO:*`. *M.*

---

## Suggested first session

If you want a single high-leverage sitting: **Tier 0 in full** (build green + CI gate + runnable tests + clean tree), then **1.6 + 1.7** (SSE snapshot + popup escaping — both small, both high-impact). That leaves the repo with a working build, a gate that keeps it working, and two user-visible fixes — a clean base to tackle the deployment (1.1) and the feed outages (1.2–1.4) next.

I can start on any item with your sign-off — smallest sensible change first, one at a time. My recommendation is **0.1** (the one-line build fix) as the first commit, since it unblocks everything else and is trivially verifiable.
