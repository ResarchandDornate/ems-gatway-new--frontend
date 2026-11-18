-- ═══════════════════════════════════════════════════════════════════════════
-- Tariff engine — behavioural tests
--
-- ⚠ EVERY RATE BELOW IS AN ILLUSTRATIVE PLACEHOLDER, NOT A REAL TARIFF.
--   Real values must be entered from the MERC/KERC/UPERC order itself and
--   verified by a second person before `published` is set. These exist only
--   to prove the mechanism.
-- ═══════════════════════════════════════════════════════════════════════════

SET search_path = tariff, public;
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO discom (id, code, name, state_code, regulator)
VALUES ('11111111-1111-1111-1111-111111111111', 'MSEDCL',
        'Maharashtra State Electricity Distribution Co. Ltd.', 'IN-MH', 'MERC');

INSERT INTO tariff_schedule (
  id, discom_id, category, voltage, tariff_code, valid,
  order_reference, order_date, entered_by, verified_by, verified_at, published)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'industrial', 'HT', 'HT-I',
  daterange('2026-04-01', NULL),
  'PLACEHOLDER — not a real order', '2026-03-28',
  'seed', 'seed-reviewer', now(), true);

INSERT INTO energy_charge_slab (schedule_id, kwh_from, kwh_to, rate_per_kwh)
VALUES ('22222222-2222-2222-2222-222222222222', 0, NULL, 7.5000);

-- A ToD day, fully tiled. The 22:00-06:00 off-peak window is stored as two
-- rows because it crosses midnight.
INSERT INTO tod_slot (schedule_id, kind, label, starts_at, ends_at, multiplier, adder_per_kwh)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'off_peak', 'Night',       '00:00', '06:00', 1.0, -1.5000),
  ('22222222-2222-2222-2222-222222222222', 'normal',   'Morning',     '06:00', '09:00', 1.0,  0.0000),
  ('22222222-2222-2222-2222-222222222222', 'solar',    'Solar hours', '09:00', '17:00', 0.8,  0.0000),
  ('22222222-2222-2222-2222-222222222222', 'peak',     'Evening peak','17:00', '22:00', 1.0,  1.1000),
  ('22222222-2222-2222-2222-222222222222', 'off_peak', 'Night',       '22:00', '24:00', 1.0, -1.5000);

INSERT INTO levy (schedule_id, name, basis, value, applies_after_tod)
VALUES ('22222222-2222-2222-2222-222222222222', 'electricity_duty', 'pct_of_energy_charge', 9.3, true);

INSERT INTO fuel_surcharge (discom_id, billing_month, per_kwh)
VALUES ('11111111-1111-1111-1111-111111111111', '2026-08-01', 0.3500);

-- Two stations: one bound to the schedule, one deliberately unbound.
INSERT INTO station_supply (station_id, discom_id, category, voltage, tariff_code,
                            contracted_demand, valid)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'industrial', 'HT', 'HT-I',
        500, daterange('2026-04-01', NULL));

INSERT INTO station_supply (station_id, discom_id, category, voltage, tariff_code, valid)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'institutional', 'LT', NULL,
        daterange('2026-04-01', NULL));

\echo ''
\echo '── 1. The ToD day is fully tiled (this view must be empty) ──'
SELECT * FROM v_tod_coverage_gap;

\echo ''
\echo '── 2. Rates across a day (IST) ──'
SELECT to_char(local_time,'HH24:MI') AS ist,
       slot_kind, slot_label,
       base_rate, tod_multiplier AS mult, tod_adder AS adder,
       energy_rate, fuel_surcharge AS fsa, duty, landed_rate
FROM (VALUES
  ('2026-08-18 02:00+05:30'::timestamptz),
  ('2026-08-18 07:00+05:30'::timestamptz),
  ('2026-08-18 12:00+05:30'::timestamptz),
  ('2026-08-18 19:00+05:30'::timestamptz),
  ('2026-08-18 23:00+05:30'::timestamptz)
) AS t(at), LATERAL resolve_rate('aaaaaaaa-0000-0000-0000-000000000001', t.at, 0);

\echo ''
\echo '── 3. Unpriceable station returns NO ROWS (not zero) ──'
SELECT count(*) AS rows_returned
FROM resolve_rate('bbbbbbbb-0000-0000-0000-000000000002', '2026-08-18 19:00+05:30', 0);

\echo ''
\echo '── 4. Coverage view names the reason ──'
SELECT station_id, priceable, blocked_reason FROM v_station_pricing_coverage ORDER BY station_id;

\echo ''
\echo '── 5. A day of BESS arbitrage, priced at the landed rate ──'
\echo '     charge 184.2 kWh in the night window, discharge 171.8 kWh at peak'
WITH night AS (SELECT landed_rate r FROM resolve_rate('aaaaaaaa-0000-0000-0000-000000000001','2026-08-18 02:00+05:30',0)),
     peak  AS (SELECT landed_rate r FROM resolve_rate('aaaaaaaa-0000-0000-0000-000000000001','2026-08-18 19:00+05:30',0))
SELECT
  round((SELECT r FROM night), 4)                        AS charge_rate,
  round((SELECT r FROM peak),  4)                        AS discharge_rate,
  round(184.2 * (SELECT r FROM night), 2)                AS cost_to_charge,
  round(171.8 * (SELECT r FROM peak),  2)                AS value_discharged,
  round(171.8 * (SELECT r FROM peak) - 184.2 * (SELECT r FROM night), 2) AS net_saving_inr;

ROLLBACK;
