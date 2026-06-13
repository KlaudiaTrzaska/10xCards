import type { ReviewOutcome } from "@/types";

/** Fixed review intervals shown on grade buttons and used for scheduling. */
export const OUTCOME_INTERVAL_DAYS: Record<ReviewOutcome, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 5,
};

export const OUTCOME_INTERVAL_LABELS: Record<ReviewOutcome, string> = {
  again: "tomorrow",
  hard: "day after tomorrow",
  good: "in 3 days",
  easy: "in 5 days",
};

export function addCalendarDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + days);
  return result;
}
