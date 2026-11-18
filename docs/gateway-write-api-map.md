# The NorthBound gateway's write API, mapped

Every non-GET operation the gateway exposes, what it takes, who may call it,
and what this app does with it.

| | |
|---|---|
| **Date** | 3 September 2026 |
| **Gateway** | `ems-api.unityess.cloud`, build `0.10.0-operator-control` |
| **Documented against** | `Northbound_EMS_Gateway_IT_Server_Handover_Package_20260810` |
| **Schemas from** | the gateway's own `GET /openapi.json` |

**Nothing here was executed.** Every field below was read from the OpenAPI
document and the handover inventory, both of which are GETs. No write endpoint
was called, and `storage/cleanup` and `storage/vacuum` in particular must not
be called to "see what they do" — they delete history and rewrite the database.

---

## 1. The shape of it

The handover inventory lists **19 non-GET entries** — 18 POST and one
WebSocket. The deployed build exposes **20**: the same 18 POSTs, plus a PATCH
the handover does not mention (§5).

They fall into six groups, and the groups matter more than the endpoints
because the risk is not evenly spread:

| Group | Operations | Role per handover | This app |
|---|---|---|---|
| Auth | 1 | Public | **Used** |
| Dispatch, per source | 4 | `internal_admin` | Gated |
| Dispatch, site-wide | 3 | `internal_admin` | Gated |
| SOC protection | 3 | `internal_admin` | Gated |
| Raw register writes | 2 | `internal_admin` | Gated |
| Runtime config | 1 | `customer_admin`, `internal_admin` | Gated |
| Maintenance | 4 | **Authenticated** | **Never forwarded** |
| Controller settings | 1 (PATCH) | *undocumented* | **Never forwarded** |

"Gated" means the proxy forwards it only when `GW_ALLOW_WRITES=true`, which is
unset on every deployment today. "Never forwarded" means no value of that flag
reaches it.

---

## 2. Dispatch — the endpoints a control panel would use

All `internal_admin`. The handover's `README_FOR_IT_TEAM.md` states the policy
without qualification: *"Control and command endpoints must remain
internal-admin only."*

### Per source

```
POST /api/control/sources/{source_id}/charge
POST /api/control/sources/{source_id}/discharge
     PowerCommandRequest
       power_kw   number   REQUIRED   — positive magnitude, direction is the endpoint
       readback   boolean  default true
       note       string?

POST /api/control/sources/{source_id}/standby
     StandbyRequest
       readback   boolean  default true
       note       string?

POST /api/control/sources/{source_id}/grid-mode
     GridModeRequest
       target_mode              "grid_tied" | "off_grid"   REQUIRED
       readback                 boolean  default true
       timeout_sec              number?
       wait_for_voltage_stable  boolean  default true
       note                     string?
```

`power_kw` is a **positive magnitude in both directions** — charge and
discharge are different URLs, not different signs. A client that sends −40 to
`/charge` is not doing what its author thinks.

### Site-wide

```
POST /api/control/site/power
     SitePowerCommandRequest
       operation            "charge" | "discharge"   REQUIRED
       total_power_kw       number                   REQUIRED
       allocation           "equal" | "custom"       default "equal"
       per_source_power_kw  object?                  — required in practice when allocation="custom"
       source_ids           array?
       readback             boolean  default true
       note                 string?

POST /api/control/site/standby
     SiteStandbyRequest
       source_ids  array?   — omit for all sources
       readback    boolean  default true
       note        string?

POST /api/control/site/grid-mode
     SiteGridModeRequest
       target_mode              "grid_tied" | "off_grid"   REQUIRED
       source_ids               array?
       source_order             array?    — sequencing across sources
       execution                string?
       inter_source_delay_sec   number?
       wait_for_voltage_stable  boolean  default true
       timeout_sec              number?
       readback                 boolean  default true
```

Note what `source_ids: null` means on the three site endpoints: **all sources**.
The dangerous call is the short one — `{"target_mode": "off_grid"}` islands the
whole site, and it is a smaller payload than islanding a single unit.

---

## 3. Raw register writes — the widest door in the API

```
POST /api/commands/ems/write
     EMSWriteRequest
       source_id    string   REQUIRED
       signal_name  string?  ┐ one of these two identifies the register
       address      integer? ┘
       value        number   REQUIRED
       readback     boolean  default true
       note         string?

POST /api/commands/ems/batch
     EMSBatchWriteRequest
       writes             array[EMSWriteRequest]
       continue_on_error  boolean  default false
       note               string?
```

This writes **any** EMS register by name or by raw Modbus address. It is not
scoped to dispatch, it has no enumerated set of permitted targets in the
schema, and `address` bypasses the signal dictionary entirely. Everything the
other eleven control endpoints do, this can do — plus everything they
deliberately do not expose.

`continue_on_error: true` on the batch form is worth reading twice: a partial
failure leaves the plant in a state that is neither the old one nor the
requested one, and the response is the only record of which writes landed.

---

## 4. SOC protection and runtime config

```
POST /api/control/soc-protection/runtime
     SOCProtectionRuntimeRequest
       enabled  boolean?
       dry_run  boolean?
       note     string?

POST /api/control/soc-protection/solar
     SOCProtectionSolarRequest
       available      boolean?
       generation_kw  number?
       note           string?

POST /api/control/soc-protection/evaluate-once
     query: force
```

`soc-protection/solar` is the "solar availability hint" — an **input to** the
controller, not a measurement from it. The real PV reading lives at
`GET /api/solis/status`; see `gateway-findings-2026-09-03.md`. Anything that
writes here is telling the automation what to believe about generation.

```
POST /api/config/runtime
     ConfigUpdateRequest
       section  string  REQUIRED  — "storage", "logging", "polling", "server_upload"
       values   object  REQUIRED
```

**This one is not internal_admin.** The handover inventory lists its role as
`customer_admin, internal_admin`, so a customer account can change polling
cadence, logging and storage configuration. `values` is a free-form object with
no schema, so what a section actually accepts is undiscoverable from the API
document alone.

---

## 5. Two things the handover does not say

### 5.1 An undocumented write endpoint

```
PATCH /api/admin/controller/settings
      ControllerSettingsPatch
        high_limit           number?
        recovery_limit       number?
        low_cutoff_limit     number?
        low_recovery_limit   number?
```

This is **absent from the 20260810 inventory**, which lists no PATCH at all.
It is present on the deployed build and it writes the SOC protection
thresholds — the same four values `GET /api/solis/status` reports as
`high_soc_percent: 95.0`, `recovery_soc_percent: 75.0`,
`low_cutoff_percent: 10.0`, `low_recovery_percent: 10.0`, stamped
`settings_updated_by: "field_admin"`.

So it changes the automation that switches the site's PV inverter on and off,
and no handover document describes it, states its role, or classifies its
audience. **This is the first question for the gateway team.**

### 5.2 Four maintenance writes at "Authenticated"

| Endpoint | Body | Handover role |
|---|---|---|
| `POST /api/storage/cleanup` | query `retention_days`, `vacuum` | Authenticated |
| `POST /api/storage/vacuum` | none | Authenticated |
| `POST /api/logs/test` | query `severity`, `event_type`, `message`, `asset_id` | Authenticated |
| `POST /api/server-upload/upload-once` | none | Authenticated |

Not `internal_admin` — **any authenticated account**. On the reading of the
inventory that means a `customer_admin` token can run a retention cleanup
against the historian, vacuum the database, and inject log rows.

That is unverified by design: confirming it means deleting history on a live
plant, which is not a test worth running. It needs answering by the gateway
team from the source, not by experiment.

---

## 6. What this app does

`gateway/proxy.ts` refuses every non-GET request unless `GW_ALLOW_WRITES=true`,
with login the single exception — it mints a token and touches no plant.

The flag does **not** open everything. `CONTROL_WRITES` enumerates what it
opens, anchored `^…$` so a path the gateway adds later under `control/` is not
silently included:

```
^control/sources/[^/]+/(charge|discharge|standby|grid-mode)$
^control/site/(power|standby|grid-mode)$
^control/soc-protection/(runtime|solar|evaluate-once)$
^commands/ems/(write|batch)$
^config/runtime$
```

That is 13 of the 20 operations. The remaining seven:

| Operation | Reachable through this app? |
|---|---|
| `auth/login` | Yes, always — it is how anyone signs in |
| `storage/cleanup`, `storage/vacuum` | **No, at any flag value** |
| `logs/test`, `server-upload/upload-once` | **No, at any flag value** |
| `admin/controller/settings` (PATCH) | **No** — not on the list, and the anchors mean adding it would have to be deliberate |
| `/ws/telemetry` | No — the proxy forwards REST only |

Three independent refusals stand between a customer and a dispatch command: the
dock does not draw the Control screen for a non-dispatcher, the proxy refuses
the method, and the gateway enforces `internal_admin`. Only the third is a
security control; the first two are defence in depth.

---

## 7. If dispatch is ever turned on

Not a recommendation to turn it on — the handover forbids it for customer
builds, and §11 of the API Reference classifies dispatch as "never public
customer UI". These are the things that would have to be true first:

1. **`readback` stays `true`.** It defaults true on all seven dispatch
   endpoints. A write whose effect is not read back is a request, not a
   command, and the gateway's own `total_active_power` moves on a scale where
   a silent no-op is invisible.
2. **Writes are never retried.** `proxy.ts` already retries GETs only, and the
   comment there records why — a replayed charge command is a second charge
   command.
3. **`note` is populated on every call.** It is optional in every schema and it
   is the only field that survives into the gateway's own log as an
   explanation of who asked and why.
4. **`commands/ems/write` and `/batch` are dropped from the allowlist.**
   They are on it today. Nothing a control panel needs requires writing an
   arbitrary Modbus address, and their presence means the dispatch flag also
   grants unrestricted register access.
5. **`config/runtime` is reconsidered.** It is the one gated write a
   `customer_admin` may legitimately call per the inventory, which makes it the
   one most likely to be reached by accident.

---

## Appendix — every non-GET operation, at a glance

| Method | Path | Role (handover) | Proxy |
|---|---|---|---|
| POST | `/api/auth/login` | Public | always |
| POST | `/api/control/sources/{id}/charge` | internal_admin | flag |
| POST | `/api/control/sources/{id}/discharge` | internal_admin | flag |
| POST | `/api/control/sources/{id}/standby` | internal_admin | flag |
| POST | `/api/control/sources/{id}/grid-mode` | internal_admin | flag |
| POST | `/api/control/site/power` | internal_admin | flag |
| POST | `/api/control/site/standby` | internal_admin | flag |
| POST | `/api/control/site/grid-mode` | internal_admin | flag |
| POST | `/api/control/soc-protection/runtime` | internal_admin | flag |
| POST | `/api/control/soc-protection/solar` | internal_admin | flag |
| POST | `/api/control/soc-protection/evaluate-once` | internal_admin | flag |
| POST | `/api/commands/ems/write` | internal_admin | flag |
| POST | `/api/commands/ems/batch` | internal_admin | flag |
| POST | `/api/config/runtime` | customer_admin, internal_admin | flag |
| POST | `/api/storage/cleanup` | Authenticated | never |
| POST | `/api/storage/vacuum` | Authenticated | never |
| POST | `/api/logs/test` | Authenticated | never |
| POST | `/api/server-upload/upload-once` | Authenticated | never |
| PATCH | `/api/admin/controller/settings` | **undocumented** | never |
| WS | `/ws/telemetry` | JWT query token | never |

`/ws/telemetry` is listed in the handover inventory and does not appear in the
REST OpenAPI paths, which is expected for a WebSocket route and means its
presence on the build is unconfirmed here.
