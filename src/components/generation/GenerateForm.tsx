import React, { useState } from "react";
import { Sparkles, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Flashcard, GenerateResponseDTO } from "@/types";
import CurationPanel from "@/components/generation/CurationPanel";

type Count = 5 | 10 | 15;

const COUNT_OPTIONS: Count[] = [5, 10, 15];
const MIN_LENGTH = 50;
const MAX_LENGTH = 10_000;

export default function GenerateForm() {
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState<Count>(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();

    if (sourceText.length < MIN_LENGTH) {
      setError(`Text must be at least ${MIN_LENGTH} characters (currently ${sourceText.length}).`);
      return;
    }
    if (sourceText.length > MAX_LENGTH) {
      setError(`Text must be at most ${MAX_LENGTH} characters.`);
      return;
    }

    setIsLoading(true);
    setError(null);
    setCards(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, count }),
      });

      const data = (await res.json()) as GenerateResponseDTO & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setCards(data.cards);
        setGenerationId(data.generationId);
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Textarea */}
        <div className="space-y-2">
          <label htmlFor="source-text" className="block text-sm font-medium text-blue-100/80">
            Study material
          </label>
          <textarea
            id="source-text"
            rows={8}
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (error) setError(null);
            }}
            disabled={isLoading}
            placeholder="Paste your notes, article, or any study material here…"
            className={cn(
              "w-full resize-y rounded-xl border bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30",
              "transition-colors focus:ring-2 focus:ring-purple-500/50 focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              sourceText.length > 0 && sourceText.length < MIN_LENGTH
                ? "border-amber-500/50"
                : "border-white/10 focus:border-white/20",
            )}
          />
          <p className={cn("text-right text-xs", sourceText.length > MAX_LENGTH ? "text-red-400" : "text-white/40")}>
            {sourceText.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </p>
        </div>

        {/* Count picker */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-100/80">Number of cards</p>
          <div className="flex gap-2">
            {COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCount(n);
                }}
                disabled={isLoading}
                className={cn(
                  "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  count === n
                    ? "border-purple-500/60 bg-purple-600/40 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Generating…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Sparkles className="size-4" />
              Generate cards
            </span>
          )}
        </Button>
      </form>

      {/* Curation panel */}
      {cards !== null && generationId !== null && (
        <CurationPanel
          cards={cards}
          generationId={generationId}
          onReset={() => {
            setCards(null);
            setGenerationId(null);
          }}
        />
      )}
    </div>
  );
}
