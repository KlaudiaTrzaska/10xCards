import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from "ts-fsrs";
import type { ReviewOutcome } from "@/types";

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

// Local representation of a ts-fsrs RecordLogItem to work around type-resolution
// issues between the strict ESLint project-service config and ts-fsrs declarations.
interface FSRSItem {
  card: Card;
  log: {
    rating: Rating;
    state: State;
    stability: number;
    difficulty: number;
    scheduled_days: number;
    review: Date;
  };
}

const scheduler = fsrs(generatorParameters());

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

function rehydrateCard(fields: FSRSCardFields): Card {
  const base = createEmptyCard();
  return {
    ...base,
    due: fields.fsrs_due ? new Date(fields.fsrs_due) : new Date(),
    stability: fields.fsrs_stability ?? 0,
    difficulty: fields.fsrs_difficulty ?? 0,
    scheduled_days: fields.fsrs_scheduled_days ?? 0,
    learning_steps: fields.fsrs_learning_steps ?? 0,
    reps: fields.fsrs_reps ?? 0,
    lapses: fields.fsrs_lapses ?? 0,
    state: fields.fsrs_state ?? State.New,
    last_review: fields.fsrs_last_review ? new Date(fields.fsrs_last_review) : undefined,
  };
}

function cardToFields(card: Card): FSRSCardFields {
  return {
    fsrs_due: card.due.toISOString(),
    fsrs_stability: card.stability,
    fsrs_difficulty: card.difficulty,
    fsrs_scheduled_days: card.scheduled_days,
    fsrs_learning_steps: card.learning_steps,
    fsrs_reps: card.reps,
    fsrs_lapses: card.lapses,
    fsrs_state: card.state,
    fsrs_last_review: card.last_review?.toISOString() ?? null,
  };
}

export function scheduleReview(
  currentFields: FSRSCardFields | null,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): { newCardFields: FSRSCardFields; reviewLogFields: ReviewLogFields } {
  const isNew = currentFields?.fsrs_state == null;
  const card = isNew ? createEmptyCard(now) : rehydrateCard(currentFields);

  const rating = mapOutcomeToRating(outcome);
  // Cast through unknown to FSRSItem[] to resolve type declarations from ts-fsrs
  const recordLog = scheduler.repeat(card, now) as unknown as Record<Rating, FSRSItem>;
  const item = recordLog[rating];

  return {
    newCardFields: cardToFields(item.card),
    reviewLogFields: {
      rating: item.log.rating,
      state: item.log.state, // pre-review state captured by ts-fsrs
      stability: item.log.stability,
      difficulty: item.log.difficulty,
      scheduled_days: item.log.scheduled_days,
      reviewed_at: item.log.review.toISOString(),
    },
  };
}
