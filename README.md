# UnityESS · EMS Frontend (Dashboard preview)

A modern Next.js frontend for the UnityESS Energy Management System — Phase 1 deliverable: the **Dashboard** module only, with both display modes (Group Screen + Per-station). Inspired by E²Think's structure, rebuilt with the UnityESS / Ornate Solar visual identity.

## Stack

- **Next.js 15** (App Router · TypeScript)
- **Tailwind CSS** with UnityESS brand tokens
- **Recharts** for time-series and donut charts
- **lucide-react** for icons
- **Chivo** (Google Fonts) — brand typeface

## What's in this build

- Top bar with all 7 module tabs (Dashboard active; others render the same shell, ready to build out)
- Station selector dropdown (Group Screen + 4 mock stations)
- **Mode A · Group Screen** — portfolio aggregate: installed power/energy, station counts, top-revenue ranking, portfolio health bars
- **Mode B · Per-station view** — hero band, Basic Information, Revenue Information, Daily Revenue chart, Charge/Discharge Capacity chart, Realtime Power/SOC chart, Alarm Information donut, ESS Cabinet strip
- Mock data for 4 realistic Indian projects (Amrita Hospital Faridabad, Bijlee Solar Pune, SunSure Jaipur, BSPGCL Bihar)
- ₹ INR with Indian comma grouping; live IST clock

## Run

The project includes a `node_modules` folder built in a Linux sandbox — you'll need to reinstall it on your Mac for the native binaries (Next.js SWC) to match. One-time setup:

```bash
cd ~/Desktop/work/"ems - frontend"
rm -rf node_modules .next
npm install
npm run dev
```

Then open http://localhost:3000

If you don't have Node.js installed, get it from https://nodejs.org (any v20+ works). The `npm install` step takes ~30-60 seconds on a normal connection.

## Project structure

```
app/
  layout.tsx           Root layout · Chivo font · global CSS
  page.tsx             Dashboard route (the only built page so far)
  globals.css          Tailwind + base styles
components/
  TopBar.tsx           Sticky top header · 7 module tabs · status icons
  SubHeader.tsx        Station selector + live clock
  StationSelect.tsx    Group/Station dropdown
  dashboard/
    Card.tsx           Reusable card + Stat primitives
    Charts.tsx         RevenueChart · PowerSocChart · ChargeDischargeChart · AlarmDonut
    GroupScreen.tsx    Mode A — portfolio aggregate
    PerStation.tsx     Mode B — single station detail
lib/
  mock-data.ts         All mock data · swap-point for real API
  utils.ts             cn() helper
tailwind.config.ts     Brand tokens · UnityESS orange #F26B4E
```

## Brand tokens

- Primary orange: `#F26B4E` (Tailwind `orange-400`)
- Ink (text): `#0F1419`
- Page background: `#FAFBFC`
- Card: `#FFFFFF`
- Font: Chivo (300 → 900)

## Where the real API plugs in

Every screen reads from `lib/mock-data.ts`. When a real backend exists, swap the named exports there with `fetch()`-backed equivalents — no other file should need to change.

## Next phases (queued)

- Phase 2 — design system primitives (DrillSelector, FilterBar, DateRangePicker, TodTable, AlarmTable)
- Phase 3 — remaining 6 modules (Power Station, Equipment, Alarm, Curve, Analysis, Strategy)
- Phase 4 — polish (light/dark, search, print)
- Phase 5 — mock-data layer formalised + handover docs
