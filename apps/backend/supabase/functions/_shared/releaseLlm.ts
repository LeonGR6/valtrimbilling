import { RELEASE_TYPES, type ReleaseType } from "./releaseTypes.ts";

// LLM tie-breaker for the Release type, used only when the deterministic title
// rules cannot decide. It is best-effort: any failure returns null and the
// reviewer picks the type. It receives title-sized text only, with digits
// masked, so amounts and dates never leave the project.

export const LLM_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
export const LLM_MODEL = "mistral-small-latest";
export const LLM_TIMEOUT_MS = 20_000;

const MAX_LINES = 8;
const MAX_LINE_LENGTH = 160;

export interface TiebreakInput {
  lines: string[];
  candidates: ReleaseType[];
}

export interface TiebreakAnswer {
  releaseType: ReleaseType;
  confidence: number;
}

/** The only text sent to the model: a few short lines, digits masked. */
export function tiebreakLines(lines: string[]) {
  return lines
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line !== "")
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_LENGTH).replace(/\d/gu, "#"));
}

export function buildTiebreakRequest(input: TiebreakInput) {
  const allowed = input.candidates.length > 0 ? input.candidates : RELEASE_TYPES;
  return {
    model: LLM_MODEL,
    temperature: 0,
    max_tokens: 80,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You identify which California statutory lien waiver and release form a document is.",
          "Judge only by the form title in the lines you are given.",
          'Reply with JSON only: {"release_type": <one allowed value or null>, "confidence": <number from 0 to 1>}.',
          "Use null when the lines are not the title of one of the allowed forms.",
          "Remember that an UNCONDITIONAL form is not a CONDITIONAL form.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Allowed values: ${allowed.join(", ")}\nLines:\n${
          tiebreakLines(input.lines).join("\n")
        }`,
      },
    ],
  };
}

export function parseTiebreakAnswer(
  content: unknown,
  allowed: readonly ReleaseType[],
): TiebreakAnswer | null {
  if (typeof content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { release_type: releaseType, confidence } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof releaseType !== "string" ||
    !(allowed as readonly string[]).includes(releaseType)
  ) {
    return null;
  }

  const score = typeof confidence === "number" && Number.isFinite(confidence)
    ? Math.min(1, Math.max(0, confidence))
    : 0;
  return { releaseType: releaseType as ReleaseType, confidence: score };
}

export function mistralTiebreak(options: {
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  return async (input: TiebreakInput): Promise<TiebreakAnswer | null> => {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) return null;

    try {
      const response = await (options.fetcher ?? fetch)(LLM_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTiebreakRequest(input)),
        signal: AbortSignal.timeout(options.timeoutMs ?? LLM_TIMEOUT_MS),
      });
      if (!response.ok) return null;

      const payload = await response.json().catch(() => null) as
        | { choices?: Array<{ message?: { content?: unknown } }> }
        | null;
      return parseTiebreakAnswer(
        payload?.choices?.[0]?.message?.content,
        input.candidates.length > 0 ? input.candidates : RELEASE_TYPES,
      );
    } catch {
      return null;
    }
  };
}
