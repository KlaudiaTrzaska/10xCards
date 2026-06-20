import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIRoute } from "astro";
import { generateCards, GenerationError } from "@/lib/services/generation";
import { createClient } from "@/lib/supabase";
import { POST } from "../generate";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/services/generation", () => {
  class GenerationError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = "GenerationError";
      this.cause = cause;
    }
  }
  return { GenerationError, generateCards: vi.fn() };
});

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SOURCE = "A".repeat(50);

const MOCK_CARDS = Array.from({ length: 5 }, (_, i) => ({
  id: `c-${i + 1}`,
  user_id: "u-1",
  generation_id: "gen-1",
  front: `Question ${i + 1}`,
  back: `Answer ${i + 1}`,
  status: "draft" as const,
  created_at: "2026-01-01",
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
}));

function makeMockSupabase() {
  return {
    from: (table: string) => ({
      insert: () => ({
        select: () =>
          table === "generations"
            ? { single: () => Promise.resolve({ data: { id: "gen-1" }, error: null }) }
            : Promise.resolve({ data: MOCK_CARDS, error: null }),
      }),
    }),
  };
}

interface ApiBody {
  error?: string;
  generationId?: string;
  cards?: unknown[];
}

function makeCtx(body: unknown, user: { id: string } | null = { id: "u-1" }) {
  return {
    request: new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // I1 — GenerationError is sanitized: raw provider body must not reach client
  it("I1: returns 502 with safe message when generateCards throws GenerationError", async () => {
    vi.mocked(generateCards).mockRejectedValueOnce(
      new GenerationError('OpenRouter returned 401: {"error":{"message":"Invalid API key"}}'),
    );

    const res = await POST(makeCtx({ sourceText: VALID_SOURCE, count: 5 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(502);
    expect(body.error).toBe("Generation failed — please try again.");
    expect(body.error).not.toContain("OpenRouter returned");
    expect(body.error).not.toContain("Invalid API key");
  });

  // I2 — unexpected non-GenerationError
  it("I2: returns 500 with generic message on unexpected error", async () => {
    vi.mocked(generateCards).mockRejectedValueOnce(new Error("oops"));

    const res = await POST(makeCtx({ sourceText: VALID_SOURCE, count: 5 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe("Unexpected error during generation");
  });

  // I3 — sourceText too short (Risk #7)
  it("I3: returns 400 when sourceText is too short", async () => {
    const res = await POST(makeCtx({ sourceText: "x", count: 5 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect((body.error ?? "").length).toBeGreaterThan(0);
  });

  // I4 — sourceText too long (Risk #7)
  it("I4: returns 400 when sourceText exceeds 10,000 characters", async () => {
    const res = await POST(makeCtx({ sourceText: "x".repeat(10_001), count: 5 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect((body.error ?? "").length).toBeGreaterThan(0);
  });

  // I5 — invalid count (Risk #7)
  it("I5: returns 400 when count is not 5, 10, or 15", async () => {
    const res = await POST(makeCtx({ sourceText: VALID_SOURCE, count: 7 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect((body.error ?? "").length).toBeGreaterThan(0);
  });

  // I6 — happy path
  it("I6: returns 200 with generationId and cards on success", async () => {
    vi.mocked(generateCards).mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        front: `Question ${i + 1}`,
        back: `Answer ${i + 1}`,
      })),
    );
    vi.mocked(createClient).mockReturnValue(makeMockSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeCtx({ sourceText: VALID_SOURCE, count: 5 }));
    const body = (await res.json()) as ApiBody;

    expect(res.status).toBe(200);
    expect(body.generationId).toBe("gen-1");
    expect(Array.isArray(body.cards)).toBe(true);
    expect((body.cards ?? []).length).toBe(5);
  });
});
