import React, { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CardMutationResponseDTO, Flashcard } from "@/types";

interface CardModalProps {
  mode: "create" | "edit";
  card?: Flashcard;
  onSave: (card: Flashcard) => void;
  onClose: () => void;
}

export default function CardModal({ mode, card, onSave, onClose }: CardModalProps) {
  const [front, setFront] = useState(mode === "edit" && card ? card.front : "");
  const [back, setBack] = useState(mode === "edit" && card ? card.back : "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();

    if (front.trim().length === 0 || back.trim().length === 0) {
      setValidationError("Front and back are required.");
      return;
    }

    setValidationError(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      const url = mode === "edit" && card ? `/api/deck/${card.id}` : "/api/deck";
      const method = mode === "edit" ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: front.trim(), back: back.trim() }),
      });

      const data = (await res.json()) as CardMutationResponseDTO & { error?: string };

      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save card — please try again.");
        return;
      }

      onSave(data.card);
      onClose();
    } catch {
      setSaveError("Network error — please check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) {
          onClose();
        }
      }}
    >
      <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Flashcard" : "Edit Flashcard"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="card-front" className="text-sm font-medium text-blue-100/80">
              Front
            </label>
            <textarea
              id="card-front"
              value={front}
              onChange={(e) => {
                setFront(e.target.value);
              }}
              rows={3}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-purple-400/50 focus:outline-none disabled:opacity-50"
              placeholder="Question or concept"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="card-back" className="text-sm font-medium text-blue-100/80">
              Back
            </label>
            <textarea
              id="card-back"
              value={back}
              onChange={(e) => {
                setBack(e.target.value);
              }}
              rows={3}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-purple-400/50 focus:outline-none disabled:opacity-50"
              placeholder="Answer or definition"
            />
          </div>

          {(validationError ?? saveError) && <p className="text-sm text-red-300">{validationError ?? saveError}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={onClose}
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="bg-purple-600 text-white hover:bg-purple-700">
              {isSaving ? "Saving…" : mode === "create" ? "Add Card" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
