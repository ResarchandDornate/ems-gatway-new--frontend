# UnityESS Mobile App — what is done, what is left

_Last updated: 26 August 2026_

`/k` is now an Android app. It builds automatically, installs and runs on a
device, is deployed to production, and requires a real gateway login. What it
does not yet have is more than one site.

---

## Phases

| | Phase | Status |
|---|---|---|
| 1 | Standalone static bundle | **Done** |
| 2 | Capacitor shell + installable APK | **Done** |
| 3 | Identity and tenancy | **Mostly done** — auth works, multi-site does not |
| 4 | Alarm push notifications | Not started |
| 5 | Play Store release | **Ready to submit** — everything but the upload |
| 6 | iOS | **Builds and runs**; ready to submit bar an Apple account |

---

## Done

### The app
- `/k` compiles to a standalone static bundle (`android_app/`)
- Capacitor shell — `com.ornatesolar.unityess`, minSdk 24, target SDK 36
- APK builds on every push; downloadable from the workflow run
- Launcher icon and splash generated from `tokens.json` *(placeholder art)*
- Android back button mapped to the router, status bar themed, splash held
  until first paint

### The design
- Dashboard rebuilt to the reference: black and teal, container render as hero,
  animated telemetry arrows, five asset tabs, SOC and power rings
- Palette moved to black/teal across 18 tokens — not a single call site
- Hero is a rendered still with an SVG overlay, not realtime 3D

### The data
- Widened from the 63-signal fast profile to the gateway's full 1,422
- Grid metering, site load, available power and cumulative energy now read
- Signals with non-`good` quality resolve to null rather than showing a stale
  register as live

### Auth
- Sign-in screen, session storage, sign out
- Proxy rewritten for pass-through auth — **it holds no gateway credentials**
- App-token gate on `/api/gw`
- Account section explaining how deletion works

### Infrastructure
- Deployed to `https://ems.unityess.cloud/k`
- Server environment configured on the Mac mini, shared login removed
- Fonts self-hosted; builds no longer touch Google
- Type checking moved from the image build into CI

### Verified end to end on production
| step | result |
|---|---|
| login | token, `role: customer_admin`, 8h expiry |
| data, no auth | **403** — app-token gate |
| data, app-token only | **401** — gateway demands a bearer |
| data, both | **200 — 2 BESS rows, live** |

---

## Bugs found and fixed

| What | Why it mattered |
|---|---|
| History timed out at random | Gateway latency 20–25s against a 25s timeout — every page a coin flip |
| No `User-Agent` on gateway calls | Cloudflare refused with error 1010 in under 100ms |
| CI resolved imports from the wrong `node_modules` | Passed locally by luck, failed on a clean checkout |
| Root `tsconfig` typechecked `android_app` | **Would have broken the production deploy** |
| No `.dockerignore` | A stale `node_modules` could silently replace the image's |
| A function returned from a persisted query | JSON drops functions; the rehydrated entry arrived broken |
| Asset ids derived by prefix-stripping | `grid_meter` vs `utility_meter` — every site figure read as absent |
| TypeScript 12.6 min inside the image | Against a 15 min job limit — **cancelled the deploy** |
| Fonts fetched from Google at build time | **Failed the deploy** when Google was slow (11.2s vs 0.8s for GitHub) |

The last three each would have blocked every future deploy, and none was
visible while nobody was deploying.

---

## Left

### Phase 3, remainder
- **Multi-site.** `GW_BASE_URL` is one hardcoded gateway. A customer with two
  sites needs a picker and per-site routing. Worth doing when a second gateway
  exists, not before.

### Phase 4 — alarm push notifications
Probably the actual reason anyone installs an EMS app. Needs a **server-side
watcher**: the gateway cannot push to Firebase itself. Also what gets the app
past Apple's minimum-functionality rule later.

### Phase 5 — Play Store

Done in code: release `signingConfig` reading a gitignored `keystore.properties`;
`.env.production` so a release can't ship pointing at its own bundle; an
overridable `versionCode`; the `Android release AAB` workflow, which builds,
checks the API base is present and the bundle is actually signed, and stops at
the artifact; real launcher artwork; a 512 listing icon and a 1024x500 feature
graphic; an `#account-deletion` anchor on the privacy page, because both stores
want a deletion *URL* and refuse a `mailto:`.

Left, and all of it yours:
- **$25, one-time.** Register as an **organisation**, not an individual — needs a
  D-U-N-S number, free, takes days, and exempts you from Google's closed-testing
  requirement
- Generate the upload key (`android/keystore.properties.example` has the command)
  and add four repo secrets: `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- Phone screenshots. Everything else in the listing is generated and committed
- Confirm the Data Safety answers in the Console against `PLAY_DATA_SAFETY.md`
- Upload, then internal → closed → production

### Phase 6 — iOS

The project exists and runs. `PrivacyInfo.xcprivacy` is written from the same
audit as the Play declaration and is bundled into the app — verified in the
built `.app`, not assumed. Icons and splash generate for iOS alongside Android.

Left:
- **$99/year, recurring** — the only ongoing cost
- A signing team and an App Store Connect record; the project builds unsigned today
- **Apple's minimum-functionality rule is the real risk.** A read-only dashboard
  wrapping a web view is exactly what that rule is aimed at. Phase 4 is the
  answer to it, which is why push is worth doing before submitting to Apple
  rather than after

### Loose ends
- `/ws/telemetry` pushes every 2s and is unused; the app polls at 5s
- A 30d window cannot fully cache: 720 hourly chunks against a 600-chunk cap.
  It was equally true before (1,440 half-hour chunks against 1,200)
- No JDK on the work Mac that Gradle 8.14.3 accepts — only Android Studio's
  JDK 25, refused as class file major version 69. CI uses Temurin 21, so the
  release signing config is exercised there and not locally

---

## Only you can do

1. **Both store accounts, and the upload itself** — see Phase 5 and 6 above
2. **Find out why the gateway dropped** — it was down roughly three hours today
   (Cloudflare 530, tunnel offline) and came back on its own
3. **Start the D-U-N-S number** — slow, free, blocks Phase 5, blocks nothing else
4. **Ask the gateway team** about `charge_discharge_power` and the utility
   meter — both flat 0.0 at `quality: good`
5. **Look at this Mac's DNS** — it returned `HTTP 000 in 0.003s` repeatedly,
   which is a local resolution failure, not a network round trip. Several
   readings today were unreliable because of it, including one false alarm.

---

## Facts worth keeping

**This project runs React 19, not 18.** `package.json` pins `react@18.3.1`, but
Next 16 vendors its own React for client rendering and that copy is 19. The
root `.npmrc` comment describing this as a React 18 project is wrong.

**The gateway exposes 1,422 signals per source**, not 63.

**There is no solar on this gateway** — zero matches across 2,844 dictionary
rows. The only mention is an `internal_admin` "availability hint" on the
SOC-protection controller, which is a control input, not a measurement.

**Stored energy and savings cannot be computed.** Stored energy needs a rated
capacity the gateway never reports; savings needs a tariff, and the gateway
prices nothing. Both render as stated placeholders.

**The supplied hero render originally had telemetry painted into the pixels** —
312.4 kW, 65% SOC. Shipping it would have shown those numbers forever.
