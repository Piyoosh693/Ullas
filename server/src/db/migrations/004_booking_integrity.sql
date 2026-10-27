-- Strong database-level backstops for interval integrity. The application still
-- validates requests and uses transaction locks for friendly errors; these
-- constraints protect the data even if another code path bypasses those checks.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bookings a
    JOIN bookings b ON a.offer_id=b.offer_id AND a.id < b.id
      AND a.slot_start < b.slot_end AND a.slot_end > b.slot_start
      AND a.status IN ('requested','accepted')
      AND b.status IN ('requested','accepted')
  ) THEN
    RAISE EXCEPTION 'Cannot add booking overlap constraint because existing active bookings overlap; resolve conflicting records first.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM availability_windows a
    JOIN availability_windows b ON a.user_id=b.user_id AND a.id < b.id
      AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at
  ) THEN
    RAISE EXCEPTION 'Cannot add availability overlap constraint because existing provider windows overlap; resolve conflicting windows first.';
  END IF;
END $$;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlapping_active_slots
  EXCLUDE USING gist (
    offer_id WITH =,
    tstzrange(slot_start, slot_end, '[)') WITH &&
  ) WHERE (status IN ('requested','accepted'));

ALTER TABLE availability_windows
  ADD CONSTRAINT availability_no_overlapping_windows
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );
