-- Append-only review history table.
-- No UPDATE or DELETE RLS policies — review history is immutable.
-- ON DELETE CASCADE on both FKs:
--   user deletion removes all their data.
--   card deletion is only possible before first review (first_reviewed_at IS NULL lock in S-03),
--   so review_logs will always be empty for any card that can be deleted.
CREATE TABLE IF NOT EXISTS review_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id        uuid        NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  rating         smallint    NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state          smallint    NOT NULL CHECK (state BETWEEN 0 AND 3),
  stability      real        NOT NULL,
  difficulty     real        NOT NULL,
  scheduled_days real        NOT NULL,
  reviewed_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;

-- Users may only read their own review logs.
CREATE POLICY review_logs_select_own ON review_logs
  FOR SELECT USING (user_id = auth.uid());

-- Users may only insert review logs for themselves.
CREATE POLICY review_logs_insert_own ON review_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX review_logs_user_card_idx ON review_logs (user_id, card_id);
