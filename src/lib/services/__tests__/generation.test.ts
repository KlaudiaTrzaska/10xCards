import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCards, GenerationError } from "../generation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_TEXT = "A".repeat(50);

function makeCards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    front: `Question ${i + 1}`,
    back: `Answer ${i + 1}`,
  }));
}

function mockOkResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not ok")),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateCards", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // U1 — network failure
  it("U1: throws GenerationError when fetch itself throws", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message === "Failed to reach OpenRouter",
    );
  });

  // U2 — OpenRouter non-OK response
  it("U2: throws GenerationError with status when OpenRouter returns non-OK", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockErrorResponse(401, '{"error":{"message":"Invalid API key"}}'));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.includes("401"),
    );
  });

  // U3 — malformed envelope JSON
  it("U3: throws GenerationError when OpenRouter envelope is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("bad json")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("parse"),
    );
  });

  // U4 — empty choices array
  it("U4: throws GenerationError when choices array is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [] }),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("missing"),
    );
  });

  // U5 — non-JSON model content
  it("U5: throws GenerationError when model content is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse("Sure! Here are your flashcards in plain text..."));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("non-json"),
    );
  });

  // U6 — wrong JSON schema (no cards key)
  it("U6: throws GenerationError when model JSON has wrong schema (no cards key)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse(JSON.stringify({ flashcards: [] })));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("schema"),
    );
  });

  // U7 — empty cards array (count=5 requires min 5)
  it("U7: throws GenerationError when model returns empty cards array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse(JSON.stringify({ cards: [] })));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("schema"),
    );
  });

  // U8 — whitespace-only front field (fixed by .trim().min(1))
  it("U8: throws GenerationError when a card has whitespace-only front", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockOkResponse(JSON.stringify({ cards: [{ front: "   ", back: "answer" }] })),
    );

    await expect(generateCards(SOURCE_TEXT, 1, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("schema"),
    );
  });

  // U9 — fewer cards than requested (fixed by min(count))
  it("U9: throws GenerationError when model returns fewer cards than requested", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse(JSON.stringify({ cards: makeCards(2) })));

    await expect(generateCards(SOURCE_TEXT, 5, "test-key")).rejects.toSatisfy(
      (e: unknown) => e instanceof GenerationError && e.message.toLowerCase().includes("schema"),
    );
  });

  // U10 — happy path: exact count
  it("U10: resolves with an array of exactly count cards", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse(JSON.stringify({ cards: makeCards(5) })));

    const result = await generateCards(SOURCE_TEXT, 5, "test-key");
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ front: "Question 1", back: "Answer 1" });
  });

  // U11 — over-delivery: truncated by slice
  it("U11: resolves with exactly count cards when model returns more", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOkResponse(JSON.stringify({ cards: makeCards(8) })));

    const result = await generateCards(SOURCE_TEXT, 5, "test-key");
    expect(result).toHaveLength(5);
  });
});
