import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PUBLIC_ROUTES = ["/auth", "/api/auth", "/sitemap"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const pathname = context.url.pathname;
  const isPublic = pathname === "/" || PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  if (pathname === "/" && context.locals.user) {
    return context.redirect("/home");
  }

  if (!isPublic && !context.locals.user) {
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const returnTo = encodeURIComponent(pathname + context.url.search);
    return context.redirect(`/auth/signin?returnTo=${returnTo}`);
  }

  return next();
});
