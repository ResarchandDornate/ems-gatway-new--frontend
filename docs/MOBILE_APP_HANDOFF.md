# UnityESS Mobile App — full handoff

_Written 23 August 2026. Self-contained: assumes the reader knows nothing about
this work._

---

## 1. What this is

`/k` — a mobile UI reading the **NorthBound EMS Gateway** — has been made into
an Android app. It builds automatically, runs on a device, is deployed to
production, and requires a real gateway login.

**Not to be confused with `/m`**, a separate mobile build reading **UGX**
(`platform.uniqgrid.com`). They share a stylesheet and design system and read
completely different backends. Work on the app means `/k`.

| Path | Folder | Backend |
|---|---|---|
| `/k` | `mobile_app_kunal_backend/` | NorthBound gateway ← **the app** |
| `/m` | `mobile-app/` | UGX |
| `/(ems)/*` | `app/(ems)/` | UGX — 13-route desktop EMS |

---

## 2. Repository and deploy chain

- **Repo:** `Ornate-solar-resarchd/unity-ems`, branch `main`
- Push to `main` → GitHub Actions → **self-hosted runner on a Mac mini**
- Runner does: `git reset --hard origin/main` in `~/portals/unity-ems`, then
  `docker compose up -d --build unity-ems-web` from `~/portals`
- Health check `https://ems.unityess.cloud/`
- Deploy template lives in a **separate public repo**:
  `Ornate-solar-resarchd/portals-infra`, `_deploy-template.yml`
- **Job timeout is 15 minutes** — this has been hit before

**`~/portals/docker-compose.yml` and `~/portals/.env` are on the server only.**
They are in no repo. Environment changes require server access.

---

## 3. Server access

The deploy host is **`ornates-mac-mini-3`**, reachable over **Tailscale**:

```bash
ssh ornateserver@100.123.168.106
```

Tailscale SSH authenticates by identity — **no password**. If it fails, check
Tailscale is running on the local Mac (it stops on its own sometimes).

`ems-ssh.unityess.cloud` is a Cloudflare Tunnel endpoint needing `cloudflared`
as a ProxyCommand; port 22 is closed to the internet. Tailscale is easier.

> `customer` / `Customer@123` are the **gateway's API credentials**, not a shell
> login. Confusing the two cost an hour.

---

## 4. Running it locally

Two servers, and **both are needed**:

```bash
npm run dev                          # :3000 — Next app, hosts /api/gw
npm --prefix android_app run dev     # :5180 — standalone build (becomes the APK)
```

- `http://localhost:3000/k` — the web app, same-origin, no CORS
- `http://localhost:5180/#/k` — the standalone build; **proxies `/api/gw` to
  :3000**

**If :3000 is not running, :5180 returns HTTP 500** from Vite's dev proxy, and
the app reports "could not reach the site (500)". This has been mistaken for a
gateway outage more than once.

---

## 5. Architecture

```
Android app (Capacitor)          Browser
  static bundle, https://localhost  │
        │                           │
        └────── /api/gw/* ──────────┘
                    │
        Next.js proxy (app/api/gw/[...path])
                    │
        NorthBound gateway (ems-api.unityess.cloud)
```

- `android_app/` is a **Vite harness only** — it contains no screens. It
  compiles the existing `/k` source. Copying those 3,500 lines would create a
  second source of truth.
- Next-specific APIs are **shimmed**: `next/navigation` → a hash router,
  `next/dynamic` → `React.lazy`. Aliased in `android_app/vite.config.ts`.
- Routing is **hash-based** — a packaged build has no server, so a History URL
  survives navigation but not a reload.

---

## 6. Authentication — pass-through

**The proxy holds no gateway credentials.** Each person signs in with their own
gateway account and their bearer token is forwarded unchanged. Entitlement is
the gateway's decision, which is the only place it can honestly be made.

Two layers on `/api/gw`:

| Layer | Purpose |
|---|---|
| `x-gw-app-token` header | Must match `GW_APP_TOKEN`. Stops strangers finding the path. **A lock, not a secret** — it ships inside the APK. |
| `Authorization: Bearer` | The user's own gateway token. This is the real authentication. |

Verified on production:

| request | result |
|---|---|
| no auth | **403** |
| app token only | **401** |
| app token + bearer | **200, live data** |

**Consequence:** `https://ems.unityess.cloud/k` cannot reach the gateway from a
browser — the web page carries no app token, only the packaged app does. The
posture is settled: **the token is never served to the page**, and the browser
gets an explanation instead of a sign-in form it cannot complete. See §9.

Session lives in `mobile_app_kunal_backend/gateway/auth.ts` as an external
store — `localStorage` on a packaged build, `sessionStorage` in a browser.

---

## 7. Environment

**Server** (`~/portals/.env`, referenced from `docker-compose.yml`):

```
GW_BASE_URL=https://ems-api.unityess.cloud
GW_APP_TOKEN=a7692da2ad71f7620c89ec48582571f795c17dc0242d9491c78e9c592e01343d
```

`GW_USERNAME` / `GW_PASSWORD` were removed — pass-through auth made them dead.

**GitHub:** secret `GW_APP_TOKEN`, variable `GW_API_BASE=https://ems.unityess.cloud`

**APK build:** `.github/workflows/android-debug-apk.yml`. Run with no input to
build against production; pass `api_base` to override.

---

## 8. The gateway

- **1,422 signals per source**, across nine assets. The 63-signal "fast profile"
  is only the historian subset — `/api/telemetry` carries the rest.
- Assets: `bms_1`, `pcs_1`, `ems_system`, `utility_meter`, `liquid_cooling`,
  `dehumidifier`, `fire_protection`, `io_module`, `remote_control`
- **Read the node's own `base_asset_id`.** Runtime ids do not match — the
  utility meter is `external_ems_1_grid_meter` with base id `utility_meter`.
- **Latency is 20–25 s and variable.** History gets a 55 s timeout and two
  attempts; everything else 25 s and three.
- **It goes down.** Cloudflare **530** means the tunnel is offline. It was down
  roughly three hours on 21 August and came back on its own.
- Requests **must send a `User-Agent`** or Cloudflare refuses them with error
  1010 in under 100 ms.

### Signals that do not exist
- **No solar.** Zero matches across all 2,844 dictionary rows.
- **No stored energy in kWh** — the gateway reports SOC, never capacity.
- **No tariff**, so no savings figure can be computed.

These render as stated placeholders. Do not invent them.

### Signals that look wrong
- `charge_discharge_power` (Modbus 192) reads a permanent **0.0 kW**. Every
  power figure substitutes `total_active_power` and the dashboard says so.
- The **utility meter reads a flat 0.0 kW at `quality: good`** — same
  signature. Unconfirmed whether that meter is wired.
- `soh` holds exactly **100.0%**.
- `off_grid_status` was high across a whole 20-hour capture.

---

## 9. Done

- Standalone bundle, Capacitor shell (`com.ornatesolar.unityess`, minSdk 24,
  target SDK 36), APK on every push
- Dashboard rebuilt: black/teal, container render as hero with an animated SVG
  telemetry overlay, five asset tabs, SOC and power rings
- Full telemetry snapshot — grid metering, site load, available power
- Login, session, sign out, account section
- Pass-through auth, app-token gate
- Deployed to `ems.unityess.cloud/k`
- Fonts self-hosted; type checking moved to CI
- App-only posture for `/k` in a browser, stated on screen rather than
  discovered as a failed login (23 Aug)

### Bugs fixed (all real, all found by running things)
| Bug | Why it mattered |
|---|---|
| History timed out at random | 20–25 s latency vs a 25 s timeout |
| No `User-Agent` | Cloudflare error 1010, instant refusal |
| Wrong `node_modules` in CI | Passed locally by luck |
| `tsconfig` typechecked `android_app` | Would have broken the deploy |
| No `.dockerignore` | Stale `node_modules` could replace the image's |
| Function returned from a persisted query | JSON drops functions |
| Asset ids by prefix-stripping | Every site figure read as absent |
| TypeScript 12.6 min in the image | Blew the 15 min job limit |
| Fonts fetched from Google at build | Failed the deploy when Google was slow |
| **POST missing from the login preflight** | Browser blocked sign-in entirely |
| **`Access-Control-Max-Age: 86400`** | Cached that refusal for 24 h |
| **Login never retried** | One transient gateway 500 = failed sign-in |
| **Gate 403 blamed the account** | Browser sign-in read "that account is not permitted" — it was the build, not the account |
| **APK workflow watched a merged branch** | `feat/android-app-phase-1` stopped being written to; no APK built on a push to `main` since, and nothing went red |

---

## 10. Left

1. **Multi-site.** `GW_BASE_URL` is one hardcoded gateway. A customer with two
   sites needs a picker and per-site routing. Do this when a second gateway
   exists.
2. ~~**Decide about `/k` in a browser.**~~ **Decided 23 Aug: app-only.** The
   token is not served to the page. `app/k/layout.tsx` reads `GW_APP_TOKEN` at
   request time and, when the gate is on and the client holds no token, the
   shell renders `AppOnlyScreen` instead of the sign-in form. The proxy's own
   refusal is now `app_token_required` with a `detail` saying so, because a
   bare `{ error: "forbidden" }` reached the login screen as "that account is
   not permitted to sign in here" — blaming an account that was never
   consulted. Reopening this means serving the token to the page, at which
   point the gate is decorative.
3. **Push notifications.** Needs a server-side watcher — the gateway cannot push
   to Firebase. Probably the actual reason anyone installs an EMS app, and what
   gets past Apple's minimum-functionality rule.
4. **Play Store.** $25 one-time. Register as an **organisation** — needs a
   D-U-N-S number, free, takes days, and exempts you from Google's
   closed-testing requirement.
   - **Done 24 Aug:** privacy policy at `/privacy`, in the `/k` design system,
     written from an audit of the code rather than a template. It is in
     `AUTH_BYPASS_ROUTES` — **remove that entry and the listing fails review**,
     because Google opens the URL signed out. Data Safety answers and the
     evidence behind them are in `docs/PLAY_DATA_SAFETY.md`. Account deletion
     was already routed in Settings → Account.
   - **Still needed:** a signed *release* build (the workflow makes a debug APK,
     which Play will not take — needs a keystore held as a repo secret), the
     launcher icon, listing copy, screenshots, a 1024×500 feature graphic.
5. **iOS.** `npx cap add ios`, Xcode. **$99/year, recurring.**
6. **Replace the launcher icon** — currently a placeholder battery, not Ornate
   artwork.
7. **`/ws/telemetry`** pushes every 2 s and is unused; the app polls at 5 s.
   **This is the most invasive item on this list, not the cheapest — it only
   reads small.** Three things have to be answered before any code:
   - **The proxy cannot carry it.** Every gateway call goes through
     `app/api/gw/[...path]`, and a Next App Router route handler cannot upgrade
     a connection on a self-hosted Node server. Proxying the socket means a
     custom server, which changes `output: "standalone"`, the `Dockerfile` and
     the deploy — all of §2.
   - **Or the app connects to the gateway directly**, which abandons the
     invariant that the client never learns the gateway's host and never
     depends on it allowing a browser origin. Both §5 and §6 rest on that.
   - **Auth is a JWT in the query string** (API inventory row 65,
     `token: str (required)`), so the bearer lands in Cloudflare's access logs.
     The inventory's own note says "redact JWT query token", which is advice to
     whoever operates the log, not a fix.

   The 5 s poll costs one request per screen per 5 s against a board that
   answers in 20–25 s under load. Whether 2 s of freshness is worth any of the
   above is a real question, and the honest answer today is probably not.

---

## 11. Gotchas

- **This project runs React 19, not 18.** `package.json` pins `react@18.3.1`,
  but Next 16 vendors its own React for client rendering and that copy is 19.
  The root `.npmrc` comment calling this a React 18 project is **wrong**.
- **`android_app` needs React 19 explicitly** and its own pinned resolution —
  the shared source resolves imports *upward* into the repo root, which only
  has a `node_modules` when the Next app is installed too.
- **The web app is same-origin and never preflights.** Only a packaged build
  exercises CORS. Browser testing cannot catch preflight bugs.
- **The deploy host's outbound network is unreliable** — npm `ECONNRESET` and
  Google Fonts timeouts have each failed a deploy.
- **A "successful" deploy may not recreate the container.** Check
  `docker ps` uptime rather than assuming.
- Deploys are ~4 minutes. **Do not test until the run completes.**

---

## 12. Current state

- Gateway up, production serving live data
- Local: run **both** `:3000` and `:5180`
- The APK job now also triggers on `main`. It previously watched only
  `feat/android-app-phase-1`, which had been merged — so between that merge and
  23 Aug, no push built an APK and nothing reported a failure. Check the first
  run on `main` rather than assuming it works.
- `/k` in a browser shows the app-only notice, not a login form. Locally the
  gate is open (`GW_APP_TOKEN` unset in `.env.local`) so the form still
  appears — set the variable to see what production shows.
