/** Human-readable relative time until a scheduled review (English UI). */
export function formatRelativeReviewTime(due: string | Date, now: Date = new Date()): string {
  const dueDate = typeof due === "string" ? new Date(due) : due;
  const ms = dueDate.getTime() - now.getTime();

  if (ms <= 0) {
    return "now";
  }

  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }

  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 24) {
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }

  const days = Math.max(1, Math.round(ms / 86_400_000));
  if (days === 1) {
    return "tomorrow";
  }
  if (days === 2) {
    return "day after tomorrow";
  }

  return `in ${days} days`;
}
