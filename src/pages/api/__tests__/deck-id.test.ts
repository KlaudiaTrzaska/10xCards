import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { PATCH, DELETE } from "../deck/[id]";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Zod v4 requires RFC 4122 UUIDs: version nibble in [1-8], variant nibble in [89abAB]
const VALID_ID = "00000000-0000-4000-a000-000000000001";
const INVALID_ID = "not-a-uuid";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNLOCKED_CARD = {
  id: VALID_ID,
  user_id: "u-1",
  first_reviewed_at: null,
  status: "accepted" as const,
};

const LOCKED_CARD = {
  id: VALID_ID,
  user_id: "u-1",
  first_reviewed_at: "2026-01-01T00:00:00Z",
  status: "accepted" as const,
};

const UPDATED_CARD = {
  id: VALID_ID,
  user_id: "u-1",
  generation_id: null,
  front: "Updated front",
  back: "Updated back",
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

interface DeckIdBody {
  card?: unknown;
  error?: string;
}

function makePatchCtx(body: unknown, user: { id: string } | null = { id: "u-1" }, id = VALID_ID) {
  return {
    request: new Request(`http://localhost/api/deck/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

function makeDeleteCtx(user: { id: string } | null = { id: "u-1" }, id = VALID_ID) {
  return {
    request: new Request(`http://localhost/api/deck/${id}`, {
      method: "DELETE",
    }),
    params: { id },
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

/**
 * Build a Supabase mock for [id].ts handlers.
 *
 * [id].ts always makes two Supabase calls:
 *   Call 1 — fetchCardForMutation: .from().select().eq().eq().eq().maybeSingle()
 *             → { data: selectData, error: selectError }
 *   Call 2 — PATCH: .from().update().eq().eq().eq().select().single()
 *                    → { data: mutateData, error: mutateError }
 *             DELETE: .from().delete().eq().eq().eq()
 *                    → { error: mutateError }
 *
 * selectData shapes:
 *   null         → route returns 404
 *   LOCKED_CARD  → route returns 403
 *   UNLOCKED_CARD → route proceeds to the mutation call
 */
function makeDeckIdSupabase({
  selectData = UNLOCKED_CARD,
  selectError = null,
  mutateData = UPDATED_CARD,
  mutateError = null,
}: {
  selectData?: unknown;
  selectError?: Error | null;
  mutateData?: unknown;
  mutateError?: Error | null;
} = {}) {
  let fromCallCount = 0;

  return {
    from: (_table: string) => {
      fromCallCount++;
      const callIndex = fromCallCount;

      if (callIndex === 1) {
        // fetchCardForMutation — select chain ending in maybeSingle()
        return {
          select: (_fields: string) => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: selectData, error: selectError }),
                }),
              }),
            }),
          }),
        };
      }

      // Mutation call — PATCH uses .update().eq().eq().eq().select().single()
      //                 DELETE uses .delete().eq().eq().eq()
      return {
        update: (_data: unknown) => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: mutateData, error: mutateError }),
                }),
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: mutateError }),
            }),
          }),
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// PATCH tests
// ---------------------------------------------------------------------------

describe("PATCH /api/deck/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // E1 — invalid UUID in params
  it("E1: returns 400 when the id param is not a valid UUID", async () => {
    const res = await PATCH(makePatchCtx({ front: "Front", back: "Back" }, { id: "u-1" }, INVALID_ID));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // E2 — unauthenticated
  it("E2: returns 401 when no user is authenticated", async () => {
    const res = await PATCH(makePatchCtx({ front: "Front", back: "Back" }, null));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // E3 — validation: empty front field
  it("E3: returns 400 when the front field is empty", async () => {
    const res = await PATCH(makePatchCtx({ front: "", back: "Back" }));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // E4 — card not found
  it("E4: returns 404 when the card does not exist or does not belong to the user", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckIdSupabase({ selectData: null }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await PATCH(makePatchCtx({ front: "Front", back: "Back" }));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  // E5 — card locked after first review
  it("E5: returns 403 when the card has been reviewed and is locked", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckIdSupabase({ selectData: LOCKED_CARD }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await PATCH(makePatchCtx({ front: "Front", back: "Back" }));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  // E6 — happy path
  it("E6: returns 200 with the updated card on success", async () => {
    vi.mocked(createClient).mockReturnValue(makeDeckIdSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await PATCH(makePatchCtx({ front: "Updated front", back: "Updated back" }));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(200);
    expect(body.card).toBeDefined();
  });

  // E7 — Supabase update error
  it("E7: returns 500 when the Supabase update fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckIdSupabase({ mutateError: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await PATCH(makePatchCtx({ front: "Front", back: "Back" }));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DELETE tests
// ---------------------------------------------------------------------------

describe("DELETE /api/deck/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // E8 — invalid UUID in params
  it("E8: returns 400 when the id param is not a valid UUID", async () => {
    const res = await DELETE(makeDeleteCtx({ id: "u-1" }, INVALID_ID));

    expect(res.status).toBe(400);
  });

  // E9 — unauthenticated
  it("E9: returns 401 when no user is authenticated", async () => {
    const res = await DELETE(makeDeleteCtx(null));
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // E10 — card not found
  it("E10: returns 404 when the card does not exist or does not belong to the user", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckIdSupabase({ selectData: null }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await DELETE(makeDeleteCtx());
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  // E11 — card locked after first review
  it("E11: returns 403 when the card has been reviewed and is locked", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeDeckIdSupabase({ selectData: LOCKED_CARD }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await DELETE(makeDeleteCtx());
    const body = (await res.json()) as DeckIdBody;

    expect(res.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  // E12 — happy path (204 No Content)
  it("E12: returns 204 with no body on successful deletion", async () => {
    vi.mocked(createClient).mockReturnValue(makeDeckIdSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await DELETE(makeDeleteCtx());

    expect(res.status).toBe(204);
  });
});
