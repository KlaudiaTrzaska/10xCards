import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { GET, POST } from "../deck/index";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Zod v4 requires RFC 4122 UUIDs: version nibble in [1-8], variant nibble in [89abAB]
const MOCK_CARD = {
  id: "00000000-0000-4000-a000-000000000011",
  user_id: "u-1",
  generation_id: null,
  front: "Test front",
  back: "Test back",
  status: "accepted" as const,
  created_at: "2026-01-01T00:00:00Z",
  first_reviewed_at: null,
  fsrs_due: null,
  fsrs_stability: null,
  fsrs_difficulty: null,
  fsrs_scheduled_days: null,
  fsrs_learning_steps: null,
  fsrs_reps: null,
  fsrs_lapses: null,
  fsrs_state: null,
  fsrs_last_review: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DeckIndexBody {
  cards?: unknown[];
  total?: number | null;
  page?: number;
  pageSize?: number;
  card?: unknown;
  error?: string;
}

/**
 * GET context — must expose `url` as a URL object because the route reads
 * `context.url.searchParams.get("page")`, not `context.request.url`.
 */
function makeGetCtx(page?: number | string, user: { id: string } | null = { id: "u-1" }) {
  const url = new URL(`http://localhost/api/deck${page !== undefined ? `?page=${String(page)}` : ""}`);
  return {
    request: new Request(url.toString(), { method: "GET" }),
    url,
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

function makePostCtx(body: unknown, user: { id: string } | null = { id: "u-1" }) {
  return {
    request: new Request("http://localhost/api/deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

/**
 * Mock for GET /api/deck — chain: .from().select().eq().eq().order().range()
 */
function makeDeckListSupabase({
  data = [MOCK_CARD],
  count = 1,
  error = null,
}: {
  data?: unknown[];
  count?: number | null;
  error?: Error | null;
} = {}) {
  return {
    from: (_table: string) => ({
      select: (_fields: string, _opts?: unknown) => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              range: () => Promise.resolve({ data, count, error }),
            }),
          }),
        }),
      }),
    }),
  };
}

/**
 * Mock for POST /api/deck — chain: .from().insert().select().single()
 */
function makeCreateSupabase({
  data = MOCK_CARD,
  error = null,
}: {
  data?: unknown;
  error?: Error | null;
} = {}) {
  return {
    from: (_table: string) => ({
      insert: (_row: unknown) => ({
        select: () => ({
          single: () => Promise.resolve({ data, error }),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // D1 — unauthenticated GET
  it("D1: returns 401 when no user is authenticated", async () => {
    const res = await GET(makeGetCtx(1, null));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // D2 — invalid page parameter
  it("D2: returns 400 when the page query param is not a valid integer", async () => {
    const res = await GET(makeGetCtx("abc"));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // D3 — happy path
  it("D3: returns 200 with paginated card list on success", async () => {
    vi.mocked(createClient).mockReturnValue(makeDeckListSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await GET(makeGetCtx(1));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.total).toBe(1);
  });

  // D4 — Supabase query error
  it("D4: returns 500 when the Supabase query fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckListSupabase({ error: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await GET(makeGetCtx(1));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // D5 — unauthenticated POST
  it("D5: returns 401 when no user is authenticated", async () => {
    const res = await POST(makePostCtx({ front: "Front", back: "Back" }, null));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // D6 — missing required field
  it("D6: returns 400 when the front field is missing", async () => {
    const res = await POST(makePostCtx({ back: "Back only" }));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // D7 — happy path
  it("D7: returns 201 with the created card on success", async () => {
    vi.mocked(createClient).mockReturnValue(makeCreateSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await POST(makePostCtx({ front: "Test front", back: "Test back" }));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(201);
    expect(body.card).toBeDefined();
  });

  // D8 — Supabase insert error
  it("D8: returns 500 when the Supabase insert fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeCreateSupabase({ error: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await POST(makePostCtx({ front: "Test front", back: "Test back" }));
    const body = (await res.json()) as DeckIndexBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
