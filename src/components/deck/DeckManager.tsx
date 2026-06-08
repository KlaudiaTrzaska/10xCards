import React, { useCallback, useEffect, useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import CardModal from "@/components/deck/CardModal";
import type { DeckListResponseDTO, Flashcard } from "@/types";

const PAGE_SIZE = 20;

type ModalState = { open: false } | { open: true; mode: "create" } | { open: true; mode: "edit"; card: Flashcard };

export default function DeckManager() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [refetchKey, setRefetchKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<Flashcard | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;

    async function fetchDeck() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/deck?page=${page}`);
        const data = (await res.json()) as DeckListResponseDTO & { error?: string };

        if (!res.ok) {
          if (!cancelled) {
            setError(data.error ?? "Failed to load deck.");
          }
          return;
        }

        if (!cancelled) {
          setCards(data.cards);
          setTotal(data.total);
        }
      } catch {
        if (!cancelled) {
          setError("Network error — please check your connection and try again.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchDeck();

    return () => {
      cancelled = true;
    };
  }, [page, refetchKey]);

  const triggerRefetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  function handleCardSaved() {
    triggerRefetch();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/deck/${deleteTarget.id}`, { method: "DELETE" });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setDeleteError(data.error ?? "Failed to delete card.");
        return;
      }

      const wasLastOnPage = cards.length === 1;
      setDeleteTarget(null);

      if (wasLastOnPage && page > 1) {
        setPage((p) => p - 1);
      } else {
        triggerRefetch();
      }
    } catch {
      setDeleteError("Network error — please check your connection and try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">My Deck</h2>
          <p className="text-sm text-blue-100/60">
            {total} {total === 1 ? "card" : "cards"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalState({ open: true, mode: "create" });
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-400/30 bg-purple-900/30 px-4 py-2 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-900/50"
        >
          <Plus className="size-4" />
          Add Card
        </button>
      </div>

      {isLoading && <p className="text-sm text-blue-100/60">Loading deck…</p>}

      {!isLoading && error && <p className="text-sm text-red-300">{error}</p>}

      {!isLoading && !error && cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-6 py-10 text-center">
          <p className="text-sm text-blue-100/60">No cards in your deck yet.</p>
          <button
            type="button"
            onClick={() => {
              setModalState({ open: true, mode: "create" });
            }}
            className="mt-4 text-sm text-purple-300 underline-offset-4 hover:underline"
          >
            Add your first card
          </button>
        </div>
      )}

      {!isLoading && !error && cards.length > 0 && (
        <ul className="space-y-3">
          {cards.map((card) => {
            const isLocked = card.first_reviewed_at != null;

            return (
              <li
                key={card.id}
                className={cn(
                  "rounded-lg border p-4",
                  isLocked ? "border-yellow-500/20 bg-yellow-900/10" : "border-white/10 bg-white/5",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {isLocked && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-200">
                        <Lock className="size-3" />
                        Locked
                      </span>
                    )}
                    <div>
                      <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Front</p>
                      <p className="truncate text-sm text-white">{card.front}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Back</p>
                      <p className="line-clamp-2 text-sm text-blue-100/80">{card.back}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {deleteTarget?.id === card.id ? (
                      <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs text-red-200">Delete?</span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void handleConfirmDelete()}
                          className="rounded-lg border border-red-400/40 bg-red-900/40 px-3 py-1.5 text-xs text-red-200 transition-colors hover:bg-red-900/60 disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => {
                            setDeleteTarget(null);
                            setDeleteError(null);
                          }}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-blue-100/80 transition-colors hover:bg-white/5 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isLocked}
                          title={isLocked ? "Locked after first review" : "Edit card"}
                          onClick={() => {
                            setModalState({ open: true, mode: "edit", card });
                          }}
                          className={cn(
                            "rounded-lg border border-white/10 p-2 text-blue-100/80 transition-colors",
                            isLocked
                              ? "cursor-not-allowed opacity-40"
                              : "hover:border-purple-400/30 hover:bg-purple-900/20 hover:text-purple-200",
                          )}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={isLocked}
                          title={isLocked ? "Locked after first review" : "Delete card"}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(card);
                          }}
                          className={cn(
                            "rounded-lg border border-white/10 p-2 text-blue-100/80 transition-colors",
                            isLocked
                              ? "cursor-not-allowed opacity-40"
                              : "hover:border-red-400/30 hover:bg-red-900/20 hover:text-red-300",
                          )}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {deleteTarget?.id === card.id && deleteError && (
                  <p className="mt-2 text-sm text-red-300">{deleteError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!isLoading && !error && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
            }}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-blue-100/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            &lt; Previous
          </button>
          <span className="text-sm text-blue-100/60">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1);
            }}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-blue-100/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next &gt;
          </button>
        </div>
      )}

      {modalState.open && (
        <CardModal
          mode={modalState.mode}
          card={modalState.mode === "edit" ? modalState.card : undefined}
          onSave={handleCardSaved}
          onClose={() => {
            setModalState({ open: false });
          }}
        />
      )}
    </section>
  );
}
