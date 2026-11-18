# NorthBound EMS Gateway — the BMS rack endpoints, and a solar one nobody had read

Two findings from a spike into per-rack battery detail. One closes that
question; the other opens a larger one.

| | |
|---|---|
| **Date** | 3 September 2026 |
| **Gateway** | `ems-api.unityess.cloud`, build `0.10.0-operator-control` |
| **Account** | `customer_admin` |
| **Method** | Authenticated GETs against the running gateway, User-Agent set, 45 s timeout, no retries |
| **Reproduce** | Every request below is a plain GET; the raw figures are in `mobile_app_kunal_backend/endpoints.csv` |

---

## 1. The entire `/api/bms/*` family is absent from the deployed build

**Kind:** documentation defect, or an un-deployed feature. Not a bug in the app.

The Phase 1.6 API inventory lists four rack endpoints and marks all of them
*"Implemented in Phase 1.6 baseline"*, sourced to `app/api/routes.py`:

| Endpoint | Inventory says |
|---|---|
| `GET /api/bms/racks` | Implemented in Phase 1.6 baseline |
| `GET /api/bms/racks/summary` | Implemented in Phase 1.6 baseline |
| `GET /api/bms/racks/{rack_id}` | Implemented in Phase 1.6 baseline |
| `GET /api/bms/racks/{rack_id}/details` | Implemented in Phase 1.6 baseline |

None of them answer. Nor do their siblings `/api/bms/bank` or
`/api/bms/environment`.

```
404   6349 ms    22 B   /api/bms/racks              {"detail":"Not Found"}
404   6445 ms    22 B   /api/bms/racks/summary      {"detail":"Not Found"}
404   6585 ms    22 B   /api/bms/racks/1            {"detail":"Not Found"}
404   6196 ms    22 B   /api/bms/racks/99           {"detail":"Not Found"}
404   6453 ms    22 B   /api/bms/bank               {"detail":"Not Found"}
404   6566 ms    22 B   /api/bms/environment        {"detail":"Not Found"}
404   6347 ms    22 B   /api/definitely-not-a-route {"detail":"Not Found"}
200   6493 ms  12254 B   /api/assets
```

Three things make this a statement about the gateway rather than about the
request:

1. **The response is byte-identical to a route that was invented for the
   test.** `/api/definitely-not-a-route` returns the same 22 bytes. This is
   FastAPI's router saying the path does not exist — not a handler saying the
   rack does not.
2. **The same token reads `/api/assets` fine**, in the same run, seconds apart.
   So it is not authentication, not entitlement and not the `/api/` prefix.
3. **The gateway's own OpenAPI document agrees.** `GET /openapi.json` on
   build `0.10.0-operator-control` declares **58 paths, and not one of them
   contains `bms`, `rack`, `cell`, `module` or `cluster`.**

`/api/assets` reports 18 assets across nine kinds — `bms_1`, `pcs_1`,
`ems_system`, `utility_meter`, `liquid_cooling`, `fire_protection`,
`dehumidifier`, `io_module`, `remote_control`. The battery is exposed as one
aggregate asset. Per-rack granularity is not reachable by any route this build
declares.

**What we need to know:** were these endpoints deployed and then withdrawn, are
they gated behind something not visible to `customer_admin`, or has the
inventory been describing a build that never shipped? Until one of those is
answered, nothing can consume them and the inventory's status column is
misleading for every other integrator reading it.

---

## 2. This site has solar, and it is readable — it is simply not in the signal dictionary

**Kind:** a capability nobody had found. Priority.

The mobile app states, in code and on screen, that this plant has no solar. That
claim was based on the signal dictionary, where it is correct: `solar` appears
nowhere in the 2,844 rows, and the only mention is an internal_admin *"solar
availability hint"* input on the SOC-protection controller.

The dictionary is not the whole gateway. Build `0.10.0-operator-control`
declares two endpoints outside it:

```
200   6513 ms    558 B   /api/solis/status
200   7230 ms  43437 B   /api/solis/history
```

`/api/solis/status`, read at 05:34 UTC on 3 September 2026:

```json
{ "available": true,
  "controller_state": "NORMAL",
  "decision": "normal_keep_both_on_solar_on",
  "solis": { "enabled": true, "online": true, "state": "ON",
             "active_power_w": 57810, "active_power_kw": 57.81,
             "serial_port": "/dev/ems_solis_rtu", "unit_id": 1 } }
```

That is a Solis PV inverter on a Modbus RTU port, online, producing **57.81 kW**,
being actively managed by the SOC-protection controller. It answered a
`customer_admin` token.

`/api/solis/history` holds 1,111 events, each stamping `solis_power_w`
alongside both units' SOC.

Two qualifications, both of which matter before anything is built on it:

- **`/api/solis/history` is an event log, not a time series.** Its rows are
  `solis_command` and `solis_state_changed` — written when the controller acts
  or the inverter changes state, not on a cadence. PV *power* can be plotted
  from it as a scatter of observations; PV *energy* cannot honestly be
  integrated from it, because the gaps between rows are not measurement
  intervals.
- **Neither endpoint appears in the Phase 1.6 inventory**, so neither carries a
  documented `recommended_audience` or `exposure_class`. Every other endpoint
  this app reads was checked against that column before being surfaced. These
  two cannot be, so the audience needs confirming rather than assuming — the
  more so as the sibling `/api/control/soc-protection/solar` is a control.

**What we need to know:** is `/api/solis/status` intended to be customer-visible,
and is there — or could there be — a polled PV power signal in the historian
rather than only in an event log? A cadenced `solis_power_w` would make solar
production a first-class screen in the app instead of a state read.

---

## 3. Also declared, also unread: `/api/edge-ai/*`

Noted rather than investigated, because it was not what this spike was for.

Four endpoints — `health`, `latest`, `summary`, `source/{source_id}` — none in
the Phase 1.6 inventory. `/api/edge-ai/summary` returns a live IsolationForest
anomaly score per source against a 33-feature model, `NORMAL` on both units at
the time of reading, with a 19 s cycle latency and a 6–13 s inference latency.

If anomaly detection is wanted in the app, this is where it already exists on
the box, and the app's Advisor screen currently derives its findings from rules
instead. Worth a separate look.

---

## Appendix — the 58 paths this build declares

`GET /openapi.json`, `NorthBound EMS Gateway 0.10.0-operator-control`:

```
/api/admin/controller/settings          /api/health
/api/alarms                             /api/logs
/api/assets                             /api/logs/export.csv
/api/assets/{asset_id}                  /api/logs/filters
/api/assets/{asset_id}/telemetry        /api/logs/summary
/api/auth/login                         /api/logs/test
/api/auth/me                            /api/registers/map
/api/commands/ems/batch                 /api/registers/raw
/api/commands/ems/registers             /api/server-upload/status
/api/commands/ems/write                 /api/server-upload/upload-once
/api/config/runtime                     /api/solis/history
/api/control/site/grid-mode             /api/solis/status
/api/control/site/power                 /api/sources
/api/control/site/standby               /api/sources/summary
/api/control/soc-protection/evaluate-once   /api/sources/{source_id}
/api/control/soc-protection/runtime     /api/sources/{source_id}/assets
/api/control/soc-protection/solar       /api/sources/{source_id}/telemetry
/api/control/soc-protection/status      /api/storage/cleanup
/api/control/sources/{source_id}/charge     /api/storage/health
/api/control/sources/{source_id}/discharge  /api/storage/points
/api/control/sources/{source_id}/grid-mode  /api/storage/snapshots
/api/control/sources/{source_id}/standby    /api/storage/status
/api/controller/history                 /api/storage/vacuum
/api/controller/settings                /api/telemetry
/api/controller/status                  /api/telemetry/key-signals
/api/edge-ai/health                     /api/fast-bess/history
/api/edge-ai/latest                     /api/fast-bess/latest
/api/edge-ai/source/{source_id}         /api/fast-bess/profile
/api/edge-ai/summary                    /api/fast-bess/status
```

No `/api/bms/*`. No rack, cell, module or cluster route of any spelling.
