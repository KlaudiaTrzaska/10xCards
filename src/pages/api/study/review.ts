import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import { scheduleReview, mapOutcomeToRating } from "@/lib/services/srs";
import type { FSRSCardFields } from "@/lib/services/srs";
import type { SubmitReviewResponseDTO } from "@/types";

export const prerender = false;

const ReviewSchema = z.object({
  cardId: z.uuid(),
  outcome: z.enum(["again", "hard", "good", "easy"]),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { cardId, outcome } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  // Fetch the card — must belong to this user and be accepted
  const { data: card, error: fetchError } = await supabase
    .from("flashcards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .eq("status", "accepted")
    .single();

  if (fetchError) {
    return json({ error: "Card not found" }, 404);
  }

  const now = new Date();

  // Extract current FSRS state (null when card has never been reviewed)
  const currentFields: FSRSCardFields | null =
    card.fsrs_state === null
      ? null
      : {
          fsrs_due: card.fsrs_due,
          fsrs_stability: card.fsrs_stability,
          fsrs_difficulty: card.fsrs_difficulty,
          fsrs_scheduled_days: card.fsrs_scheduled_days,
          fsrs_learning_steps: card.fsrs_learning_steps,
          fsrs_reps: card.fsrs_reps,
          fsrs_lapses: card.fsrs_lapses,
          fsrs_state: card.fsrs_state,
          fsrs_last_review: card.fsrs_last_review,
        };

  const { newCardFields, reviewLogFields } = scheduleReview(currentFields, outcome, now);

  // INSERT review log first — if this succeeds but the card UPDATE fails,
  // the user will re-grade and a second log is created (acceptable for MVP).
  // This order ensures no review is silently lost.
  const { error: logError } = await supabase.from("review_logs").insert({
    user_id: user.id,
    card_id: cardId,
    rating: reviewLogFields.rating,
    state: reviewLogFields.state,
    stability: reviewLogFields.stability,
    difficulty: reviewLogFields.difficulty,
    scheduled_days: reviewLogFields.scheduled_days,
    reviewed_at: reviewLogFields.reviewed_at,
  });

  if (logError) {
    return json({ error: "Failed to record review" }, 500);
  }

  // UPDATE flashcard scheduling columns.
  // COALESCE semantics for first_reviewed_at: preserve existing value if already set.
  const firstReviewedAt = card.first_reviewed_at ?? now.toISOString();

  const { error: updateError } = await supabase
    .from("flashcards")
    .update({
      fsrs_due: newCardFields.fsrs_due,
      fsrs_stability: newCardFields.fsrs_stability,
      fsrs_difficulty: newCardFields.fsrs_difficulty,
      fsrs_scheduled_days: newCardFields.fsrs_scheduled_days,
      fsrs_learning_steps: newCardFields.fsrs_learning_steps,
      fsrs_reps: newCardFields.fsrs_reps,
      fsrs_lapses: newCardFields.fsrs_lapses,
      fsrs_state: newCardFields.fsrs_state,
      fsrs_last_review: newCardFields.fsrs_last_review,
      first_reviewed_at: firstReviewedAt,
    })
    .eq("id", cardId)
    .eq("user_id", user.id);

  if (updateError) {
    return json({ error: "Failed to update card schedule" }, 500);
  }

  const response: SubmitReviewResponseDTO = {
    scheduledFor: newCardFields.fsrs_due ?? now.toISOString(),
    outcome,
  };

  return json(response);
};

// Export for potential use in tests
export { mapOutcomeToRating };
