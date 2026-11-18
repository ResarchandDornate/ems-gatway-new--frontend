# Endpoints used by the /k mobile app

Every endpoint the gateway-backed mobile app (`mobile_app_kunal_backend/`,
mounted at `/k`) actually calls, traced from the code rather than from the
gateway's own inventory. The gateway publishes ~50 endpoints; this is the
subset the app touches.

Sources: `gateway/client.ts` (browser), `gateway/auth.ts` (sign-in),
`gateway/proxy.ts` (server passthrough), `gateway/series.ts` (aggregation),
`app/api/gw/[...path]/route.ts` and `app/api/gw/history-series/route.ts`
(mount points).

## Shape

The browser never talks to the gateway. Every call goes to `/api/gw/*` on the
Next host — prefixed by `__GW_API_BASE__` on the Android build, which has no
server of its own — and the proxy forwards it to `${GW_BASE_URL}/api/*`
unchanged, carrying the caller's own bearer token. The proxy holds no gateway
account of its own.

```
browser ──► /api/gw/<suffix> ──► ${GW_BASE_URL}/api/<suffix>
```

One path, `history-series`, is synthesized by this app and does not exist
upstream.

## Reads — `GET /api/gw/…` → gateway `/api/…`

| Endpoint | Client fn / hook | Used by | Refresh |
|---|---|---|---|
| `health` | `getHealth` / `useGatewayHealth` | Settings | 30 s |
| `sources/summary` | `getSources` / `useBessIds`, `useConnectivity`, `useSources` | shell, banner | 30 s |
| `fast-bess/status` | `getLoggerStatus` / `useConnectivity`, `useGatewayHealth` | banner, Settings | 30 s |
| `fast-bess/latest?format=compact` | `getLatest` / `useLive` | Dashboard, Signals, Header | 5 s |
| `fast-bess/profile` | `getFastBessProfile` / `useLoggerProfile` | Settings | `staleTime: Infinity` |
| `alarms` | `getAlarms` / `useAlarmList` | Alarms | 15 s |
| `telemetry?source_id=…` | `getSiteTelemetry` / `useSite` | Dashboard | `SITE_MS` |
| `auth/me` | `getAuthMe` / `useIdentity`, `useIsDispatcher` | Settings, Control | 5 min stale |
| `storage/status` | `getStorageStatus` / `useStorage` | Settings | 60 s |
| `storage/health` | `getStorageHealth` | exported, no caller | — |
| `assets` or `sources/{source_id}/assets` | `getAssets` / `useAssets` | Settings | 5 min stale |
| `server-upload/status` | `getServerUploadStatus` / `useServerUpload` | Settings | 60 s |
| `config/runtime` | `getRuntimeConfig` / `useRuntimeConfig` | no screen yet | 60 s stale |
| `control/soc-protection/status` | `getSocProtection` / `useSocProtection` | Control | 30 s |

`format=compact` on `fast-bess/latest` is required, not incidental: it is what
returns the `value_only` schema_version 2 rows for both BESS.

`telemetry` rather than `telemetry/key-signals` — "key" is 603 signals per
source, dominated by fault bits the Alarms screen already reads through
`alarms`.

## Auth

| Endpoint | Method | Body | Where |
|---|---|---|---|
| `auth/login` | POST | `{username, password}` → `access_token` | `gateway/auth.ts:163` |

The one write the proxy always allows — refusing it would leave every caller
permanently unauthenticated — and the only POST it retries, since it mints a
token and touches no plant.

## Writes — `POST`, refused unless `GW_ALLOW_WRITES=true`

Issued by the Control screen:

| Endpoint | Body |
|---|---|
| `control/sources/{source_id}/charge` | `{power_kw}` |
| `control/sources/{source_id}/discharge` | `{power_kw}` |
| `control/sources/{source_id}/standby` | `{}` |
| `control/sources/{source_id}/grid-mode` | `{mode}` |

The proxy's allowlist (`gateway/proxy.ts:51`) is deliberately wider than what
the client calls. It would also forward, when the flag is set:

- `control/site/(power|standby|grid-mode)`
- `control/soc-protection/(runtime|solar|evaluate-once)`
- `commands/ems/(write|batch)`
- `POST config/runtime`

Nothing in the app issues those. Every other non-GET path is refused with
`write_disabled` regardless of the flag, so turning on dispatch cannot turn on
maintenance (`storage/cleanup`, `storage/vacuum`, `logs/test`,
`server-upload/upload-once`) by accident.

Two independent checks apply to all of these: the proxy narrows what may be
attempted, the gateway decides who may attempt it. A customer token gets 403
from the gateway, which is correct.

## App-local, not on the gateway

`GET /api/gw/history-series` — `app/api/gw/history-series/route.ts`

Query: `source_id`, `bess_id`, `from_epoch_ms`, `to_epoch_ms`, `points`
(default 720), `now_epoch_ms`.

Server-side aggregation for the History screen. Internally it pages
`fast-bess/history` (`from_epoch_ms`, `to_epoch_ms`, `limit`, `order=asc`,
`format=compact`, `source_id`) and reads `auth/me`, both via `gatewayRead`.
The browser does not call `fast-bess/history` directly and must not start
again: one hour of raw rows was 3,456 rows and 8.7 MB for the four figures a
chart uses.

It is a sibling of the catch-all rather than a path under it — a static
segment wins over a catch-all in Next — so it inherits the app-token gate and
the CORS allowlist without restating them.

`OPTIONS` exists on both mount points for the packaged Capacitor builds'
cross-origin preflight.

## Timeouts and retry

| | Timeout | Attempts |
|---|---|---|
| Everything except history | 25 s | 3 |
| `fast-bess/history` | 55 s | 2 |

Retryable statuses: 500, 502, 503, 530. GETs and `auth/login` only — a control
write is never replayed. Backoff is jittered.

## Capture fallback

With `GW_BASE_URL` unset the proxy serves a bundled reference capture and
marks every response `x-gw-mode: capture`. Only these suffixes resolve
(`gateway/capture.ts:119`):

`health`, `sources/summary`, `fast-bess/status`, `fast-bess/profile`,
`fast-bess/latest`, `fast-bess/history`, `alarms`

Everything else — `telemetry`, `auth/me`, `storage/*`, `assets`,
`server-upload/status`, `config/runtime`, `control/soc-protection/status` —
returns 503 `no_gateway`. In practice that leaves the Settings screen
substantially blank in capture mode.

## Headers

- `x-gw-app-token` — shared access-token gate, required when `GW_APP_TOKEN` is
  set. A header rather than a query parameter so it stays out of access logs,
  referrers and browser history.
- `Authorization: Bearer …` — the caller's own gateway token, forwarded
  unchanged.
- `User-Agent: UnityESS-Mobile-Proxy/1.0` — set by the proxy. Without it
  Cloudflare refuses the request at the edge with error 1010.
- `x-gw-mode: live | capture` on every response.
