import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { json } from "@/lib/api-utils";
import type { StudyDueResponseDTO } from "@/types";

export const prerender = false;

const SESSION_LIMIT = 20;

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Database not configured" }, 503);
  }

  const now = new Date().toISOString();

  const { data, count, error } = await supabase
    .from("flashcards")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .eq("status", "accepted")
    .or(`fsrs_due.is.null,fsrs_due.lte.${now}`)
    .order("fsrs_due", { ascending: true, nullsFirst: true })
    .limit(SESSION_LIMIT);

  if (error) {
    return json({ error: "Failed to fetch due cards" }, 500);
  }

  // Separate count of all accepted cards (for empty-state distinction in the UI)
  const { count: totalAccepted, error: countError } = await supabase
    .from("flashcards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "accepted");

  if (countError) {
    return json({ error: "Failed to fetch card count" }, 500);
  }

  const response: StudyDueResponseDTO = {
    cards: data,
    total_due: count,
    total_accepted: totalAccepted,
  };

  return json(response);
};
