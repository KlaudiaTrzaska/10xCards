import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import type { CardMutationResponseDTO, DeckListResponseDTO } from "@/types";

export const prerender = false;

const PAGE_SIZE = 20;

const CreateCardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
});

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const pageParam = context.url.searchParams.get("page") ?? "1";
  const page = Number.parseInt(pageParam, 10);
  if (!Number.isInteger(page) || page < 1) {
    return json({ error: "Invalid page parameter" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await supabase
    .from("flashcards")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return json({ error: "Failed to fetch deck" }, 500);
  }

  const response: DeckListResponseDTO = {
    cards: data,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };

  return json(response);
};

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

  const parsed = CreateCardSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { front, back } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  const { data, error } = await supabase
    .from("flashcards")
    .insert({
      user_id: user.id,
      generation_id: null,
      front,
      back,
      status: "accepted",
    })
    .select()
    .single();

  if (error) {
    return json({ error: "Failed to create card" }, 500);
  }

  const response: CardMutationResponseDTO = { card: data };
  return json(response, 201);
};
