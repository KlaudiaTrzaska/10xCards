import React, { useState } from "react";
import { Check, Pencil, X, CircleAlert, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Flashcard, SaveCurationResponseDTO } from "@/types";

type CardDecision =
  | { action: "accepted" }
  | { action: "discarded" }
  | { action: "editing"; editFront: string; editBack: string }
  | { action: "edited"; editFront: string; editBack: string };

interface CurationPanelProps {
  cards: Flashcard[];
  generationId: string;
  onReset: () => void;
}

export default function CurationPanel({ cards, generationId, onReset }: CurationPanelProps) {
  const [decisions, setDecisions] = useState<Map<string, CardDecision>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function setDecision(id: string, decision: CardDecision | null) {
    setDecisions((prev) => {
      const next = new Map(prev);
      if (decision === null) {
        next.delete(id);
      } else {
        next.set(id, decision);
      }
      return next;
    });
  }

  const acceptedIds = [...decisions.entries()].filter(([, d]) => d.action === "accepted").map(([id]) => id);

  const editedCards = [...decisions.entries()]
    .filter(([, d]) => d.action === "edited")
    .map(([id, d]) => {
      const dec = d as { action: "edited"; editFront: string; editBack: string };
      return { id, front: dec.editFront, back: dec.editBack };
    });

  const discardedIds = [...decisions.entries()].filter(([, d]) => d.action === "discarded").map(([id]) => id);

  const savedCount = acceptedIds.length + editedCards.length;

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/save-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId,
          accepted: acceptedIds,
          edited: editedCards,
          discarded: discardedIds,
        }),
      });

      const data = (await res.json()) as SaveCurationResponseDTO & { error?: string };

      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save — please try again.");
      } else {
        onReset();
        window.location.href = `/deck?saved=${data.savedCount}`;
      }
    } catch {
      setSaveError("Network error — please check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-white">
        Review {cards.length} draft {cards.length === 1 ? "card" : "cards"}
      </h2>

      <ul className="space-y-3">
        {cards.map((card, i) => {
          const decision = decisions.get(card.id);
          const isAccepted = decision?.action === "accepted";
          const isDiscarded = decision?.action === "discarded";
          const isEditing = decision?.action === "editing";
          const isEdited = decision?.action === "edited";

          const displayFront =
            decision?.action === "edited" || decision?.action === "editing" ? decision.editFront : card.front;
          const displayBack =
            decision?.action === "edited" || decision?.action === "editing" ? decision.editBack : card.back;

          return (
            <li
              key={card.id}
              className={cn(
                "rounded-xl border p-4 backdrop-blur-sm transition-all",
                isAccepted || isEdited
                  ? "border-green-500/40 bg-green-900/20"
                  : isDiscarded
                    ? "border-white/5 bg-white/[0.02] opacity-40"
                    : "border-white/10 bg-white/5",
              )}
            >
              <span className="mb-2 block text-xs font-semibold tracking-widest text-purple-300/70 uppercase">
                Card {i + 1}
              </span>

              {isEditing ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs text-white/40">Front</p>
                    <textarea
                      rows={2}
                      value={displayFront}
                      onChange={(e) => {
                        setDecision(card.id, {
                          action: "editing",
                          editFront: e.target.value,
                          editBack: displayBack,
                        });
                      }}
                      className="w-full resize-y rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-white/40">Back</p>
                    <textarea
                      rows={2}
                      value={displayBack}
                      onChange={(e) => {
                        setDecision(card.id, {
                          action: "editing",
                          editFront: displayFront,
                          editBack: e.target.value,
                        });
                      }}
                      className="w-full resize-y rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(card.id, {
                          action: "edited",
                          editFront: displayFront,
                          editBack: displayBack,
                        });
                      }}
                      className="rounded-lg border border-green-500/40 bg-green-900/30 px-3 py-1.5 text-xs font-medium text-green-300 transition-colors hover:bg-green-900/50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(card.id, null);
                      }}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={cn("grid gap-3 sm:grid-cols-2", isDiscarded && "line-through")}>
                    <div>
                      <p className="mb-1 text-xs text-white/40">Front</p>
                      <p className="text-sm text-white">{displayFront}</p>
                    </div>
                    <div className="sm:border-l sm:border-white/10 sm:pl-3">
                      <p className="mb-1 text-xs text-white/40">Back</p>
                      <p className="text-sm text-white/80">{displayBack}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(card.id, isAccepted ? null : { action: "accepted" });
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        isAccepted
                          ? "border-green-500/60 bg-green-600/30 text-green-300"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-green-500/40 hover:bg-green-900/20 hover:text-green-300",
                      )}
                    >
                      <Check className="size-3" />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(card.id, {
                          action: "editing",
                          editFront: displayFront,
                          editBack: displayBack,
                        });
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        isEdited
                          ? "border-green-500/60 bg-green-600/30 text-green-300"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-purple-500/40 hover:bg-purple-900/20 hover:text-purple-300",
                      )}
                    >
                      <Pencil className="size-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision(card.id, isDiscarded ? null : { action: "discarded" });
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        isDiscarded
                          ? "border-red-500/60 bg-red-900/30 text-red-300"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-300",
                      )}
                    >
                      <X className="size-3" />
                      Discard
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 pt-2">
        {saveError && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {saveError}
          </p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={savedCount === 0 || isSaving}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "bg-green-600 hover:bg-green-500",
          )}
        >
          {isSaving ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Saving…
            </>
          ) : (
            <>
              <Save className="size-4" />
              Save {savedCount} {savedCount === 1 ? "card" : "cards"} to deck
            </>
          )}
        </button>
      </div>
    </section>
  );
}
