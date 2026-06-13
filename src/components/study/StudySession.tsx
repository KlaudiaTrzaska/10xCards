import { useEffect, useState } from "react";
import { formatRelativeReviewTime } from "@/lib/format-interval";
import { OUTCOME_INTERVAL_LABELS } from "@/lib/study-intervals";
import { cn } from "@/lib/utils";
import type { ReviewOutcome, StudyCardDTO, StudyDueResponseDTO, SubmitReviewResponseDTO } from "@/types";

// ── Session state machine ────────────────────────────────────────────────────

type SessionState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty-no-cards" }
  | { phase: "empty-no-due"; nextDueAt: string | null }
  | {
      phase: "studying";
      cards: StudyCardDTO[];
      totalDue: number;
      currentIndex: number;
      isFlipped: boolean;
      isSubmitting: boolean;
      lastError: string | null;
      totalReviewed: number;
    }
  | { phase: "complete"; totalReviewed: number; nextDueAt: string | null };

// ── Grade button config ──────────────────────────────────────────────────────

const GRADES: { outcome: ReviewOutcome; label: string; className: string }[] = [
  { outcome: "again", label: "Again", className: "border-red-500/40 bg-red-900/30 text-red-300 hover:bg-red-900/50" },
  {
    outcome: "hard",
    label: "Hard",
    className: "border-orange-500/40 bg-orange-900/30 text-orange-300 hover:bg-orange-900/50",
  },
  {
    outcome: "good",
    label: "Good",
    className: "border-green-500/40 bg-green-900/30 text-green-300 hover:bg-green-900/50",
  },
  { outcome: "easy", label: "Easy", className: "border-blue-500/40 bg-blue-900/30 text-blue-300 hover:bg-blue-900/50" },
];

function nextReviewMessage(nextDueAt: string | null): string {
  if (!nextDueAt) {
    return "Check back later for your next session.";
  }

  return `Next flashcard ${formatRelativeReviewTime(nextDueAt)}.`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StudySession() {
  const [session, setSession] = useState<SessionState>({ phase: "loading" });

  // Load due cards on mount
  useEffect(() => {
    let cancelled = false;

    async function loadDueCards() {
      try {
        const res = await fetch("/api/study/due");
        const data = (await res.json()) as StudyDueResponseDTO & { error?: string };

        if (cancelled) return;

        if (!res.ok) {
          setSession({ phase: "error", message: data.error ?? "Failed to load cards." });
          return;
        }

        if (data.cards.length === 0) {
          if (data.total_accepted === 0) {
            setSession({ phase: "empty-no-cards" });
          } else {
            setSession({ phase: "empty-no-due", nextDueAt: data.next_due_at });
          }
          return;
        }

        setSession({
          phase: "studying",
          cards: data.cards,
          totalDue: data.total_due,
          currentIndex: 0,
          isFlipped: false,
          isSubmitting: false,
          lastError: null,
          totalReviewed: 0,
        });
      } catch {
        if (!cancelled) {
          setSession({ phase: "error", message: "Network error. Please refresh and try again." });
        }
      }
    }

    void loadDueCards();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGrade(outcome: ReviewOutcome) {
    if (session.phase !== "studying") return;

    const card = session.cards[session.currentIndex];
    setSession({ ...session, isSubmitting: true, lastError: null });

    try {
      const res = await fetch("/api/study/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.id, outcome }),
      });

      const data = (await res.json()) as SubmitReviewResponseDTO & { error?: string };

      if (!res.ok) {
        setSession({ ...session, isSubmitting: false, lastError: data.error ?? "Failed to submit review." });
        return;
      }

      const totalReviewed = session.totalReviewed + 1;
      const nextIndex = session.currentIndex + 1;

      if (nextIndex >= session.cards.length) {
        try {
          const dueRes = await fetch("/api/study/due");
          const dueData = (await dueRes.json()) as StudyDueResponseDTO & { error?: string };

          if (dueRes.ok && dueData.cards.length > 0) {
            setSession({
              phase: "studying",
              cards: dueData.cards,
              totalDue: dueData.total_due,
              currentIndex: 0,
              isFlipped: false,
              isSubmitting: false,
              lastError: null,
              totalReviewed,
            });
            return;
          }

          setSession({
            phase: "complete",
            totalReviewed,
            nextDueAt: dueRes.ok ? dueData.next_due_at : null,
          });
        } catch {
          // Review already persisted — complete session even if due refresh fails
          setSession({
            phase: "complete",
            totalReviewed,
            nextDueAt: null,
          });
        }
        return;
      }

      setSession({
        ...session,
        currentIndex: nextIndex,
        isFlipped: false,
        isSubmitting: false,
        lastError: null,
        totalReviewed,
      });
    } catch {
      setSession({ ...session, isSubmitting: false, lastError: "Network error — please try again." });
    }
  }

  // ── Render branches ────────────────────────────────────────────────────────

  if (session.phase === "loading") {
    return (
      <div className="py-16 text-center text-blue-100/50">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
        Loading your cards…
      </div>
    );
  }

  if (session.phase === "error") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-6 text-center text-red-300">
        {session.message}
      </div>
    );
  }

  if (session.phase === "empty-no-cards") {
    return (
      <div className="py-16 text-center">
        <p className="mb-2 text-lg font-medium text-white">You have no flashcards yet.</p>
        <p className="mb-6 text-sm text-blue-100/60">Generate some cards from your study material first.</p>
        <a
          href="/generate"
          className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-500"
        >
          Generate Flashcards →
        </a>
      </div>
    );
  }

  if (session.phase === "empty-no-due" || session.phase === "complete") {
    const reviewedNote =
      session.phase === "complete" && session.totalReviewed > 0
        ? `${session.totalReviewed} ${session.totalReviewed === 1 ? "card" : "cards"} reviewed this session.`
        : null;

    return (
      <div className="py-16 text-center">
        <p className="mb-2 text-lg font-medium text-white">Nothing to review.</p>
        <p className="mb-2 text-sm text-blue-100/60">{nextReviewMessage(session.nextDueAt)}</p>
        {reviewedNote && <p className="mb-6 text-xs text-blue-100/40">{reviewedNote}</p>}
        <a
          href="/deck"
          className="inline-flex items-center justify-center rounded-lg border border-white/20 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          View My Deck
        </a>
      </div>
    );
  }

  // studying phase
  const { cards, totalDue, currentIndex, isFlipped, isSubmitting, lastError } = session;
  const card = cards[currentIndex];
  const remaining = totalDue - cards.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-blue-100/50">
        <span>
          Card {currentIndex + 1} of {cards.length}
          {remaining > 0 && <span className="ml-1 text-purple-300/60">(+{remaining} more due)</span>}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-blue-100/30">{Math.round((currentIndex / cards.length) * 100)}% done</span>
          <a
            href="/deck"
            aria-disabled={isSubmitting}
            className={cn(
              "text-blue-100/40 transition-colors hover:text-white",
              isSubmitting && "pointer-events-none opacity-50",
            )}
          >
            End session
          </a>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-white/10">
        <div
          className="h-1 rounded-full bg-purple-500 transition-all duration-300"
          style={{ width: `${(currentIndex / cards.length) * 100}%` }}
        />
      </div>

      {/* Card */}
      <div className="min-h-[200px] rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-3 text-xs font-medium tracking-wider text-blue-100/40 uppercase">Front</div>
        <p className="text-base leading-relaxed text-white">{card.front}</p>

        {isFlipped && (
          <>
            <div className="my-4 border-t border-white/10" />
            <div className="mb-3 text-xs font-medium tracking-wider text-purple-300/60 uppercase">Back</div>
            <p className="text-base leading-relaxed text-blue-100/90">{card.back}</p>
          </>
        )}
      </div>

      {/* Error toast */}
      {lastError && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {lastError}
        </div>
      )}

      {/* Action buttons */}
      {!isFlipped ? (
        <button
          onClick={() => {
            setSession({ ...session, isFlipped: true });
          }}
          className="w-full rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Show Answer
        </button>
      ) : isSubmitting ? (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-blue-100/50">
          <span className="size-4 animate-spin rounded-full border-2 border-purple-400/50 border-t-purple-400" />
          Saving review…
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map(({ outcome, label, className }) => (
            <button
              key={outcome}
              onClick={() => void handleGrade(outcome)}
              className={cn(
                "flex flex-col items-center rounded-lg border px-2 py-3 text-sm font-medium transition-colors",
                className,
              )}
            >
              <span>{label}</span>
              <span className="mt-0.5 text-xs opacity-70">{OUTCOME_INTERVAL_LABELS[outcome]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
