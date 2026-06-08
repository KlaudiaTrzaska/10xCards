import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import type { SaveCurationResponseDTO } from "@/types";

export const prerender = false;

const RequestSchema = z
  .object({
    generationId: z.uuid(),
    accepted: z.array(z.uuid()),
    edited: z.array(
      z.object({
        id: z.uuid(),
        front: z.string().min(1).max(1000),
        back: z.string().min(1).max(1000),
      }),
    ),
    discarded: z.array(z.uuid()),
  })
  .refine((d) => d.accepted.length + d.edited.length > 0, {
    message: "At least one card must be accepted or edited",
  });

export const POST: APIRoute = async (context) => {
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

  const { generationId, accepted, edited, discarded } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  if (discarded.length > 0) {
    const { error } = await supabase
      .from("flashcards")
      .delete()
      .in("id", discarded)
      .eq("user_id", user.id)
      .eq("generation_id", generationId);

    if (error) {
      return json({ error: "Failed to discard cards" }, 500);
    }
  }

  if (accepted.length > 0) {
    const { error } = await supabase
      .from("flashcards")
      .update({ status: "accepted" })
      .in("id", accepted)
      .eq("user_id", user.id)
      .eq("generation_id", generationId);

    if (error) {
      return json({ error: "Failed to accept cards" }, 500);
    }
  }

  if (edited.length > 0) {
    const results = await Promise.all(
      edited.map((card) =>
        supabase
          .from("flashcards")
          .update({ status: "accepted", front: card.front, back: card.back })
          .eq("id", card.id)
          .eq("user_id", user.id)
          .eq("generation_id", generationId),
      ),
    );

    const firstError = results.find((r) => r.error);
    if (firstError?.error) {
      return json({ error: "Failed to save edited cards" }, 500);
    }
  }

  const response: SaveCurationResponseDTO = {
    savedCount: accepted.length + edited.length,
  };

  return json(response);
};
