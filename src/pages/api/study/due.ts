import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import { extractFsrsFields, previewReviewIntervals } from "@/lib/services/srs";
import type { StudyCardDTO, StudyDueResponseDTO } from "@/types";

export const prerender = false;

const SESSION_LIMIT = 20;

const STUDY_CARD_COLUMNS =
  "id, front, back, first_reviewed_at, fsrs_due, fsrs_stability, fsrs_difficulty, fsrs_scheduled_days, fsrs_learning_steps, fsrs_reps, fsrs_lapses, fsrs_state, fsrs_last_review";

async function fetchNextDueAt(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  userId: string,
  now: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("flashcards")
    .select("fsrs_due")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .gt("fsrs_due", now)
    .order("fsrs_due", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data?.fsrs_due ?? null;
}

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  const now = new Date().toISOString();

  const [{ data, count, error }, { count: totalAccepted, error: countError }, nextDueAt] = await Promise.all([
    supabase
      .from("flashcards")
      .select(STUDY_CARD_COLUMNS, { count: "exact" })
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .or(`fsrs_due.is.null,fsrs_due.lte.${now}`)
      .order("fsrs_due", { ascending: true, nullsFirst: true })
      .limit(SESSION_LIMIT),
    supabase
      .from("flashcards")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "accepted"),
    fetchNextDueAt(supabase, user.id, now),
  ]);

  if (error) {
    return json({ error: "Failed to fetch due cards" }, 500);
  }

  if (countError) {
    return json({ error: "Failed to fetch card count" }, 500);
  }

  const cards: StudyCardDTO[] = data.map((card) => ({
    ...card,
    interval_previews: previewReviewIntervals(extractFsrsFields(card)),
  }));

  const response: StudyDueResponseDTO = {
    cards,
    total_due: count ?? 0,
    total_accepted: totalAccepted ?? 0,
    next_due_at: nextDueAt,
  };

  return json(response);
};
