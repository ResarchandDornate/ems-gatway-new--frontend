-- ═══════════════════════════════════════════════════════════════════════════
-- Tariff engine — negative tests.
--
-- A constraint that has never been seen to reject anything is a comment. Each
-- block below must FAIL; the expected SQLSTATE is named alongside.
-- ═══════════════════════════════════════════════════════════════════════════

SET search_path = tariff, public;

INSERT INTO discom (id, code, name, state_code, regulator)
VALUES ('33333333-3333-3333-3333-333333333333', 'TESTCO', 'Test Licensee', 'IN-MH', 'MERC');

INSERT INTO tariff_schedule (id, discom_id, category, voltage, tariff_code, valid,
  order_reference, order_date, entered_by, verified_by, verified_at, published)
VALUES ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
  'industrial','HT','HT-I', daterange('2026-04-01', NULL),
  'PLACEHOLDER','2026-03-28','seed','seed-reviewer', now(), true);

\echo ''
\echo '── A. Overlapping ToD slots must be rejected (expect 23P01 exclusion_violation) ──'
INSERT INTO tod_slot (schedule_id, kind, starts_at, ends_at)
VALUES ('44444444-4444-4444-4444-444444444444','normal','09:00','17:00');
INSERT INTO tod_slot (schedule_id, kind, starts_at, ends_at)
VALUES ('44444444-4444-4444-4444-444444444444','peak','16:00','20:00');   -- overlaps

\echo ''
\echo '── B. A published schedule must be immutable (expect raised exception) ──'
UPDATE tariff_schedule SET order_reference = 'tampered'
WHERE id = '44444444-4444-4444-4444-444444444444';

\echo ''
\echo '── C. A published schedule must not be deletable (expect raised exception) ──'
DELETE FROM tariff_schedule WHERE id = '44444444-4444-4444-4444-444444444444';

\echo ''
\echo '── D. Publishing without a second-person verification must be rejected (expect 23514) ──'
INSERT INTO tariff_schedule (discom_id, category, voltage, valid,
  order_reference, order_date, entered_by, published)
VALUES ('33333333-3333-3333-3333-333333333333','commercial','LT',
  daterange('2026-04-01', NULL), 'PLACEHOLDER','2026-03-28','seed', true);

\echo ''
\echo '── E. Overlapping schedules for one discom/category/voltage rejected (expect 23P01) ──'
INSERT INTO tariff_schedule (discom_id, category, voltage, tariff_code, valid,
  order_reference, order_date, entered_by, verified_by, verified_at, published)
VALUES ('33333333-3333-3333-3333-333333333333','industrial','HT','HT-I',
  daterange('2026-06-01', NULL), 'PLACEHOLDER','2026-05-28','seed','rev', now(), false);

\echo ''
\echo '── F. One station cannot have two overlapping supply records (expect 23P01) ──'
INSERT INTO station_supply (station_id, discom_id, category, voltage, valid)
VALUES ('cccccccc-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333',
        'industrial','HT', daterange('2026-04-01', NULL));
INSERT INTO station_supply (station_id, discom_id, category, voltage, valid)
VALUES ('cccccccc-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333',
        'commercial','LT', daterange('2026-09-01', NULL));
