-- ═══════════════════════════════════════════════════════════════════════════
-- UnityESS tariff engine — rate resolution
--
-- One entry point: resolve_rate(station, instant, month_kwh). It returns the
-- landed ₹/kWh a site pays at that instant, decomposed into its parts so a
-- disputed figure can be taken apart in front of a customer.
--
-- It returns NO ROW when the site cannot be priced. Callers must treat that as
-- an absence and render it as such — never coalesce it to zero.
-- ═══════════════════════════════════════════════════════════════════════════

SET search_path = tariff, public;

-- Does a month-day fall inside a season window? Seasons may wrap the year end
-- (Nov 1 - Feb 28), which is why this is not a simple BETWEEN.
CREATE OR REPLACE FUNCTION season_contains(
  s_start_m smallint, s_start_d smallint,
  s_end_m   smallint, s_end_d   smallint,
  probe     date
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN (s_start_m, s_start_d) <= (s_end_m, s_end_d)
      THEN (EXTRACT(month FROM probe)::smallint, EXTRACT(day FROM probe)::smallint)
             BETWEEN (s_start_m, s_start_d) AND (s_end_m, s_end_d)
    ELSE   (EXTRACT(month FROM probe)::smallint, EXTRACT(day FROM probe)::smallint)
             >= (s_start_m, s_start_d)
        OR (EXTRACT(month FROM probe)::smallint, EXTRACT(day FROM probe)::smallint)
             <= (s_end_m, s_end_d)
  END;
$$;

CREATE OR REPLACE FUNCTION resolve_rate(
  p_station    uuid,
  p_at         timestamptz,
  -- Month-to-date consumption, for slab selection. Pass 0 for a flat tariff.
  p_month_kwh  numeric DEFAULT 0
)
RETURNS TABLE (
  schedule_id     uuid,
  discom_code     text,
  local_time      timestamp,
  season_name     text,
  slot_kind       slot_kind,
  slot_label      text,
  base_rate       numeric,   -- ₹/kWh energy charge before ToD
  tod_multiplier  numeric,
  tod_adder       numeric,
  energy_rate     numeric,   -- after ToD
  fuel_surcharge  numeric,
  duty            numeric,
  landed_rate     numeric,   -- what the site actually pays per kWh
  currency        char(3)
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_supply   station_supply%ROWTYPE;
  v_discom   discom%ROWTYPE;
  v_sched    tariff_schedule%ROWTYPE;
  v_local    timestamp;
  v_localdate date;
  v_season   tariff_season%ROWTYPE;
  v_daytype  day_type;
  v_slot     tod_slot%ROWTYPE;
  v_base     numeric;
  v_fsa      numeric := 0;
  v_energy   numeric;
  v_duty     numeric := 0;
BEGIN
  SELECT * INTO v_supply
  FROM station_supply ss
  WHERE ss.station_id = p_station AND ss.valid @> p_at::date;
  IF NOT FOUND THEN RETURN; END IF;              -- no supply record → unpriceable

  SELECT * INTO v_discom FROM discom d WHERE d.id = v_supply.discom_id;

  -- Slot boundaries are local wall-clock, so everything downstream works in
  -- the licensee's zone rather than the server's.
  v_local := p_at AT TIME ZONE v_discom.timezone;
  v_localdate := v_local::date;

  SELECT * INTO v_sched
  FROM tariff_schedule ts
  WHERE ts.discom_id = v_supply.discom_id
    AND ts.category  = v_supply.category
    AND ts.voltage   = v_supply.voltage
    AND coalesce(ts.tariff_code, '') = coalesce(v_supply.tariff_code, '')
    AND ts.valid @> v_localdate
    AND ts.published;
  IF NOT FOUND THEN RETURN; END IF;              -- no published schedule → unpriceable

  SELECT * INTO v_season
  FROM tariff_season s
  WHERE s.schedule_id = v_sched.id
    AND season_contains(s.start_month, s.start_day, s.end_month, s.end_day, v_localdate)
  LIMIT 1;

  v_daytype := CASE WHEN EXTRACT(isodow FROM v_localdate) >= 6 THEN 'weekend' ELSE 'weekday' END;

  -- Marginal slab for the month's consumption so far.
  --
  -- Every column here is alias-qualified. `schedule_id` is also the name of an
  -- OUT parameter of this function, and PL/pgSQL resolves a bare identifier
  -- against its own variables before the table's columns — which makes the
  -- unqualified form ambiguous and a runtime error, not a compile-time one.
  SELECT ecs.rate_per_kwh INTO v_base
  FROM energy_charge_slab ecs
  WHERE ecs.schedule_id = v_sched.id
    AND (ecs.season_id = v_season.id OR ecs.season_id IS NULL)
    AND ecs.kwh_from <= p_month_kwh
    AND (ecs.kwh_to IS NULL OR ecs.kwh_to > p_month_kwh)
  ORDER BY ecs.season_id NULLS LAST, ecs.kwh_from DESC
  LIMIT 1;
  IF v_base IS NULL THEN RETURN; END IF;         -- schedule has no energy charge

  -- A day-type-specific slot wins over an 'all' slot; a season-specific slot
  -- wins over a season-agnostic one.
  SELECT * INTO v_slot
  FROM tod_slot t
  WHERE t.schedule_id = v_sched.id
    AND (t.season_id = v_season.id OR t.season_id IS NULL)
    AND (t.day_type = v_daytype OR t.day_type = 'all')
    AND v_local::time >= t.starts_at
    AND v_local::time <  t.ends_at
  ORDER BY (t.season_id IS NOT NULL) DESC, (t.day_type <> 'all') DESC
  LIMIT 1;

  -- No ToD slot is not an error: many LT schedules have none. Treat as normal.
  IF NOT FOUND THEN
    v_slot.kind := 'normal';
    v_slot.label := NULL;
    v_slot.multiplier := 1.0;
    v_slot.adder_per_kwh := 0;
  END IF;

  v_energy := v_base * v_slot.multiplier + v_slot.adder_per_kwh;

  SELECT fs.per_kwh INTO v_fsa
  FROM fuel_surcharge fs
  WHERE fs.discom_id = v_supply.discom_id
    AND fs.billing_month = date_trunc('month', v_localdate)::date;
  v_fsa := coalesce(v_fsa, 0);

  -- Duty applied to the energy charge. `applies_after_tod` decides whether the
  -- ToD adjustment is in the base it is charged on.
  SELECT coalesce(sum(
    CASE l.basis
      WHEN 'pct_of_energy_charge' THEN
        (CASE WHEN l.applies_after_tod THEN v_energy ELSE v_base END) * l.value / 100.0
      WHEN 'per_kwh' THEN l.value
      ELSE 0
    END), 0)
  INTO v_duty
  FROM levy l
  WHERE l.schedule_id = v_sched.id;

  RETURN QUERY SELECT
    v_sched.id, v_discom.code, v_local,
    v_season.name, v_slot.kind, v_slot.label,
    v_base, v_slot.multiplier, v_slot.adder_per_kwh,
    v_energy, v_fsa, v_duty,
    round(v_energy + v_fsa + v_duty, 4),
    v_sched.currency;
END;
$$;

COMMENT ON FUNCTION resolve_rate IS
  'Returns zero rows when the station cannot be priced — no supply record, no '
  'published schedule, or a schedule with no energy charge. Callers must '
  'surface that as an explicit absence. Coalescing it to 0 would tell a '
  'customer they saved nothing when in fact we simply do not know.';
