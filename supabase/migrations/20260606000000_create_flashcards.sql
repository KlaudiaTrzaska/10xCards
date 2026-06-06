-- generations: one row per AI call
CREATE TABLE generations (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_text          text        NOT NULL,
  card_count_requested smallint    NOT NULL,
  model                text        NOT NULL,
  created_at           timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generations_insert_own"
  ON generations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "generations_select_own"
  ON generations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- flashcards: N rows per generation
CREATE TABLE flashcards (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id uuid    REFERENCES generations(id) ON DELETE CASCADE,
  front         text    NOT NULL,
  back          text    NOT NULL,
  status        text    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'accepted')),
  created_at    timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flashcards_insert_own"
  ON flashcards FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "flashcards_select_own"
  ON flashcards FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "flashcards_update_own"
  ON flashcards FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "flashcards_delete_own"
  ON flashcards FOR DELETE TO authenticated
  USING (user_id = auth.uid());
