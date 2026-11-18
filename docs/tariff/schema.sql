-- ═══════════════════════════════════════════════════════════════════════════
-- UnityESS tariff engine — schema
-- PostgreSQL 16 (+ TimescaleDB for the telemetry side, which lives elsewhere)
--
-- Purpose: turn metered energy into rupees, correctly, for every site we
-- monitor — and return NULL rather than a number when it cannot be done.
--
-- Three properties drive every decision below.
--
--   1. TARIFFS ARE VERSIONED IN TIME. A SERC tariff order supersedes the last
--      one, usually from 1 April. A savings figure for last September must be
--      computed with last September's rates, so published schedules are
--      immutable and superseded rather than edited.
--
--   2. COVERAGE IS PARTIAL AND MUST BE VISIBLE. We monitor sites across at
--      least seven states plus one in Germany. We will not hold every tariff
--      order on day one. A station with no schedule in force produces NULL
--      savings, never ₹0 — the difference between "we cannot price this" and
--      "you saved nothing" is the difference between an honest dashboard and
--      a false one.
--
--   3. MOST SITES HAVE NO BATTERY. 13 of 14 stations are solar/DG-PV only.
--      The engine prices solar self-consumption and export as first-class
--      cases; BESS arbitrage is one savings class among several, not the model.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- non-overlap constraints on ranges

CREATE SCHEMA IF NOT EXISTS tariff;
SET search_path = tariff, public;

-- Postgres ships range types over date, timestamp and numbers but NOT over
-- `time`. ToD slots are wall-clock windows, so we declare one. The gist
-- opclass comes for free with any range type, which is what lets the overlap
-- constraint on tod_slot work.
CREATE TYPE timerange AS RANGE (subtype = time);

-- ── Enumerations ───────────────────────────────────────────────────────────

-- Slot kinds are normalised across states even though the local names differ
-- ("solar hours", "off-peak", "night rebate"). The optimiser reasons about
-- kinds; the label carries whatever the tariff order actually calls it.
CREATE TYPE slot_kind AS ENUM ('peak', 'normal', 'off_peak', 'solar');

CREATE TYPE day_type  AS ENUM ('all', 'weekday', 'weekend', 'holiday');

CREATE TYPE supply_voltage AS ENUM ('LT', 'HT', 'EHT');

-- Category decides which schedule applies. Institutional is separate because
-- ICAI and Brahma Kumaris are not billed as commercial, and pricing them as
-- commercial would overstate their savings.
CREATE TYPE consumer_category AS ENUM (
  'industrial', 'commercial', 'institutional', 'residential',
  'agricultural', 'public_utility'
);

CREATE TYPE demand_basis AS ENUM (
  'contracted',            -- billed on contracted demand regardless of use
  'recorded',              -- billed on the month's maximum recorded demand
  'greater_of',            -- max(recorded, x% of contracted) — the common case
  'none'
);

CREATE TYPE levy_basis AS ENUM (
  'pct_of_energy_charge',  -- electricity duty, typically
  'per_kwh',               -- fuel surcharge, green cess
  'pct_of_demand_charge',
  'per_month'              -- fixed meter/service rent
);

-- Net metering settles export against import in kWh; net billing pays a
-- separate (lower) rate for export. Gross metering pays for all generation.
-- Which one applies changes solar savings by a large multiple.
CREATE TYPE export_regime AS ENUM ('net_metering', 'net_billing', 'gross_metering', 'none');

-- ── Licensees ──────────────────────────────────────────────────────────────

CREATE TABLE discom (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,        -- 'MSEDCL', 'BESCOM', 'UPPCL', 'NPCL'
  name           text NOT NULL,
  state_code     text NOT NULL,               -- ISO 3166-2:IN, e.g. 'IN-MH'
  country_code   text NOT NULL DEFAULT 'IN',  -- one station is in Germany
  regulator      text,                        -- 'MERC', 'KERC', 'UPERC'
  -- Every Indian licensee bills on IST regardless of where our servers run.
  -- Slot boundaries are wall-clock local times, so the zone is part of the
  -- pricing input, not a display concern.
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata',
  currency       char(3) NOT NULL DEFAULT 'INR',
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN discom.timezone IS
  'Slot times are local wall-clock. Storing the zone here is what makes a '
  '22:00-06:00 off-peak window mean the same thing for a site in Assam and '
  'one in Punjab despite both being IST — and what stops it breaking if we '
  'ever price a non-IST site.';

-- ── Tariff schedules ───────────────────────────────────────────────────────

-- One row per (licensee × category × voltage × validity period). This is the
-- unit that a SERC tariff order publishes and that we must never mutate once
-- it has priced anything.
CREATE TABLE tariff_schedule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discom_id          uuid NOT NULL REFERENCES discom(id),
  category           consumer_category NOT NULL,
  voltage            supply_voltage NOT NULL,
  -- Sub-category as the order words it, e.g. 'HT-I Industrial', 'LT-II(B)'.
  tariff_code        text,

  valid              daterange NOT NULL,      -- [from, to) — to is unbounded while current
  currency           char(3) NOT NULL DEFAULT 'INR',

  -- Provenance. A savings figure a customer disputes must be traceable to a
  -- published order, not to whoever typed the number in.
  order_reference    text NOT NULL,           -- 'MERC Case No. 226 of 2024'
  order_date         date NOT NULL,
  source_url         text,
  entered_by         text NOT NULL,
  verified_by        text,                    -- NULL until a second person checks
  verified_at        timestamptz,

  -- Once true the row is frozen (see trg_schedule_immutable). Only verified
  -- schedules are allowed to price anything.
  published          boolean NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Two schedules for the same licensee/category/voltage cannot overlap in
  -- time; that ambiguity would make a savings figure non-deterministic.
  CONSTRAINT schedule_no_overlap
    EXCLUDE USING gist (
      discom_id  WITH =,
      category   WITH =,
      voltage    WITH =,
      (coalesce(tariff_code, '')) WITH =,
      valid      WITH &&
    ),
  CONSTRAINT published_requires_verification
    CHECK (NOT published OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

-- ── Seasons ────────────────────────────────────────────────────────────────

-- Several states vary rates and slot boundaries by season. Modelled as named
-- month-day windows rather than dates so one schedule spans multiple years.
CREATE TABLE tariff_season (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  name         text NOT NULL,                 -- 'summer', 'monsoon', 'winter'
  start_month  smallint NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day    smallint NOT NULL CHECK (start_day   BETWEEN 1 AND 31),
  end_month    smallint NOT NULL CHECK (end_month   BETWEEN 1 AND 12),
  end_day      smallint NOT NULL CHECK (end_day     BETWEEN 1 AND 31),
  UNIQUE (schedule_id, name)
);

COMMENT ON TABLE tariff_season IS
  'A season may wrap the year end (Nov 1 - Feb 28). Resolution handles the '
  'wrap; do not assume start < end.';

-- ── Energy charge ──────────────────────────────────────────────────────────

-- Slab-based ₹/kWh. A schedule with a flat rate has exactly one slab with an
-- unbounded upper edge.
CREATE TABLE energy_charge_slab (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  season_id     uuid REFERENCES tariff_season(id) ON DELETE CASCADE,  -- NULL = all seasons
  kwh_from      numeric(12,2) NOT NULL DEFAULT 0,
  kwh_to        numeric(12,2),                -- NULL = unbounded
  rate_per_kwh  numeric(10,4) NOT NULL CHECK (rate_per_kwh >= 0),
  CHECK (kwh_to IS NULL OR kwh_to > kwh_from)
);

-- ── Time of day ────────────────────────────────────────────────────────────

-- ToD is expressed as a multiplier on the energy charge, an absolute adder,
-- or both, because states do it differently: MERC has historically used
-- ₹/kWh adders and rebates, while the 2023 Rights of Consumers amendment
-- frames solar and peak hours as multipliers of the normal rate.
CREATE TABLE tod_slot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  season_id     uuid REFERENCES tariff_season(id) ON DELETE CASCADE,  -- NULL = all seasons
  day_type      day_type NOT NULL DEFAULT 'all',

  kind          slot_kind NOT NULL,
  label         text,                          -- the order's own wording

  -- Local wall-clock. A window that crosses midnight is stored as TWO rows
  -- (22:00-24:00 and 00:00-06:00) so the non-overlap constraint below is
  -- expressible and resolution needs no special case. The loader splits them.
  starts_at     time NOT NULL,
  ends_at       time NOT NULL CHECK (ends_at > starts_at),

  multiplier    numeric(6,4) NOT NULL DEFAULT 1.0 CHECK (multiplier >= 0),
  adder_per_kwh numeric(10,4) NOT NULL DEFAULT 0,   -- may be negative (a rebate)

  -- No two slots of the same schedule/season/day-type may overlap. Gaps are
  -- checked separately (see v_tod_coverage_gap) because a gap is a data-entry
  -- error, not a constraint violation.
  CONSTRAINT tod_no_overlap
    EXCLUDE USING gist (
      schedule_id WITH =,
      (coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
      day_type    WITH =,
      (timerange(starts_at, ends_at)) WITH &&
    )
);

-- ── Demand charge ──────────────────────────────────────────────────────────

CREATE TABLE demand_charge (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id         uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  season_id           uuid REFERENCES tariff_season(id) ON DELETE CASCADE,
  basis               demand_basis NOT NULL,
  -- kVA for HT/EHT, kW for most LT. The unit changes what the meter reports
  -- and therefore what a peak-shaving saving is measured in.
  per_kva_per_month   numeric(10,4),
  per_kw_per_month    numeric(10,4),
  -- For 'greater_of': the floor as a percentage of contracted demand.
  min_pct_of_contract numeric(5,2),
  -- Penalty multiplier applied to demand recorded above contracted.
  excess_multiplier   numeric(6,4) NOT NULL DEFAULT 1.0,
  CHECK (per_kva_per_month IS NOT NULL OR per_kw_per_month IS NOT NULL OR basis = 'none')
);

-- ── Levies ─────────────────────────────────────────────────────────────────

-- Electricity duty, green cess, meter rent. Note that electricity supply is
-- exempt from GST in India — GST on our EQUIPMENT invoices is a separate
-- matter and does not belong in this schema.
CREATE TABLE levy (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  name          text NOT NULL,                 -- 'electricity_duty', 'green_cess'
  basis         levy_basis NOT NULL,
  value         numeric(10,4) NOT NULL,
  -- Some duties apply to the energy charge before ToD adjustment and some
  -- after. Getting this backwards moves the bill by a few percent.
  applies_after_tod boolean NOT NULL DEFAULT true
);

-- Fuel and power purchase adjustment: published monthly, varies, and is a
-- real component of the landed rate. Kept out of the schedule because it
-- changes far more often than a tariff order.
CREATE TABLE fuel_surcharge (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discom_id    uuid NOT NULL REFERENCES discom(id),
  billing_month date NOT NULL,                 -- first of month
  per_kwh      numeric(10,4) NOT NULL,         -- may be negative
  order_reference text,
  UNIQUE (discom_id, billing_month)
);

-- ── Power factor ───────────────────────────────────────────────────────────

CREATE TABLE power_factor_band (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  pf_from      numeric(4,3) NOT NULL,
  pf_to        numeric(4,3) NOT NULL,
  -- Positive = penalty, negative = incentive, as a percentage of the bill.
  adjustment_pct numeric(6,3) NOT NULL,
  CHECK (pf_to > pf_from)
);

-- ── Export / net metering ──────────────────────────────────────────────────

CREATE TABLE export_terms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    uuid NOT NULL REFERENCES tariff_schedule(id) ON DELETE CASCADE,
  regime         export_regime NOT NULL,
  -- Used by net_billing / gross_metering. NULL under net_metering, where
  -- export offsets import in kWh at the retail rate instead.
  rate_per_kwh   numeric(10,4),
  -- Banked units usually expire at the settlement period's end.
  settlement_period text,                      -- 'monthly' | 'annual'
  banking_allowed boolean NOT NULL DEFAULT true,
  CHECK (regime <> 'net_metering' OR rate_per_kwh IS NULL)
);

-- ── Station binding ────────────────────────────────────────────────────────

-- Connects a UGX station to the schedule that prices it. Time-bounded,
-- because a site can change category, upgrade voltage or renegotiate
-- contracted demand mid-life, and history must stay priced as it was billed.
CREATE TABLE station_supply (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The UGX station UUID. Deliberately not a FK: stations live in the vendor
  -- platform, and we must be able to record a tariff before that station has
  -- been mirrored into our own tables.
  station_id         uuid NOT NULL,
  discom_id          uuid NOT NULL REFERENCES discom(id),
  category           consumer_category NOT NULL,
  voltage            supply_voltage NOT NULL,
  tariff_code        text,

  consumer_number    text,                     -- as printed on the bill
  contracted_demand  numeric(10,2),            -- kVA or kW per `voltage`
  sanctioned_load_kw numeric(10,2),

  valid              daterange NOT NULL,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supply_no_overlap
    EXCLUDE USING gist (station_id WITH =, valid WITH &&)
);

CREATE INDEX ON station_supply (station_id);

-- ── Coverage ───────────────────────────────────────────────────────────────

-- Which stations can actually be priced today, and which cannot. The
-- dashboard reads this to decide between a figure and an explicit blank, so
-- it is a product surface, not an ops report.
CREATE VIEW v_station_pricing_coverage AS
SELECT
  ss.station_id,
  d.code                        AS discom_code,
  ss.category,
  ss.voltage,
  ts.id                         AS schedule_id,
  ts.published,
  (ts.id IS NOT NULL AND ts.published) AS priceable,
  CASE
    WHEN ss.id IS NULL       THEN 'no supply record for this station'
    WHEN ts.id IS NULL       THEN 'no tariff schedule for this discom/category/voltage'
    WHEN NOT ts.published    THEN 'schedule entered but not verified'
  END                           AS blocked_reason
FROM station_supply ss
JOIN discom d ON d.id = ss.discom_id
LEFT JOIN tariff_schedule ts
  ON  ts.discom_id = ss.discom_id
  AND ts.category  = ss.category
  AND ts.voltage   = ss.voltage
  AND coalesce(ts.tariff_code, '') = coalesce(ss.tariff_code, '')
  AND ts.valid @> CURRENT_DATE
WHERE ss.valid @> CURRENT_DATE;

-- A ToD day must be fully tiled. Anything less means an interval would fall
-- through resolution and price as if it were normal — silently.
CREATE VIEW v_tod_coverage_gap AS
WITH bounds AS (
  SELECT schedule_id, season_id, day_type,
         sum(EXTRACT(epoch FROM (ends_at - starts_at))) AS covered_s
  FROM tod_slot
  GROUP BY schedule_id, season_id, day_type
)
SELECT schedule_id, season_id, day_type,
       covered_s,
       86400 - covered_s AS uncovered_s
FROM bounds
WHERE covered_s <> 86400;

-- ── Immutability ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION forbid_published_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.published THEN
    -- Superseding is done by closing `valid` and inserting a new row, never
    -- by editing. A published schedule has priced figures a customer has
    -- already seen.
    RAISE EXCEPTION
      'tariff_schedule % is published and immutable; supersede it instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_schedule_immutable
  BEFORE UPDATE OR DELETE ON tariff_schedule
  FOR EACH ROW EXECUTE FUNCTION forbid_published_edit();
