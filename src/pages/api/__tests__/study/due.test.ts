import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { GET } from "../../study/due";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Raw DB card data returned by Query 1 (STUDY_CARD_COLUMNS subset; handler adds interval_previews)
const MOCK_STUDY_CARD_RAW = {
  id: "00000000-0000-4000-a000-000000000011",
  front: "Front text",
  back: "Back text",
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

interface DueBody {
  cards?: unknown[];
  total_due?: number;
  total_accepted?: number;
  next_due_at?: string | null;
  error?: string;
}

/**
 * GET context for /api/study/due.
 * Includes `url` as a URL object following the makeGetCtx precedent from deck-index.test.ts.
 */
function makeGetCtx(user: { id: string } | null = { id: USER_ID }) {
  const url = new URL("http://localhost/api/study/due");
  return {
    request: new Request(url.toString(), { method: "GET" }),
    url,
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

/**
 * Build a Supabase mock for GET /api/study/due.
 *
 * due.ts fires three parallel queries via Promise.all in this order:
 *   Call 1 — due cards:    .from("flashcards").select(...).eq().eq().or().order().limit()
 *                          → { data: card[], count: number, error }
 *   Call 2 — total count:  .from("flashcards").select("*",{head:true}).eq().eq()
 *                          → { count: number, error }
 *   Call 3 — next due at:  .from("flashcards").select("fsrs_due").eq().eq().gt().order().limit().maybeSingle()
 *                          → { data: {fsrs_due: string}|null, error }
 *
 * Because the mock returns already-resolved promises, JavaScript processes the
 * Promise.all array in creation order (1 → 2 → 3), so fromCallCount routing is stable.
 */
function makeDueSupabase({
  cards = [MOCK_STUDY_CARD_RAW],
  totalAccepted = 1,
  nextDue = null,
}: {
  cards?: (typeof MOCK_STUDY_CARD_RAW)[];
  totalAccepted?: number;
  nextDue?: string | null;
} = {}) {
  let callCount = 0;

  return {
    from: vi.fn().mockImplementation(() => {
      callCount++;

      if (callCount === 1) {
        // Call 1: due cards — .select(...).eq().eq().or().order().limit()
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: cards, count: cards.length, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (callCount === 2) {
        // Call 2: total accepted count — .select("*",{count:"exact",head:true}).eq().eq()
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: totalAccepted, error: null }),
            }),
          }),
        };
      }

      // Call 3: fetchNextDueAt — .select("fsrs_due").eq().eq().gt().order().limit().maybeSingle()
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: nextDue ? { fsrs_due: nextDue } : null,
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/study/due", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // D1 — unauthenticated request
  it("D1: returns 401 when no user is authenticated", async () => {
    const res = await GET(makeGetCtx(null));
    const body = (await res.json()) as DueBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // D2 — happy path: user-scoped due cards, counts, and next_due_at returned
  it("D2: returns 200 with cards, total_due, total_accepted, and next_due_at", async () => {
    vi.mocked(createClient).mockReturnValue(makeDueSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await GET(makeGetCtx());
    const body = (await res.json()) as DueBody;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards).toHaveLength(1);
    expect(typeof body.total_due).toBe("number");
    expect(typeof body.total_accepted).toBe("number");
    expect(body).toHaveProperty("next_due_at"); // present even when null
  });
});
