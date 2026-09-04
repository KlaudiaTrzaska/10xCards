DROP POLICY IF EXISTS "flashcards_insert_own" ON flashcards;
DROP POLICY IF EXISTS "flashcards_update_own" ON flashcards;

CREATE POLICY "flashcards_insert_own"
  ON flashcards FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      generation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM generations
        WHERE generations.id = flashcards.generation_id
          AND generations.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "flashcards_update_own"
  ON flashcards FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      generation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM generations
        WHERE generations.id = flashcards.generation_id
          AND generations.user_id = auth.uid()
      )
    )
  );
