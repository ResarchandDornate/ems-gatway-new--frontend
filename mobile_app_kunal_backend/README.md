# mobile_app_kunal_backend

The mobile app, rebuilt against the **NorthBound EMS Gateway** instead of UGX.

Mounted at `/k`. `mobile-app/` at `/m` is untouched — both builds share the
same design system and stylesheet, and differ only in where the numbers come
from.

```
npm run dev        # then open http://localhost:3000/k
```

It requires a reachable gateway; with none configured every request is refused and says so
on every screen. To point it at a real gateway, add this to `.env.local` —
these are documented here rather than in the repo's `.env.example` so this
build stays self-contained:

```sh
# Base URL of the gateway, no trailing slash. Tunnel or private-network host.
GW_BASE_URL=https://<gateway-host>

# Shared token required on every /api/gw request. Unset, the gate is open,
# which is right for local development and wrong for anything deployed:
# without it, publishing this route publishes an unauthenticated path into a
# live plant. It is a lock rather than a secret — the mobile client carries it
# — and it is not the customer authentication below.
GW_APP_TOKEN=

# Control endpoints are internal_admin and classified "never public customer
# UI". The proxy refuses every non-GET request unless this is exactly "true".
# Signing in is the one exception: it mints a token and touches no plant.
# GW_ALLOW_WRITES=false


# Where sealed history chunks are kept. Defaults to .data/history, which is
# ephemeral — set this to a persistent volume on any real deployment, or every
# release re-reads thirty days off the field board. See "Set HISTORY_DIR in
# production" below.
# HISTORY_DIR=
```

**There is no GW_USERNAME or GW_PASSWORD.** There used to be, and the proxy
logged in with them on every caller's behalf — which made every user of this
route indistinguishable from every other, since they all reached the gateway as
the same account.

Each person now signs in with their own gateway account and the proxy forwards
their bearer token unchanged. It holds no login of its own, so it cannot be
induced to read a plant the caller is not entitled to: the gateway decides that,
which is the only place the decision can honestly be made.

No `NEXT_PUBLIC_` prefix on any of the above — they are read server-side only.

---

## What changed from mobile-app/

| | `mobile-app/` (`/m`) | `mobile_app_kunal_backend/` (`/k`) |
|---|---|---|
| Backend | UGX, browser calls it directly | NorthBound gateway, via a server-side proxy |
| Resolution | Poll-rate snapshot | 1 second, 63 signals per BESS |
| History | None exposed | 90 days on the gateway, aggregated server-side |
| Selection | Station | BESS unit on one gateway |
| Screens | Dashboard, Control, Advisor, Alarms, Settings | Dashboard, Signals, Energy, Alarms, Advisor, System — plus History, Site and Support off the dock (+ Control for internal_admin) |
| Credentials | JWT in browser storage | JWT in server memory only |

Advisor is gone: there is no inference service, and an advisor with nothing to
advise is worse than no advisor. Control is gone from the dock for a stronger
reason — see below. In their place are **Signals** and **History**, which are
the two questions the gateway can actually answer.

## Architecture

```
browser  →  /api/gw/*                →  NorthBound gateway
            (proxy, passes rows through)

browser  →  /api/gw/history-series   →  NorthBound gateway
            (aggregates; rows never leave the server)
```

Everything routes through `app/api/gw/[...path]/route.ts`. Three reasons, all
of them from the gateway's own API Reference:

1. **The JWT never reaches the browser.** §2 — "do not embed credentials or
   JWTs in mobile builds". Login happens server-side, the token is cached in
   process memory and refreshed at 90% of its lifetime.
2. **CORS stops mattering.** The gateway is a field device behind a tunnel.
3. **Writes are refused centrally.** §11 classifies control endpoints as
   "never public customer UI". The proxy rejects every non-GET request unless
   `GW_ALLOW_WRITES=true`. A control disabled in the client is a control a
   modified client can press; this one cannot be reached at all.

## Files

Everything lives in this folder. Three files exist outside it, because Next
requires a file under `app/` to mount a route and an API handler; all three are
thin re-exports of code in here and contain no logic.

| Path | Purpose |
|---|---|
| `gateway/signals.ts` | The 63-signal profile, generated from the gateway's CSV. Do not hand-edit. |
| `gateway/proxy.ts` | The server-side proxy: login, token cache, write refusal. |
| `gateway/client.ts` | Browser-side fetchers. No longer pages history — see below. |
| `gateway/series.ts` | History aggregation, chunk cache and coverage. Server-only. |
| `gateway/rows.ts` | Reads a signal off a historian row, whatever shape it arrives in. |
| `gateway/types.ts` | Response shapes, per API Reference v20260810. |
| `gateway/GatewayContext.tsx` | Which BESS the screens are looking at. |
| `data.ts` | Every hook the screens read. The only file that differs in substance from `mobile-app/`. |
| `ScreenRouter.tsx` | URL slug to screen. Keeps the routing table with the screens. |
| `_removed/` | Screens and demo fixtures from `mobile-app/` that this build does not use, renamed `.bak` so they are not compiled. Safe to delete. |

**Outside this folder** — mount points only, 58 lines between them:

| Path | Contents |
|---|---|
| `app/k/layout.tsx` | Font, viewport, `MobileShell` |
| `app/k/[[...slug]]/page.tsx` | Renders `ScreenRouter` |
| `app/api/gw/[...path]/route.ts` | Re-exports `gateway/proxy` |
| `app/api/gw/history-series/route.ts` | Re-exports `gateway/series` |

Nothing else in the repo is modified. `mobile-app/`, `lib/`, `hooks/`,
`tsconfig.json` and `.env.example` are as they were.

## History

The gateway serves one-second rows and offers no downsampling — §8 exposes
`from`, `to`, `limit`, `order` and `format`, and nothing else. One hour of that
is 3,456 rows and **8.7 MB**, which the phone used to fetch in full to draw four
figures. Three separate failures came out of that arrangement, and all three are
worth naming because they were invisible in different ways:

1. **Every plotted value read zero.** The chart drew a flat line along 0 kW
   with SOC absent and 0.0 kWh of throughput, over a plant that was cycling.
   The cause of the absent values is not established; what is established is
   that a `?? 0` at the chart made "no value" and "measured zero" render
   identically, so nothing on screen could contradict it. Values are nullable
   end to end now and a gap renders as a gap.

   For the record, because an earlier version of this file said otherwise: the
   JSON row shape is **not** the problem. The API Reference is explicit that
   `format=compact` history rows carry `pcs_values` / `bms_values` object maps,
   which is what this build reads. The flattened `"PCS total_active_power"`
   spelling that `colKey` describes is the **CSV export** format — the 24-hour
   export in the handover package uses it for all 72 columns — and it is not
   what the JSON API returns.
2. **The window lied.** The page budget was `(minutes*60)/15*2` — a guess that
   the data is 15-second and that both BESS come back. It is one-second and
   filtered to one BESS, so the guess was 15x short. A "6h" view bought 10,000
   rows, drew 2 h 16 m of them, and said "page limit reached" as though that
   were a fact about the plant.
3. **It was 33 s of nothing to show for it**, and any interruption in those
   33 s discarded the lot.

`gateway/series.ts` answers all three. It reads the gateway server-side, keeps
epoch-aligned **80-minute** chunks of aggregated buckets, and returns ~40 KB of
buckets to the phone however wide the window. History is immutable, so a chunk
that has ended is correct forever and is never read twice; the trailing chunk is
extended from its own high-water mark, so a live chart costs the seconds that
have actually elapsed. Each request does a bounded amount of gateway work and
returns whatever coverage it has, so a wide window fills progressively instead
of hanging, and a failure loses one chunk rather than the window.

`CHUNK_MS` is the one number to keep in step: `backfill.ts` imports it and fills
chunks by start instant, and `buildSeries` looks them up by the same instant, so
two grids would have the walker write chunks nothing ever reads.

Measured against a 1-second stub: a 24-hour window is **86,670 rows delivered as
37 KB**, complete in a few polls, and **9 ms** on a repeat.

Measured against the commissioned gateway on 2 Sep 2026:

| window | cold | warm |
|---|---|---|
| 1 h  | 42 s      | 4-6 ms |
| 24 h | 99-105 s  | 30-57 ms |

Cold is a chunk nobody has fetched yet; warm is one already in the store. Every
window returns complete — the older warning that the long spans "hit the page
budget" described the client paging raw rows and has not been true since this
moved server-side.

### Set HISTORY_DIR in production

The chunk store falls back to `.data/history` when `HISTORY_DIR` is unset, and
the walker says so on every boot: *"this store does not survive container
replacement"*.

That fallback is fine locally and expensive in production. A sealed chunk is
correct forever, so the store is worth keeping forever — but on an ephemeral
path every deploy throws away all of it, and the walker re-reads thirty days off
the field board to rebuild what it already knew. Until it catches up, charts are
back to cold timings.

```sh
# A volume that outlives the container. One line, and the difference between
# graphs being instant after a deploy and instant a few hours later.
HISTORY_DIR=/var/lib/unityess/history
```

Three rules it will not break:

- **Totals are exact, and they describe the window asked for.** Energy, peaks
  and the SOC range accumulate over every raw row before any bucketing. The
  plotted line is a mean; `Peak power` is not. They are then clipped to the
  window on the same 5-second bucket the chart is drawn from, so a pair of rows
  straddling either edge is the whole error. Totals used to be summed a chunk at
  a time, which was exact over the chunks and wrong about the window: a 1 h view
  shares an edge with none of the three 30-minute chunks it spans, so it
  described up to half an hour it never asked for and reported more rows than
  the window has seconds.
- **Coverage is measured, never inferred.** The screen states what the window
  actually contains and names the stretches it does not have yet.
- **An unreadable row is reported, not zeroed.** If the gateway ever changes
  shape, the screen says how many rows it could not decode and lists the
  columns it actually received. It will not draw a flat line and let someone
  infer a calm plant from it.

Checked against the handover package of 10 Aug 2026 — API Reference, endpoint
inventory, 63-signal profile and a real 24-hour export. Every request parameter
matches the documented contract (`order=asc`, `limit=5000`, `format=compact`,
inclusive `from_epoch_ms`/`to_epoch_ms`, cursor at last timestamp + 1), all 63
signals match the profile CSV on name, label, category and unit, and the login
response is read as `expires_in_sec`. The export also confirms two findings this
build already surfaced: `charge_discharge_power` is 0.00 across all 141,288
rows, while `total_active_power` moves between -44.70 and +24.50 kW.

## Findings baked into the UI

These came out of a 20-hour survey of the gateway and are surfaced rather than smoothed
over. Each is a question for the gateway team, not a bug in this app.

- **`charge_discharge_power` (Modbus 192) reads 0.0 kW permanently.** Across
  70,646 samples it never moved, while SOC fell 74.7% → 53.2% and
  `total_active_power` swung −44.7 to +24.5 kW. Every power figure in this
  build uses `total_active_power`; the dashboard states the substitution.
- **41 of 63 signals were static.** 25 are fault bits, where constant zero is
  health. The other 12 are recorded in `SUSPECT_STATIC` in `gateway/signals.ts`.
  They were briefly surfaced on the Signals screen under a "Flagged" filter;
  that was an engineering note shipping to customers and the filter is gone.
- **`soh` held exactly 100.0%.** Treated as a placeholder. Degradation will
  have to be derived from throughput, not read from the register.
- **`off_grid_status` was high for the whole window.** Either the site really
  ran islanded for 20 hours, or the mapping is wrong. The dashboard reports
  the grid state it reads and names the inconsistent combinations.
- **~3.6% of expected samples are missing**, worst gap 16.3 s. Energy
  integration skips gaps over two minutes rather than bridging them.

## What this build deliberately does not do

No tariff, so no rupee figure anywhere — the gateway prices nothing. No
forecasting, no anomaly detection, no advisory: those need a server tier and
accumulated history, neither of which is a phone's job. The gateway holds 90
days in SQLite on field hardware and its own storage note warns the file does
not shrink until vacuumed. It is a buffer, not a historian.
