# Dashboard — API field mapping

**Date:** 25 September 2026
**Scope:** `/dashboard` only — both modes. Other screens follow separately.
**Backend:** Ornate Central EMS Backend, `bess-ems-api.unityess.cloud`

Every claim here was checked against the live backend on the date above, not
against the written API notes. Where the two disagreed, the live response won.

---

## 1. Why the dashboard currently shows nothing

`GroupScreen` calls `fetchStations()`, which calls `getSources()`, which is the
**disabled NorthBound stub** — it returns `{ sources: [] }` without a network
request. Every figure on the page is derived from that empty array, so all of
them are 0 and the map has no markers.

That is one substitution away from working, and §3 names the substitute.

## 2. The second reason: most fields were never telemetry

Even with a station list, `sourceToStation()` fills most of `Station` from
`lib/api/overlay/stations.ts`, a hand-written table — not from any API:

| Field | Comes from | Non-demo value |
|---|---|---|
| `installedCapacity` (kWh) | overlay | **0** |
| `installedPower` (kW) | overlay | **0** |
| `energyStorageCabinetNum` | overlay | 1 per source |
| `accumulations.totalCharge` | overlay | **0** |
| `accumulations.totalDischarge` | overlay | **0** |
| `accumulations.totalRevenue` | overlay | **0** |
| `stationLocation`, `operationTime` | overlay | `""` |

The overlay's own header explains why, and it is right: a rated capacity, a
commissioning date and a tariff are commercial facts, not readings. The
dashboard showing 0 is deliberate — *"0 is what is known"*.

What has changed is that **two of those are now telemetry after all**, and one
of them is not. §3 separates them.

---

## 3. Sources available today

### 3.1 `health.sources[]` — a drop-in station list

`GET /gateways/{id}/health` carries, inside `data.health.sources`:

```jsonc
[
  { "source_id": "external_ems_1", "online": true, "asset_count": 9,
    "signal_count": 1422, "online_asset_count": 9, "bad_signal_count": 0,
    "last_update_utc": "2026-09-25T10:15:22.774166+00:00" },
  { "source_id": "external_ems_2", "online": true, … }
]
```

This is the same shape `getSources()` used to return — an id, a display of
liveness, and a last-seen stamp. **`fetchStations()` can be repointed at it
without touching anything downstream**, because the overlay is already keyed on
`external_ems_1` / `external_ems_2`, which is exactly what this returns.

`signal_count: 1422` also matches the adapter's documented per-source figure
exactly, which is a useful confirmation that this is the same asset model.

### 3.2 `p0094 rated_power` — installed power, measured

S2, `substream=pcs_extended`. Reads **130.0 kW** on each of
`external_ems_1_pcs` and `external_ems_2_pcs`. That is a real nameplate figure
the PCS reports, so **Installed Power stops being an overlay guess**: 0.26 MW
across the portfolio.

### 3.3 The meter's energy counters exist but read zero

`utility_meter` carries three cumulative kWh counters:

| point_id | signal | live value |
|---|---|---|
| `p1404` | `total_active_energy` | **0.0** |
| `p1405` | `forward_total_active_energy` | **0.0** |
| `p1406` | `reverse_total_active_energy` | **0.0** |

The registers are mapped and report `quality: good`. **They are not simply
failing to accumulate — the meters are not communicating at all.** All 43
measurement points on `utility_meter` read 0.0, including every phase and line
voltage, and both meters report `communication_status = 0.0`. A meter on an
energised connection cannot read 0 V on three phases.

Worse, `quality: "good"` on a device that is not communicating means nothing
downstream can tell a real zero from an absent instrument. Full evidence in
`docs/power-station-api-mapping.md` §1.

### 3.4 There is no rated capacity anywhere

Searched all **1,174 distinct points** across all nine substreams: no kWh
nameplate on any asset. `installedCapacity` therefore stays an overlay field
permanently, exactly as its comment predicted. **Inst. Energy cannot be fixed by
any endpoint** — it needs the commissioning documents.

---

## 4. Portfolio mode — field by field

`components/dashboard/GroupScreen.tsx`

| # | UI element | Current source | Available now | How |
|---|---|---|---|---|
| 1 | Charging Capacity (GWh) | overlay → 0 | ❌ | meter counters read 0 |
| 2 | Discharge Capacity (GWh) | overlay → 0 | ❌ | as above |
| 3 | Cumulative Revenue (₹L) | overlay → 0 | ❌ | needs energy × tariff; tariff is overlay |
| 4 | Inst. Power (MW) | overlay → 0 | ✅ | S2 `p0094` × source count |
| 5 | Inst. Energy (MWh) | overlay → 0 | ⚠️ overlay only | not in the dictionary |
| 6 | Stations (count) | `stations.length` → 0 | ✅ | `health.sources[].length` |
| 7 | Cabinets (count) | overlay | ✅ | distinct `bess_id` in S1 |
| 8 | Station Revenue Top 5 | overlay → empty | ❌ | same as #3 |
| 9 | Monthly Revenue | `NoChartData` stub | ❌ | needs FY-scoped energy history |
| 10 | Portfolio Map markers | `GEO_LOOKUP` + overlay | ⚠️ **bug** | see §5.1 |
| 11 | "Live · N stations active" | `stations.length` | ✅ | `health.sources[]` |
| 12 | Station name chips | overlay name | ✅ | `source_id` + overlay name |
| 13 | Capacity · MWh/mo | `NoChartData` stub | ❌ | needs energy history |
| 14 | Station Efficiency Top 5 | discharge ÷ charge | ❌ | both inputs are 0 |
| 15 | Peak – Valley ₹/kWh | `NoChartData` stub | ⚠️ overlay only | tariff is commercial |
| 16 | Station online/offline | overlay default `offline` | ✅ | `health.sources[].online` |

**Six of sixteen can be filled today** — #4, #6, #7, #11, #12, #16. Seven are
blocked on the meter, two are permanently commercial, one is a bug.

## 5. Three defects found while mapping

### 5.1 The map's coordinate table can never match

`GEO_LOOKUP` in `GroupScreen.tsx` is keyed by **UGX station UUIDs**
(`38a5ae50-4032-11f0-…`). The central backend's ids are `external_ems_1` and
`external_ems_2`. No key will ever match, so **every marker falls back to
`INDIA_CENTER`** — all stations stack on one point in the middle of the country.

This is latent right now only because the station list is empty. It becomes
visible the moment §3.1 is wired.

Fix: re-key `GEO_LOOKUP` on `source_id`, or carry coordinates on `GET /sites`
when it exists (requested in `docs/central-backend-fleet-list-request.md`).

### 5.2 Default station status is `offline`

`DEFAULT_OVERLAY.status` is `"offline"`, which is the right default for an
unknown source. But `health.sources[].online` is available and authoritative, so
the derived status should come from it rather than from the overlay fallback.

### 5.3 Cabinet count is assumed, not counted

The overlay states one cabinet per source. S1 reports `bess_id` per sample, and
the live gateway returns exactly two (`bess_1`, `bess_2`) — so the count can be
derived rather than declared.

## 6. Per-station mode

`components/dashboard/PerStation.tsx`

| UI element | Available now | How |
|---|---|---|
| State of charge | ✅ | S1 `bms_values.display_soc` |
| State of health | ✅ | S1 `bms_values.soh` |
| Installed power | ✅ | S2 `p0094 rated_power` |
| Rated capacity | ⚠️ overlay only | not in the dictionary |
| Run days | ⚠️ overlay only | from `operationTime` |
| Single-line live power flow | ✅ | S1 `total_active_power`, S2 `p0075 energy_storage_power` |
| Power at PCC · today | ⚠️ partial | live value yes; "today" needs history |
| Active alarms | ✅ derivable | S2 `category: fault_alarm` — 88 in cooling, 23 fire, etc. |
| Charge/Discharge · today | ❌ | meter counters read 0 |
| Charge/Discharge · lifetime | ❌ | as above |
| State of charge · today | ⚠️ partial | S1 window caps at ~17 min |

## 7. What unblocks the rest

In order of how much each one returns:

1. **Get the grid meters communicating.** Not "make them accumulate" — they are
   reporting nothing at all: 43 zeroed measurements each, `communication_status
   = 0.0`, and every phase voltage at 0 V. Six of the sixteen portfolio fields
   depend on nothing else, and so do four on Power Station Monitoring. Physical
   or Modbus-level; not a frontend or backend-API task. And the quality flag
   should stop reporting a silent device as good.
2. **`GET /sites`** with latitude and longitude, which retires `GEO_LOOKUP` and
   fixes §5.1 properly.
3. **Aggregated history** (S1 memo §3) for the FY-scoped charts — monthly
   revenue, capacity per month, anything with a time axis wider than 17 minutes.
4. **Commissioning documents** into the overlay: `installedCapacity`,
   `operationTime`, `stationLocation`, the tariff card. No endpoint will ever
   carry these.

## 8. Done — 25 September 2026

All six available fields are wired, and the station model was corrected at the
same time.

**A station is now the SITE, not a source.** The plant was rendering as two
stations because `source_id` was being used as the station key; physically it
is one site with two cabinets. `Station.id` is now the gateway's — the only
site-level identifier the backend has — and `Station.sourceIds` carries the
controllers beneath it. The cabinets are the unit picker's job, which now lists
Total / BESS 1 / BESS 2 from S1.

Live on the dashboard:

| Field | Reads | Source |
|---|---|---|
| Stations | **1** | `health.sources[]` → one site |
| Cabinets | **2** | counted from `sources[]`, not declared |
| Inst. Power | **0.26 MW** | `p0094 rated_power`, 130 kW × 2 |
| Station name | **UnityESS** | site overlay |
| Map | **one pin, Gujarat** | `SITE_GEO`, re-keyed |
| Status | **online** | `sources[].online`, any-up |

§5.1 was fixed in the same change: `GEO_LOOKUP` is gone, replaced by `SITE_GEO`
in the overlay and keyed on the gateway.

Everything still reading 0 is §6 — the meter's counters.

## 9. Update — 28 September 2026

Wired from the cabinets' own registers (new: `lib/api/services/dashboardCentral.service.ts`,
`hooks/useDashboardCentral.ts`, `components/dashboard/recentWindow.ts`). Every
site-view figure follows the unit picker; Total is a sum that goes "—" if any
cabinet is missing.

| Field | Source |
|---|---|
| Energy · lifetime (site), Charging/Discharge Capacity + Efficiency (portfolio) | pcs `p0203` / `p0204`, AC, lifetime — portfolio chips now say LIFETIME, not the FY |
| Energy throughput · MTD | bms `p1063` / `p1064`, DC, this month |
| Energy throughput · Lifetime | pcs `p0203` / `p0204` |
| System status (5 rows) — were literals | S1 `pcs_online_status`, `bms_online_status`; S2 `p1146`, `p1354`, `p1282` |
| State of charge · recent / PCS power · recent | S1 window, 1,000 samples per cabinet (~16 min), titled with the span it holds |

Blanked rather than shown as ₹0 / 0.00: revenue (no tariff), Inst. Energy (no capacity).
Still "—": today's charge/discharge (needs a midnight reading), Stored, run days.

**Backend defect:** yearly counters `p1065`/`p1066` (and `p1067`/`p1068` Ah) are
word-swapped — 488,570,880 = 7,455 × 65,536. Not shown until fixed at source.

**Shared-hook defect, not fixed here:** `useBessLiveCentral` reads the first
source when the unit is Total, so SOC/SOH/power on the site view and the twin
are BESS 1's, labelled as the site's.
