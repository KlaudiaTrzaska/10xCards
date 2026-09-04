import { Rating, State } from "ts-fsrs";
import { addCalendarDays, OUTCOME_INTERVAL_DAYS } from "@/lib/study-intervals";
import type { ReviewOutcome, ReviewIntervalPreview } from "@/types";

// Mirrors the 9 fsrs_* nullable columns on flashcards
export interface FSRSCardFields {
  fsrs_due: string | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_scheduled_days: number | null;
  fsrs_learning_steps: number | null;
  fsrs_reps: number | null;
  fsrs_lapses: number | null;
  fsrs_state: number | null;
  fsrs_last_review: string | null;
}

// Fields to INSERT into review_logs
export interface ReviewLogFields {
  rating: number;
  state: number; // pre-review state
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reviewed_at: string; // ISO string
}

export function mapOutcomeToRating(outcome: ReviewOutcome): Rating {
  switch (outcome) {
    case "again":
      return Rating.Again; // 1
    case "hard":
      return Rating.Hard; // 2
    case "good":
      return Rating.Good; // 3
    case "easy":
      return Rating.Easy; // 4
  }
}

export function extractFsrsFields(card: {
  fsrs_due: string | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_scheduled_days: number | null;
  fsrs_learning_steps: number | null;
  fsrs_reps: number | null;
  fsrs_lapses: number | null;
  fsrs_state: number | null;
  fsrs_last_review: string | null;
}): FSRSCardFields | null {
  if (card.fsrs_state === null) {
    return null;
  }

  return {
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
}

function buildScheduledReview(
  currentFields: FSRSCardFields | null,
  outcome: ReviewOutcome,
  now: Date,
): { newCardFields: FSRSCardFields; reviewLogFields: ReviewLogFields } {
  const scheduledDays = OUTCOME_INTERVAL_DAYS[outcome];
  const due = addCalendarDays(now, scheduledDays);
  const preReviewState = currentFields?.fsrs_state ?? State.New;
  const previousReps = currentFields?.fsrs_reps ?? 0;
  const previousLapses = currentFields?.fsrs_lapses ?? 0;
  const previousDifficulty = currentFields?.fsrs_difficulty ?? 5;
  const previousStability = currentFields?.fsrs_stability ?? scheduledDays;

  return {
    newCardFields: {
      fsrs_due: due.toISOString(),
      fsrs_stability: Math.max(previousStability, scheduledDays),
      fsrs_difficulty: previousDifficulty,
      fsrs_scheduled_days: scheduledDays,
      fsrs_learning_steps: 0,
      fsrs_reps: previousReps + 1,
      fsrs_lapses: outcome === "again" ? previousLapses + 1 : previousLapses,
      fsrs_state: State.Review,
      fsrs_last_review: now.toISOString(),
    },
    reviewLogFields: {
      rating: mapOutcomeToRating(outcome),
      state: preReviewState,
      stability: Math.max(previousStability, scheduledDays),
      difficulty: previousDifficulty,
      scheduled_days: scheduledDays,
      reviewed_at: now.toISOString(),
    },
  };
}

export function previewReviewIntervals(
  _currentFields: FSRSCardFields | null,
  now: Date = new Date(),
): Record<ReviewOutcome, ReviewIntervalPreview> {
  const outcomes: ReviewOutcome[] = ["again", "hard", "good", "easy"];
  const previews = {} as Record<ReviewOutcome, ReviewIntervalPreview>;

  for (const outcome of outcomes) {
    const scheduledDays = OUTCOME_INTERVAL_DAYS[outcome];
    previews[outcome] = {
      scheduledFor: addCalendarDays(now, scheduledDays).toISOString(),
      scheduledDays,
    };
  }

  return previews;
}

export function scheduleReview(
  currentFields: FSRSCardFields | null,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): { newCardFields: FSRSCardFields; reviewLogFields: ReviewLogFields } {
  return buildScheduledReview(currentFields, outcome, now);
}
