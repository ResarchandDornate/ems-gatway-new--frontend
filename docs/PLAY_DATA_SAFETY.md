# Play Data Safety — prepared answers

_Written 24 August 2026, from the code, for `com.ornatesolar.unityess`._
_Audit re-run 26 August 2026: unchanged, with one addition — the iOS ATS row._

For the App Store the equivalent declaration is
`android_app/ios/App/App/PrivacyInfo.xcprivacy`, which is bundled into the app
and was written from this same audit. The two have to agree with each other as
well as with the privacy policy.

Google treats a Data Safety declaration that disagrees with the privacy policy
as a policy violation in its own right, so this file and `app/privacy/page.tsx`
have to move together. Both were written from the same audit.

> **Confirm each answer in the Play Console before submitting.** Google rewords
> this form regularly and the wording is what you are certifying against. What
> follows is the *evidence* and a recommended answer, not a substitute for
> reading the question you are actually being asked.

---

## The audit these answers rest on

Re-run these before any submission. If an answer changes, the declaration and
the policy both change.

| Claim | How to check | Result on 24 Aug 2026 |
|---|---|---|
| No analytics, ads, crash reporting or attribution SDK | `grep -riE "analytics\|sentry\|firebase\|mixpanel\|posthog\|gtag\|amplitude\|crashlytics" package.json android_app/package.json` | no matches in either |
| One Android permission | `android_app/android/app/src/main/AndroidManifest.xml` | `INTERNET` only |
| Server stores no credentials | `grep -rn "process.env.GW_USERNAME\|process.env.GW_PASSWORD" --include="*.ts" . \| grep -v node_modules` | 0 reads. Grepping the bare names instead returns 1 — the comment in `proxy.ts` saying there are none |
| Everything is HTTPS | `capacitor.config.ts` → `allowMixedContent: false`, `androidScheme: "https"` | enforced on Android, and an http subresource cannot load |
| iOS allows plaintext to localhost only | `grep -A8 NSAppTransportSecurity android_app/ios/App/App/Info.plist` | one `NSExceptionDomains` entry, `localhost`, `NSExceptionAllowsInsecureHTTPLoads`. Added so the WebView can reach a proxy on a developer machine. It permits no remote origin, so it does not change any answer here — but it is an ATS exception, and App Review asks about those |
| Writes are refused server-side | `proxy.ts`, non-GET rejected unless `GW_ALLOW_WRITES` | refused |

**What is written to the device** — three keys, and nothing else:

| Key | Contents | Lifetime |
|---|---|---|
| `unityess.gw.session` | access token, username, expiry | gateway's expiry; cleared on sign out |
| `UNITYESS_GW_QUERY_CACHE` | recent gateway responses (plant readings) | 24 h (`CACHE_MAX_AGE`) |
| `ems-theme` | light/dark choice | until changed |

---

## Recommended answers

### Does your app collect or share any of the required user data types?

**Yes** — one type, and only because the username leaves the device.

Data Safety is about data **transmitted off the device**. On that test:

- **Personal info → User IDs — _collected_, not shared.**
  The gateway username is sent to our server on sign-in and travels on to the
  site gateway. Purpose: **App functionality** and **Account management**.
  **Required**, not optional — the app cannot show a site without it.
- **Everything else — not collected.** Plant readings describe equipment, not
  people. No location, contacts, photos, files, messages, calendar, health,
  financial info, or device identifiers are read or sent.

The password is a credential rather than one of Google's declarable data types.
It is transmitted to be verified and never stored — say so in the policy (it is
said) and check the console's current wording before answering.

### Is all of the data encrypted in transit?

**Yes.** HTTPS end to end, with `allowMixedContent: false` so a plaintext
subresource cannot load even if something is misconfigured.

### Do you provide a way for users to request that their data be deleted?

**Yes.** Settings → Account states the route and gives
`support@ornatesolar.com`, and the policy repeats it. Deletion happens on the
site gateway, which is the only place an account exists.

### Is the data collected ephemerally?

**No** — answer no. The username is persisted on the device as part of the
session. It is not retained on our server, which is a different question.

### Data shared with third parties?

**None.** There are no third parties. No SDKs, no processors, no analytics
vendor, no ad network.

---

## Two things to check in the console, not here

1. **The account-deletion URL requirement.** Google requires a *web* deletion
   route for apps that let users **create** accounts. This app does not — the
   gateway issues accounts and this app cannot create, change or delete one.
   That most likely exempts it, but it is a console question and the exemption
   should be confirmed rather than assumed.
2. **Which "Data types" the readings fall under.** They are equipment telemetry
   and map to none of Google's personal categories. If a reviewer disagrees, the
   nearest honest answer is "App info and performance → Other app data", not a
   personal category.

---

## Listing fields that follow from this

- **Privacy policy URL:** `https://ems.unityess.cloud/privacy` — publicly
  reachable, no sign-in. It is in `AUTH_BYPASS_ROUTES`
  (`components/auth/AuthGate.tsx`); if that entry is ever removed, the URL shows
  a login modal and the listing fails review.
- **App category:** Business, or Productivity. Not a consumer utility.
- **Ads:** contains no ads.
- **Target audience:** 18+. Not directed at children.

---

## Still outstanding for the listing

Not blocked by anything in this repo, but not done:

- Store listing copy, screenshots, and a 1024×500 feature graphic
- A signed **release** build — the current workflow produces a *debug* APK,
  which Play will not accept. Needs a keystore, held as a repo secret, and an
  `assembleRelease`/`bundleRelease` job
- The launcher icon is still the placeholder battery (§10.6 of the handoff)
- Developer account registration as an organisation — $25, plus a D-U-N-S number
