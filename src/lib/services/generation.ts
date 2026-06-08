import { z } from "zod";

export interface CardCandidate {
  front: string;
  back: string;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

const CardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
});

const ResponseSchema = z.object({
  cards: z.array(CardSchema).min(1),
});

export async function generateCards(sourceText: string, count: 5 | 10 | 15, apiKey: string): Promise<CardCandidate[]> {
  const systemPrompt = `You are a flashcard generator. Given study material, generate exactly ${count} flashcards as a JSON object with a "cards" array. Each card has "front" (question or concept) and "back" (answer or definition). Focus on key facts, definitions, and concepts.`;

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: sourceText },
        ],
      }),
    });
  } catch (err) {
    throw new GenerationError("Failed to reach OpenRouter", err);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new GenerationError(`OpenRouter returned ${response.status}: ${body}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new GenerationError("Failed to parse OpenRouter response as JSON", err);
  }

  const resp = json as { choices?: { message?: { content?: string } }[] };
  const content = resp.choices?.[0]?.message?.content;

  if (!content) {
    throw new GenerationError("OpenRouter response missing choices[0].message.content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new GenerationError("Model returned non-JSON content", err);
  }

  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new GenerationError("Model response failed schema validation", result.error);
  }

  return result.data.cards.slice(0, count);
}
