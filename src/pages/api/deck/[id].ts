import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import type { CardMutationResponseDTO } from "@/types";

export const prerender = false;

const IdSchema = z.uuid();
const UpdateCardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
});

async function fetchCardForMutation(
  context: Parameters<APIRoute>[0],
  id: string,
): Promise<
  | { ok: true; supabase: NonNullable<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; response: Response }
> {
  const user = context.locals.user;
  if (!user) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return { ok: false, response: json({ error: "Database not configured" }, 503) };
  }

  const { data: card, error } = await supabase
    .from("flashcards")
    .select("id, user_id, first_reviewed_at, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "accepted")
    .maybeSingle();

  if (error) {
    return { ok: false, response: json({ error: "Failed to fetch card" }, 500) };
  }

  if (!card) {
    return { ok: false, response: json({ error: "Card not found" }, 404) };
  }

  if (card.first_reviewed_at !== null) {
    return { ok: false, response: json({ error: "Card is locked after first review" }, 403) };
  }

  return { ok: true, supabase, userId: user.id };
}

export const PATCH: APIRoute = async (context) => {
  const idResult = IdSchema.safeParse(context.params.id);
  if (!idResult.success) {
    return json({ error: "Invalid card id" }, 400);
  }

  const id = idResult.data;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = UpdateCardSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const lockResult = await fetchCardForMutation(context, id);
  if (!lockResult.ok) {
    return lockResult.response;
  }

  const { supabase, userId } = lockResult;
  const { front, back } = parsed.data;

  const { data, error } = await supabase
    .from("flashcards")
    .update({ front, back })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "accepted")
    .select()
    .single();

  if (error) {
    return json({ error: "Failed to update card" }, 500);
  }

  const response: CardMutationResponseDTO = { card: data };
  return json(response);
};

export const DELETE: APIRoute = async (context) => {
  const idResult = IdSchema.safeParse(context.params.id);
  if (!idResult.success) {
    return json({ error: "Invalid card id" }, 400);
  }

  const id = idResult.data;

  const lockResult = await fetchCardForMutation(context, id);
  if (!lockResult.ok) {
    return lockResult.response;
  }

  const { supabase, userId } = lockResult;

  const { error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "accepted");

  if (error) {
    return json({ error: "Failed to delete card" }, 500);
  }

  return new Response(null, { status: 204 });
};
