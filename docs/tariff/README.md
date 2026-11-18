# Tariff engine

Turns metered energy into rupees for every site we monitor — and returns
*nothing* rather than a number when it cannot.

> **No real tariff data is in this directory.** Every rate in `test.sql` is an
> illustrative placeholder. Real values must be transcribed from the SERC
> order itself and verified by a second person before `published` is set.

| File | Purpose |
|------|---------|
| `schema.sql` | DDL — 11 tables, 2 views, immutability trigger |
| `pricing.sql` | `resolve_rate(station, instant, month_kwh)` — the one entry point |
| `test.sql` | Worked day: rates by slot, coverage, a day of arbitrage |
| `test_constraints.sql` | Six negative tests; every block must fail |

Verified against PostgreSQL 17. Apply in order: `schema.sql`, `pricing.sql`.

---

## Why it is shaped this way

**Tariffs are versioned in time.** A tariff order supersedes the last, usually
from 1 April. Savings for last September must use last September's rates, so a
published schedule is immutable — superseded by closing its `valid` range and
inserting a new row, never edited. The trigger enforces this; test B and C
prove it.

**Coverage is partial and must be visible.** We monitor sites across at least
seven states. We will not hold every tariff order on day one. `resolve_rate`
returns **zero rows** for a site it cannot price, and `v_station_pricing_coverage`
names the reason. The mobile dashboard already renders that as an explicit
blank with an explanation — never `₹0`, which would tell a customer they saved
nothing when the truth is that we do not know.

**Most sites have no battery.** 13 of 14 stations are solar/DG-PV only. The
engine prices energy at an instant; BESS arbitrage is one *consumer* of that
price, not the model.

---

## How a rate resolves

```
station_id + instant
   └─ station_supply     which licensee, category, voltage, tariff code
       └─ discom          timezone — slot boundaries are local wall-clock
           └─ tariff_schedule   published, valid on that local date
               ├─ tariff_season        month-day window (may wrap the year)
               ├─ energy_charge_slab   base ₹/kWh for month-to-date consumption
               ├─ tod_slot             multiplier and/or ₹/kWh adder
               ├─ levy                 electricity duty, cess
               └─ fuel_surcharge       per licensee per billing month
                   → landed ₹/kWh, decomposed
```

The function returns every component, not just the total, so a disputed figure
can be taken apart in front of a customer.

Two details that are easy to get wrong and are handled explicitly:

- **Windows crossing midnight** are stored as two rows (`22:00–24:00` and
  `00:00–06:00`). That keeps the non-overlap exclusion constraint expressible
  and removes a special case from resolution.
- **A day must be fully tiled.** `v_tod_coverage_gap` must be empty. An
  uncovered hour would silently price as normal.

---

## Savings classes

| Class | Computable from telemetry alone | Note |
|---|---|---|
| BESS arbitrage | **Yes** | `discharge × rate(t) − charge × rate(t)`, both landed |
| Solar self-consumption | **Yes** | generation consumed on site × landed rate avoided |
| Export credit | **Yes, once `export_terms` is filled** | net metering offsets in kWh; net billing pays a separate, lower rate — a large multiple apart |
| Demand-charge reduction | **No — needs a counterfactual** | see below |

**Demand charges deserve a warning.** Peak shaving reduces billed demand, and
on an HT industrial connection that can exceed the energy saving. But the
saving is *what the maximum demand would have been without the battery* — a
counterfactual, not a measurement. Publishing it requires an agreed method
(pre-installation baseline month, or load reconstruction from `load = grid +
battery`). Until that method is agreed and documented, this class returns NULL
like any other unpriceable figure. Do not let it be estimated into a proposal.

---

## To go live

1. **Fill `discom`** for the licensees actually serving our sites — at minimum
   UPPCL/NPCL (UP), BESCOM (Karnataka), APDCL (Assam), PSPCL (Punjab),
   TGSPDCL (Telangana), MSEDCL and the Mumbai licensee (Maharashtra).
2. **Transcribe one tariff order per (licensee × category × voltage)** we
   actually serve. This is the slow part and it is manual by design.
3. **Create a `station_supply` row per station** — category, voltage,
   contracted demand, consumer number. This needs a copy of each site's bill.
   Note that ICAI and Brahma Kumaris are institutional, not commercial;
   pricing them as commercial would overstate their savings.
4. **Load `fuel_surcharge` monthly.** It moves, and it is a real part of the
   landed rate.
5. Watch `v_station_pricing_coverage` go green site by site.

The one non-Indian station (`Customer D`, Berlin) is out of scope — `discom`
carries `country_code` and `currency` so it can be excluded cleanly rather
than mispriced in rupees.

---

## Open questions

1. Which sites are on **open access**? Wheeling and cross-subsidy surcharges
   are not modelled yet and change the landed rate materially.
2. What is the agreed **demand-charge counterfactual**? Blocks that savings
   class entirely.
3. Are any sites on **net billing** rather than net metering? Changes solar
   savings by a multiple.
4. Do we hold each site's **consumer number and contracted demand**? Without
   them `station_supply` cannot be completed.
5. Which sites have **ToD applied at all**? The 2023 Rights of Consumers
   amendment phases it in by consumer size and state; not every LT site is on
   a ToD tariff yet.
