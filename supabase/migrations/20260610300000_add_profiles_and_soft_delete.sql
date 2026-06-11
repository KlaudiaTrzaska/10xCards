-- Phase 1: profiles table + soft-delete RLS guard
--
-- Creates:
--   profiles  — one row per auth.users row; holds deleted_at for soft-delete
--   Trigger   — auto-inserts profile row on every new signup
--   Backfill  — covers existing auth.users rows
--   RLS updates — adds deleted_at IS NULL predicate to SELECT/UPDATE/DELETE
--                 policies on generations, flashcards, review_logs

-- ---------------------------------------------------------------------------
-- profiles table
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Trigger: auto-create profile row on every new signup
-- SECURITY DEFINER so the function runs with superuser privileges and can
-- insert into profiles regardless of RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill: create profile rows for any auth.users rows that predate this
-- migration. ON CONFLICT DO NOTHING makes it safe to re-run.
-- Must appear AFTER trigger definition to avoid duplicate inserts if the
-- trigger fired during the backfill transaction (it will not, but ordering
-- makes the intent unambiguous).
-- ---------------------------------------------------------------------------

INSERT INTO profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS updates — add soft-delete guard to READ/MUTATE policies
--
-- Predicate added to every USING clause:
--   AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
--
-- INSERT policies are NOT modified — a banned user cannot authenticate,
-- so they cannot reach INSERT paths regardless.
-- ---------------------------------------------------------------------------

-- generations: SELECT
DROP POLICY IF EXISTS "generations_select_own" ON generations;
CREATE POLICY "generations_select_own"
  ON generations FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
  );

-- flashcards: SELECT
DROP POLICY IF EXISTS "flashcards_select_own" ON flashcards;
CREATE POLICY "flashcards_select_own"
  ON flashcards FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
  );

-- flashcards: UPDATE (preserve the generation-ownership WITH CHECK from
-- 20260610000000_enforce_flashcard_generation_ownership.sql)
DROP POLICY IF EXISTS "flashcards_update_own" ON flashcards;
CREATE POLICY "flashcards_update_own"
  ON flashcards FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
  )
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

-- flashcards: DELETE
DROP POLICY IF EXISTS "flashcards_delete_own" ON flashcards;
CREATE POLICY "flashcards_delete_own"
  ON flashcards FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
  );

-- review_logs: SELECT
DROP POLICY IF EXISTS "review_logs_select_own" ON review_logs;
CREATE POLICY "review_logs_select_own"
  ON review_logs FOR SELECT
  USING (
    user_id = auth.uid()
    AND (SELECT deleted_at FROM profiles WHERE id = auth.uid()) IS NULL
  );
