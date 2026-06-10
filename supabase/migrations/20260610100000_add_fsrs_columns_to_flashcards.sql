-- Add FSRS scheduling columns to flashcards.
-- All columns are nullable; NULL means the card has never been reviewed (treated as New by the SRS service).
ALTER TABLE flashcards
  ADD COLUMN fsrs_due           timestamptz,
  ADD COLUMN fsrs_stability     real,
  ADD COLUMN fsrs_difficulty    real,
  ADD COLUMN fsrs_scheduled_days real,
  ADD COLUMN fsrs_learning_steps integer,
  ADD COLUMN fsrs_reps          smallint,
  ADD COLUMN fsrs_lapses        smallint,
  ADD COLUMN fsrs_state         smallint,
  ADD COLUMN fsrs_last_review   timestamptz;

-- Partial index covering the due-card query:
--   WHERE status = 'accepted' AND (fsrs_due IS NULL OR fsrs_due <= NOW())
--   ORDER BY fsrs_due ASC NULLS FIRST LIMIT 20
CREATE INDEX flashcards_due_idx ON flashcards (user_id, fsrs_due)
  WHERE status = 'accepted';
