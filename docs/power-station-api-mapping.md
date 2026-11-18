# Power Station Monitoring — API field mapping

**Date:** 25 September 2026
**Scope:** `/power-station`, all tabs. Follows `docs/dashboard-api-mapping.md`.
**Backend:** Ornate Central EMS Backend, verified live on the date above.

---

## 1. The finding that matters most

**The grid meters are not communicating, and the gateway is reporting their
zeros as good data.**

Every one of the 43 measurement points on `utility_meter` reads exactly `0.0`
with `quality: "good"` — including all three phase voltages and all three line
voltages:

```
p1355 phase_a_voltage = 0.0 V   quality=good
p1356 phase_b_voltage = 0.0 V   quality=good
p1357 phase_c_voltage = 0.0 V   quality=good
p1368 total_active_power = 0.0 kW   quality=good
p1404 total_active_energy = 0.0 kWh quality=good
```

A meter on an energised connection cannot read 0 V on every phase. Both meters
also report `communication_status = 0.0`.

This is one fault with a long shadow. It explains, on its own:

- every energy and revenue figure on the **dashboard** (7 fields)
- **load power**, **grid power**, **PCC power**, **reactive power** here
- **available charge / discharge power**, because the EMS derives them from the
  meter — which is why `ems_system` is the only other substream with dead
  measurements (27 of 42)

**`quality: "good"` on a meter that is not communicating is itself a defect.**
The flag is not reflecting comms state, so nothing downstream can tell a real
zero from an absent instrument. This is the concrete form of the concern raised
in §1 of `docs/central-backend-s1-contract.md`.

## 2. Signal health, measured

Measurement categories only — voltage, current, power, energy, temperature,
soc_soh, humidity, insulation. Fault and status flags are excluded because 0 is
their correct value.

| Substream | Measurements | Live | Dead | Verdict |
|---|---|---|---|---|
| `bms_extended` | 471 | 451 | 20 | healthy |
| `liquid_cooling` | 15 | 13 | 2 | healthy |
| `pcs_extended` | 81 | 62 | 19 | healthy |
| `dehumidifier` | 9 | 7 | 2 | healthy |
| `ems_system` | 42 | 15 | 27 | **grid-facing half dead** |
| `remote_control` | 13 | 0 | 13 | **all dead** |
| `utility_meter` | 43 | 0 | 43 | **all dead** |
| **Total** | **674** | **548** | **126** | **81% live** |

The battery and inverter are reporting well. The grid side is not reporting at
all.

## 3. Tab by tab

### 3.1 Power Station Home — `SingleStationDataView`

| Field | Status | Source |
|---|---|---|
| SOC (%) | ✅ | S1 `display_soc`, or `p0041 soc` |
| Station Power (kW) | ✅ | `p0075 energy_storage_power` — reads 14.1 kW |
| Rated Power | ✅ | `p0094 rated_power` — 130 kW per PCS |
| BESS / Controller / Meters present | ✅ | derive from S2 `asset_id` |
| Load (kW) | ❌ | `p0037 load_power` — meter-derived, reads 0 |
| Today's SOC / Today's load | ❌ | needs history beyond the ~17 min ceiling |

### 3.2 Matrix Data

| Field | Status | Source |
|---|---|---|
| Total SOC | ✅ | S1 `display_soc` |
| Total active power | ✅ | S1 `total_active_power` |
| Total reactive power | ❌ | `p0188` (PCS) is live; `p1372` (meter) is 0 — prefer the PCS |
| Max chargeable power | ❌ | `p0031 total_available_charge_power` — reads 0 |
| Max dischargeable | ❌ | `p0032 total_available_discharge_power` — reads 0 |
| Remaining charge / discharge | ⚠️ | **no register exists** — needs capacity × SOC, and capacity is an overlay 0 |
| Today's charge / discharge | ❌ | meter energy counters |

Note `p0188 total_reactive_power` on `pcs_extended` **is** live. Where a figure
exists on both the PCS and the meter, the PCS is the one to read today.

### 3.3 Communication Status

| Field | Status | Source |
|---|---|---|
| Device list | ✅ | distinct `asset_id` — 9 per source, 18 total |
| Per-device online | ✅ | `p0038`, `p0066`, `p1259`, `p1125`, `p1354`, `p0207` |
| Source-level online | ✅ | `health.sources[].online` |
| Asset counts | ✅ | `health.sources[].asset_count` = 9 each |

**This tab can be fully wired today**, and it is the one that would have
surfaced the meter fault to an operator.

### 3.4 Single Station Data — time series

Last 7 Days, Current Month, Current Year — **all blocked**. The reachable
window is about 17 minutes (S1) and 35 minutes for one point (S2). Needs the
aggregated history endpoint, `docs/central-backend-s1-contract.md` §3.

### 3.5 Main Wiring Diagram · Network Topology

Already parked behind `EmptyState`. Unaffected.

### 3.6 Weather Station

Tab appears only when `plantConfig.wms` is set. **No weather signals exist** in
any of the nine substreams, so this stays hidden.

## 4. Summary

Twenty-one fields across the tabs:

| | Count |
|---|---|
| Wireable today | **10** |
| Partially available | **1** (reactive power — read the PCS, not the meter) |
| Blocked by the dead meter | **4** |
| Blocked by the history ceiling | **2** |
| No signal exists at all | **1** (weather) |
| Parked, or needs a capacity that has no register | **3** |

**Communication Status first.** It is fully available, it is a small tab, and
it is the screen that makes a dead meter visible instead of silent.

## 4b. Wired — 25 September 2026

Communication Status, Matrix Data, Power Station Home and the equipment
hierarchy now read the central backend. Live: total active power 3.6 kW, total
reactive power 3.5 kVAr (the PCS register, not the meter's), total SOC 92.9%,
both cabinets with their own power and SOC, phase currents, and 16/0/2 of 18
devices with the two grid meters named offline.

**Two traps were found by wiring rather than by mapping.**

`category: "fault_alarm"` is not a list of alarms. It holds 549 points and
counting the non-zero ones gives **26 on a site with nothing wrong** — because
the category mixes threshold settings (`outlet_high_pressure_alarm_value =
2.9 Bar`), statuses (`pcs_running_status = 2`), readings
(`temperature_value = 72`) and one flag that means the opposite of an alarm
(`fire_protection_communication_status = 1` is healthy). A genuine flag is
unitless, is not a `_value`, and is named for a failure. That leaves 415 real
flags, of which **0 are raised**.

Meter-derived energy fields now return **null, not 0**. Rendering "0.00 GWh"
beside a discharging battery reads as a measurement and invites the conclusion
that the site moved no energy. `StationSummary` and `MatrixData.energy` are
nullable and the views render an em dash.

## 5. Actions

1. **Check the grid meters.** Both report `communication_status = 0.0` and 43
   zeroed measurements each. Physical or Modbus-level; not a frontend or
   backend-API problem.
2. **Fix the quality flag.** A non-communicating device should not report
   `quality: "good"`. Until it does not, no client can distinguish a real zero
   from an absent instrument — and this dashboard would show a dead meter as a
   site drawing no load.
3. **Prefer PCS over meter** wherever both carry a figure, until 1 is resolved.
