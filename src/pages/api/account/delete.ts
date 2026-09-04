import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { json } from "@/lib/api-utils";

export const prerender = false;

const DeleteAccountSchema = z.object({
  email: z.email(),
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
    return json({ error: "Invalid request body" }, 400);
  }

  const parsed = DeleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }

  if (parsed.data.email !== user.email) {
    return json({ error: "Email does not match" }, 403);
  }

  const supabaseAdmin = createAdminClient();
  if (!supabaseAdmin) {
    return json({ error: "Service not configured" }, 503);
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", user.id);

  if (profileError) {
    return json({ error: "Failed to schedule account deletion" }, 500);
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    ban_duration: "876000h",
  });

  if (banError) {
    return json({ error: "Failed to complete account deletion" }, 500);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }

  return context.redirect("/");
};
