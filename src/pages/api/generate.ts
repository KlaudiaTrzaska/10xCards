import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { generateCards, GenerationError } from "@/lib/services/generation";
import type { GenerateResponseDTO } from "@/types";

export const prerender = false;

const RequestSchema = z.object({
  sourceText: z.string().min(50).max(10_000),
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!OPENROUTER_API_KEY) {
    return json({ error: "Service unavailable — generation not configured" }, 503);
  }

  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { sourceText, count } = parsed.data;

  let candidates: { front: string; back: string }[];
  try {
    candidates = await generateCards(sourceText, count, OPENROUTER_API_KEY);
  } catch (err) {
    if (err instanceof GenerationError) {
      // eslint-disable-next-line no-console
      console.error("[generate] GenerationError:", err.message, err.cause);
      return json({ error: `Generation failed: ${err.message}` }, 502);
    }
    // eslint-disable-next-line no-console
    console.error("[generate] Unexpected error:", err);
    return json({ error: "Unexpected error during generation" }, 500);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  const { data: generationRow, error: genError } = await supabase
    .from("generations")
    .insert({
      user_id: user.id,
      source_text: sourceText,
      card_count_requested: count,
      model: "openai/gpt-4o-mini",
    })
    .select("id")
    .single();

  if (genError) {
    return json({ error: "Failed to save generation" }, 500);
  }

  const { data: cards, error: cardsError } = await supabase
    .from("flashcards")
    .insert(
      candidates.map((c) => ({
        user_id: user.id,
        generation_id: generationRow.id,
        front: c.front,
        back: c.back,
        status: "draft" as const,
      })),
    )
    .select();

  if (cardsError) {
    return json({ error: "Failed to save cards" }, 500);
  }

  const response: GenerateResponseDTO = {
    generationId: generationRow.id,
    cards,
  };

  return json(response);
};
