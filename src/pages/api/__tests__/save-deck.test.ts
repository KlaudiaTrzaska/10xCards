import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { POST } from "../save-deck";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Zod v4 requires RFC 4122 UUIDs: version nibble in [1-8], variant nibble in [89abAB]
const GEN_ID = "00000000-0000-4000-a000-000000000001";
const CARD_ACCEPTED = "00000000-0000-4000-a000-000000000011";
const CARD_EDITED = "00000000-0000-4000-a000-000000000012";
const CARD_DISCARDED = "00000000-0000-4000-a000-000000000013";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SaveDeckBody {
  savedCount?: number;
  error?: string;
}

function makeCtx(body: unknown, user: { id: string } | null = { id: "u-1" }) {
  return {
    request: new Request("http://localhost/api/save-deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user },
    cookies: {},
  } as unknown as Parameters<APIRoute>[0];
}

/**
 * Build a Supabase mock that routes errors to the correct save-deck DB step.
 *
 * save-deck.ts runs three sequential mutations:
 *   Step 1 — discard:  .from().delete().in().eq().eq()  → discardError
 *   Step 2 — accept:   .from().update().in().eq().eq()  → acceptError
 *   Step 3 — edit:     .from().update().eq().eq().eq()  → editError
 *
 * The discriminant between step 2 and step 3 is the first method called after
 * .update(): accept uses .in("id", accepted), edit uses .eq("id", card.id).
 */
function makeSaveDeckSupabase({
  discardError = null,
  acceptError = null,
  editError = null,
}: {
  discardError?: Error | null;
  acceptError?: Error | null;
  editError?: Error | null;
} = {}) {
  return {
    from: (_table: string) => ({
      delete: () => ({
        in: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: discardError }),
          }),
        }),
      }),
      update: (_data: unknown) => ({
        // accept path — .update({ status: "accepted" }).in("id", accepted)...
        in: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: acceptError }),
          }),
        }),
        // edit path — .update({ status, front, back }).eq("id", card.id)...
        eq: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: editError }),
          }),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/save-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // S1 — unauthenticated request
  it("S1: returns 401 when no user is authenticated", async () => {
    const res = await POST(
      makeCtx({ generationId: GEN_ID, accepted: [CARD_ACCEPTED], edited: [], discarded: [] }, null),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  // S2 — malformed JSON body
  it("S2: returns 400 when the request body is not valid JSON", async () => {
    const ctx = {
      request: new Request("http://localhost/api/save-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{{{",
      }),
      locals: { user: { id: "u-1" } },
      cookies: {},
    } as unknown as Parameters<APIRoute>[0];

    const res = await POST(ctx);
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // S3 — refine guard: zero accepted + edited
  it("S3: returns 400 when all cards are discarded with none accepted or edited", async () => {
    const res = await POST(makeCtx({ generationId: GEN_ID, accepted: [], edited: [], discarded: [CARD_DISCARDED] }));
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // S4 — whitespace-only edited front (proves .trim() fix in RequestSchema)
  it("S4: returns 400 when an edited card has a whitespace-only front field", async () => {
    const res = await POST(
      makeCtx({
        generationId: GEN_ID,
        accepted: [],
        edited: [{ id: CARD_EDITED, front: "   ", back: "Valid back" }],
        discarded: [],
      }),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  // S5 — accepted-only happy path
  it("S5: returns 200 with correct savedCount when only accepted cards are submitted", async () => {
    vi.mocked(createClient).mockReturnValue(makeSaveDeckSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeCtx({ generationId: GEN_ID, accepted: [CARD_ACCEPTED], edited: [], discarded: [] }));
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(200);
    expect(body.savedCount).toBe(1);
  });

  // S6 — full mix: accepted + edited + discarded
  it("S6: returns 200 with savedCount = accepted.length + edited.length for a full mixed save", async () => {
    vi.mocked(createClient).mockReturnValue(makeSaveDeckSupabase() as unknown as ReturnType<typeof createClient>);

    const res = await POST(
      makeCtx({
        generationId: GEN_ID,
        accepted: [CARD_ACCEPTED],
        edited: [{ id: CARD_EDITED, front: "Edited front", back: "Edited back" }],
        discarded: [CARD_DISCARDED],
      }),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(200);
    expect(body.savedCount).toBe(2); // 1 accepted + 1 edited
  });

  // S7 — discard DB step fails
  it("S7: returns 500 when the discard DB step fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSaveDeckSupabase({ discardError: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await POST(
      makeCtx({
        generationId: GEN_ID,
        accepted: [CARD_ACCEPTED],
        edited: [],
        discarded: [CARD_DISCARDED],
      }),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });

  // S8 — accept DB step fails
  // Note: in a real database the discard step would already have committed;
  // the mock simulates only the accept step failing.
  it("S8: returns 500 when the accept DB step fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSaveDeckSupabase({ acceptError: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await POST(
      makeCtx({
        generationId: GEN_ID,
        accepted: [CARD_ACCEPTED],
        edited: [],
        discarded: [CARD_DISCARDED],
      }),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });

  // S9 — edited DB step fails
  // Note: in a real database both the discard and accept steps would already have
  // committed; the mock simulates only the edit step failing.
  it("S9: returns 500 when the edit DB step fails", async () => {
    vi.mocked(createClient).mockReturnValue(
      makeSaveDeckSupabase({ editError: new Error("DB error") }) as unknown as ReturnType<typeof createClient>,
    );

    const res = await POST(
      makeCtx({
        generationId: GEN_ID,
        accepted: [CARD_ACCEPTED],
        edited: [{ id: CARD_EDITED, front: "Edited front", back: "Edited back" }],
        discarded: [CARD_DISCARDED],
      }),
    );
    const body = (await res.json()) as SaveDeckBody;

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
