/** Start of the local calendar day for a timestamp. */
function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Whole calendar days from `from` to `to` in local time (midnight-to-midnight). */
function calendarDaysUntil(from: Date, to: Date): number {
  const fromDay = startOfLocalDay(from).getTime();
  const toDay = startOfLocalDay(to).getTime();
  return Math.round((toDay - fromDay) / 86_400_000);
}

/** Human-readable relative time until a scheduled review (English UI). */
export function formatRelativeReviewTime(due: string | Date, now: Date = new Date()): string {
  const dueDate = typeof due === "string" ? new Date(due) : due;
  const ms = dueDate.getTime() - now.getTime();

  if (ms <= 0) {
    return "now";
  }

  const daysUntil = calendarDaysUntil(now, dueDate);

  if (daysUntil >= 3) {
    return `in ${daysUntil} days`;
  }
  if (daysUntil === 2) {
    return "day after tomorrow";
  }
  if (daysUntil === 1) {
    return "tomorrow";
  }

  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }

  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
}
