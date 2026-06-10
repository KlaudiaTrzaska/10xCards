import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ReviewOutcome, StudyCardDTO, StudyDueResponseDTO, SubmitReviewResponseDTO } from "@/types";

// ── Session state machine ────────────────────────────────────────────────────

type SessionState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty-no-cards" }
  | { phase: "empty-no-due" }
  | {
      phase: "studying";
      cards: StudyCardDTO[];
      totalDue: number;
      currentIndex: number;
      isFlipped: boolean;
      isSubmitting: boolean;
      lastError: string | null;
      grades: ReviewOutcome[];
    }
  | { phase: "complete"; totalReviewed: number; grades: ReviewOutcome[] };

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

// ── Component ────────────────────────────────────────────────────────────────

export default function StudySession() {
  const [session, setSession] = useState<SessionState>({ phase: "loading" });

  // Load due cards on mount
  useEffect(() => {
    async function loadDueCards() {
      try {
        const res = await fetch("/api/study/due");
        const data = (await res.json()) as StudyDueResponseDTO & { error?: string };

        if (!res.ok) {
          setSession({ phase: "error", message: data.error ?? "Failed to load cards." });
          return;
        }

        if (data.cards.length === 0) {
          if (data.total_accepted === 0) {
            setSession({ phase: "empty-no-cards" });
          } else {
            setSession({ phase: "empty-no-due" });
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
          grades: [],
        });
      } catch {
        setSession({ phase: "error", message: "Network error. Please refresh and try again." });
      }
    }

    void loadDueCards();
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

      const newGrades = [...session.grades, outcome];
      const nextIndex = session.currentIndex + 1;

      if (nextIndex >= session.cards.length) {
        setSession({ phase: "complete", totalReviewed: session.cards.length, grades: newGrades });
      } else {
        setSession({
          ...session,
          currentIndex: nextIndex,
          isFlipped: false,
          isSubmitting: false,
          lastError: null,
          grades: newGrades,
        });
      }
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

  if (session.phase === "empty-no-due") {
    return (
      <div className="py-16 text-center">
        <p className="mb-2 text-2xl">🎉</p>
        <p className="mb-2 text-lg font-medium text-white">All caught up!</p>
        <p className="mb-6 text-sm text-blue-100/60">
          No cards are due right now. Come back later for your next session.
        </p>
        <a
          href="/deck"
          className="inline-flex items-center justify-center rounded-lg border border-white/20 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          View My Deck
        </a>
      </div>
    );
  }

  if (session.phase === "complete") {
    const counts = { again: 0, hard: 0, good: 0, easy: 0 } as Record<ReviewOutcome, number>;
    for (const g of session.grades) counts[g]++;

    return (
      <div className="py-8 text-center">
        <p className="mb-1 text-2xl">✅</p>
        <h2 className="mb-1 text-xl font-bold text-white">Session complete!</h2>
        <p className="mb-6 text-sm text-blue-100/60">
          {session.totalReviewed} {session.totalReviewed === 1 ? "card" : "cards"} reviewed
        </p>

        <div className="mb-8 grid grid-cols-4 gap-3">
          {GRADES.map(({ outcome, label, className }) => (
            <div key={outcome} className={cn("rounded-lg border px-3 py-3 text-center text-sm", className)}>
              <div className="text-xl font-bold">{counts[outcome]}</div>
              <div className="mt-0.5 text-xs opacity-80">{label}</div>
            </div>
          ))}
        </div>

        <a
          href="/deck"
          className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-500"
        >
          Back to Deck
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
        <span className="text-blue-100/30">{Math.round((currentIndex / cards.length) * 100)}% done</span>
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
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map(({ outcome, label, className }) => (
            <button
              key={outcome}
              onClick={() => void handleGrade(outcome)}
              disabled={isSubmitting}
              className={cn(
                "rounded-lg border px-3 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                className,
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
