# Central EMS Backend — S1 read contract

**To:** Central EMS Backend team
**From:** EMS frontend
**Date:** 24 September 2026
**Re:** `/fast-bess/latest`, `/fast-bess/history`, `/telemetry/latest`, `/telemetry/history`

The frontend API reference lists S1 fast-BESS telemetry as the next data
endpoint. This memo states what the website needs from it, before it is built
rather than after.

The website has been reading the same telemetry through the NorthBound gateway
since August. Everything below is measured against that deployment, not
preferred in the abstract. Where the gateway's read API cost us something, it is
named here so the same shape is not built twice.

---

## 0. The data is already yours

The health record published in the API reference reports, for the dev gateway:

```
total_signal_count: 2844    source_count: 2    asset_count: 18
```

The website's snapshot reader is built on a **1,422-signal** payload per source
across **nine** base assets — `bms_1`, `pcs_1`, `ems_system`, `utility_meter`,
`liquid_cooling`, `fire_protection`, `dehumidifier`, `io_module`,
`remote_control` (`lib/api/adapters/gateway.ts`).

2,844 ÷ 2 = 1,422. 18 ÷ 2 = 9. The gateway is shipping its complete signal
model to you intact, and `sources: [external_ems_1, external_ems_2]` shows the
source identifiers surviving with it. Nothing below asks you to collect new
data. It asks you to hand back what you already store, in a shape that does not
have to be undone on the client.

---

## 1. Per-signal quality must survive the read

**This is the one that fails silently, so it is first.**

The gateway holds the last successfully decoded number in place when a register
read fails. The value still looks like a reading. Only the quality flag beside
it says otherwise. The website's decoder therefore nulls any point whose
quality is not `good`:

```ts
// lib/gateway/fetch.ts
export function leafValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.quality === "string" && o.quality !== "good") return null;
    if (typeof o.value === "number") return Number.isFinite(o.value) ? o.value : null;
  }
  return null;
}
```

If `/telemetry/latest` and `/fast-bess/latest` return bare numbers, that check
has nothing to test and a stale register renders as a live one — on a dashboard,
with no visual difference from a good reading. There is no client-side way to
recover the distinction once it is dropped.

You already track this: the health payload carries `bad_signal_count`.

**Ask:** every value in a read response is an object carrying at least
`value`, `quality` and `unit` — or a parallel per-signal quality map. Not a
bare scalar.

**On `unit` specifically:** the gateway sends a unit on every point, sourced
from the same Modbus dictionary that defines the register. The previous backend
published none and the old client guessed units from key-name shape (`kW_`
prefixes, a `temp` substring). A guess that agrees with the dictionary 95% of
the time mislabels one axis in twenty. Please carry the unit rather than let us
re-derive it.

---

## 2. Keep the identifier vocabulary

The adapter and the metric profile are both keyed on
`source_id` → `base_asset_id` → `signal_name`, with signal names exactly as the
Telemetry Data Dictionary of 10 August 2026 spells them
(`display_soc`, `soh`, `cluster_total_voltage_collected`, `total_active_power`,
`phase_a_voltage`, `forward_total_active_energy`, `inlet_water_temperature`, …).

Your ingest schema uses a different vocabulary — `stream`, `substream`,
`gateway_id`, `site_id`. That is the right shape for a write path. If it leaks
into the read path, `lib/api/adapters/gateway.ts` and
`lib/api/metrics/profiles/northbound.profile.ts` both need rewriting, and every
one of the 22 `unmapped` bindings recorded in the profile has to be re-audited
against new names.

**Ask:** reads are addressed by `source_id` + `base_asset_id` + `signal_name`,
unchanged. Map from your internal storage keys on your side — you have the
gateway's own identifiers in the ingest payload already.

---

## 3. History must be aggregated server-side

This is the expensive one, and it is worth the detail.

The gateway's `/fast-bess/history` exposes `from`, `to`, `limit`, `order` and
`format`, and **no downsampling**. Measured against the deployed board:

```
response time = 8.0 s  +  5.27 ms per row      (measured, 100 → 5,000 rows)
```

Both terms are real, and the per-row term dominates any useful window. The
logger writes one row per second per source, so:

| Window | Rows | Cost |
|---|---|---|
| 1 hour | 3,456 | ~33 s, 8.7 MB on the wire |
| 24 hours | 86,400 | ~10 min, of which 7.6 min is per-row work |

The History screen reads **four** numbers off each row — power, SOC, peak cell
temperature, cell spread — out of the 63 the fast profile carries. Over 95% of
that payload is fetched, parsed and discarded.

We could not ship that, so the website now carries a server-side aggregation
layer that exists solely to work around the missing feature: epoch-aligned
80-minute chunks, a 5-second base bucket, a persistent chunk cache, high-water
extension of the trailing chunk, and partial-coverage responses so an
interrupted read is not lost (`mobile_app_kunal_backend/gateway/series.ts`,
`chunkStore.ts`). Its own header note says it plainly: *a pre-aggregated
endpoint is the right long-term answer, and it is backend work.*

That layer is ~1,250 lines we maintain because of an API shape. If
`/fast-bess/history` ships with the same `from`/`to`/`limit`/`order` and no
bucketing, we rebuild all of it against a second backend.

**Ask:** `/fast-bess/history` accepts a bucket size and aggregates before
responding. Concretely:

```
GET /fast-bess/history
    ?source_id=external_ems_1
    &from=<iso8601>&to=<iso8601>
    &bucket_ms=5000
    &signals=power,soc,temp_max,cell_spread     # optional projection
```

Two properties matter more than the exact parameter names:

- **Buckets carry `min` and `max` as well as `mean`.** Decimation is
  presentation only. A chart drawn from buckets and a chart drawn from raw rows
  must report the same peaks — a mean-only bucket silently erases the excursions
  that operators are looking for.
- **Integrals accumulate over raw rows before bucketing.** Energy in/out, SOC
  range and peak power are summed across every row in the window, not derived
  from the bars. Deriving them from buckets changes the number.

The response shape we already consume, for reference:

```jsonc
{
  "source_id": "external_ems_1",
  "from_epoch_ms": 0, "to_epoch_ms": 0, "bucket_ms": 5000,
  "points": [ /* [t, mean, min, max, …, count] per bucket; empty buckets omitted */ ],
  "totals": {
    "charged_kwh": 0, "discharged_kwh": 0, "throughput_kwh": 0,
    "ratio_pct": null, "peak_abs_kw": null,
    "soc_min": null, "soc_max": null, "temp_max": null,
    "rows": 0
  }
}
```

If you emit something close to this, the chunking layer is deleted rather than
ported.

---

## 4. Three constraints not to repeat on `/telemetry/history`

The gateway's general-history endpoint (`storage/points`) has three properties
that every caller had to be built around. They are listed so the S2 endpoint can
avoid them by design:

1. **One signal per call.** There is no multi-signal form. A screen wanting N
   signals costs N round trips against a board whose cheapest reply is 2.5 s.
   `cellTrend.service.ts` is shaped to read exactly six regardless of pack size,
   purely to bound this. **Ask:** accept a list of signals per request.

2. **No time range.** It takes `limit` only, answering with the most recent N
   rows over whatever period those happen to span. A caller cannot ask for "last
   30 days" — it must request rows, then read the covered window back off the
   data and label the chart from that. **Ask:** accept `from`/`to`.

3. **Cadence is published nowhere.** 1 Hz is specified for the fast profile
   only; the snapshot store's interval is a deployment property no endpoint
   reports, so it is derived from consecutive timestamps. **Ask:** state the
   cadence in the response.

Scale, so the projection question is concrete: the fast profile is 63 signals at
1 Hz; the remaining ~1,359 per source — including 260 cell voltages, the cooling
loop and the meter's energy counters — sit at the slower snapshot cadence and
are reachable only through this endpoint.

---

## 5. Retention

The gateway keeps 90 days at 1 s in SQLite, and the file does not shrink until
it is vacuumed. Whatever your retention and rollup policy is, please publish it
— ideally as a field on the history response. Screens currently cannot tell "no
data in this window" apart from "aged out", and they render those very
differently.

---

## 6. Not asking for

- **Control or dispatch.** The website has no dispatch screen and does not
  import the control verbs. The gateway classes them internal-admin and the
  proxy refuses them server-side unless explicitly enabled. Keep `/commands`
  off our critical path.
- **Per-rack or per-cell structure.** The gateway exposes the battery as one
  aggregate `bms_1`. Cluster and cell readers return empty rather than
  fabricate a rack, and the pages that showed them are parked. Not a blocker.
- **WebSocket, for now.** Polling is adequate at present cadence. Worth having
  later; not ahead of S1.

---

## 7. Open questions

1. Will S1 reads be addressed by `source_id`, or by `gateway_id` + `site_id`?
   The website's entire model is source-keyed; a gateway-keyed API needs a
   resolution step, which needs the planned `/gateways` and `/sites` endpoints
   to land **with** S1 rather than after it.
2. Does a signal's `quality` survive ingest into storage, or is it collapsed
   into `bad_signal_count` at the gateway-health level? §1 depends on the
   former.
3. Is the ingest cadence the same 1 Hz the gateway logs at, or is it decimated
   on the way up? If decimated, `bucket_ms` below that floor should be rejected
   rather than silently interpolated.
4. Which origins will CORS allow for the dev host?
5. Can we get the `admin@ornatesolar.com` dev password and a `gateway_id` UUID?
   The gateway-health view is the one thing buildable today and we cannot
   exercise it without both. The mini is not reachable off-LAN.

---

## Appendix — where these claims live

| Claim | Source |
|---|---|
| 9 base assets, nullable-everything, no per-rack detail | `lib/api/adapters/gateway.ts` (header) |
| Quality gate | `lib/gateway/fetch.ts` → `leafValue` |
| 1,422 signals/source, 2.5–6.7 s snapshot reads | `lib/api/adapters/gateway.ts` |
| `8.0 s + 5.27 ms/row`, 80-min chunks, 5 s base bucket | `mobile_app_kunal_backend/gateway/series.ts` |
| One-signal / no-range / unstated-cadence | `mobile_app_kunal_backend/gateway/client.ts` → `getStoredPoints` |
| 22 unmapped bindings, with reasons | `lib/api/metrics/profiles/northbound.profile.ts` |
| 90-day SQLite retention, vacuum note | `mobile_app_kunal_backend/gateway/client.ts` → `getStorageStatus` |

---

# Addendum — what S1 actually shipped (24 September 2026)

`GET /api/v1/gateways/{gateway_id}/fast-bess` is live and wired into the
website as the **Live BESS** screen. Verified against the deployed backend:
401 without a token, 422 on a malformed gateway UUID, `[]` for a gateway with
no samples — and `[]` for a fabricated UUID too, so as with gateway health an
empty result still cannot distinguish "no data yet" from "wrong gateway".

Against the four asks above:

**§1 per-signal quality — PARTIALLY MET.** The sample carries one `quality`
string plus `good_signal_count` / `bad_signal_count`. That is real and useful,
and it is not per-signal: when `bad_signal_count` is 3, three of the 63 numbers
in `pcs_values`/`bms_values` are stale and the payload does not say which.
Because the gateway holds the last decoded value in place on a failed read,
those three are indistinguishable from live ones. The Live BESS screen
therefore surfaces the count prominently and states plainly that the affected
registers cannot be identified — which is the best a client can do, but it is
not the same as being able to null them. **Still worth adding.**

**§2 identifier vocabulary — MET.** Samples carry `source_id` and `bess_id`,
and the signal names inside `pcs_values`/`bms_values` are the dictionary's
(`dc_voltage`, `display_soc`, `total_active_power`, `battery_max_temperature`).
Note the endpoint is addressed by **gateway_id**, which answers open question 1
— and makes `GET /gateways` and `GET /sites` more urgent, not less, since there
is still no way to discover an id.

**§3 server-side history aggregation — NOT MET.** `limit` is the only window
control: no `from`/`to`, no `bucket_ms`, and `limit` is *rejected* above 1000
rather than clamped. At 1 Hz that caps the reachable span at about 16.7
minutes. This is a latest reader, not the history endpoint — the measured case
for one is unchanged and still stands.

**Units — NOT SHIPPED.** Values are bare numbers. Units are currently hardcoded
per signal in the view, which is exactly the guess-from-the-name failure mode
§1 warned about; it is tolerable for six known tiles and will not scale to 63.

**Also missing:** no `cadence` field, so the sample rate is still inferred from
consecutive timestamps.

## What this unblocks, and what it does not

Live BESS renders real telemetry. The **dashboard still reads zero**, because
it needs a station list and `GET /sites` / `GET /gateways` remain unbuilt — a
per-gateway telemetry endpoint cannot populate a portfolio view.

Next most valuable, in order: the fleet list (unblocks the dashboard and the
station picker), per-signal quality (§1), then aggregated history (§3).
