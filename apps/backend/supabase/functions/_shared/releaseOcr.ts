import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// Mistral OCR client for scanned Releases (PDFs without a text layer).
//
// The PDF is sent as a base64 data URL and only the first pages are read. The
// response text is returned as lines and never persisted by the caller. Error
// messages are fixed strings: neither the API key nor any response body or
// document text can end up in a message or a log.

export const OCR_ENDPOINT = "https://api.mistral.ai/v1/ocr";
export const OCR_MODEL = "mistral-ocr-latest";
export const OCR_MAX_PAGES = 3;
export const OCR_TIMEOUT_MS = 60_000;

export type OcrFailure =
  | "not_configured"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "upstream";

const OCR_MESSAGES: Record<OcrFailure, string> = {
  not_configured:
    "This PDF has no readable text and OCR is not configured. Ask an administrator to set the MISTRAL_API_KEY secret.",
  auth: "The OCR service rejected the configured credentials.",
  rate_limited: "The OCR service is busy. Try again in a minute.",
  timeout: "The OCR service took too long to read this PDF.",
  upstream: "The OCR service could not read this PDF.",
};

export class OcrError extends Error {
  readonly failure: OcrFailure;

  constructor(failure: OcrFailure) {
    super(OCR_MESSAGES[failure]);
    this.name = "OcrError";
    this.failure = failure;
  }
}

/** Turns one page of OCR markdown into plain, trimmed text lines. */
export function cleanOcrMarkdown(markdown: string): string[] {
  return markdown
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .split(/\r?\n/u)
    .map((line) =>
      line
        .replace(/^[\s>#*\-]+/u, "")
        .replace(/[*`|]/gu, " ")
        .replace(/\\_/gu, "_")
        .replace(/\s+/gu, " ")
        .trim()
    )
    .filter((line) => line !== "");
}

export interface OcrOptions {
  apiKey: string | undefined;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Reads the first pages of a PDF with Mistral OCR. Returns the cleaned text
 * lines of each page, in page order.
 */
export async function ocrWithMistral(
  bytes: Uint8Array,
  pageCount: number,
  options: OcrOptions,
): Promise<string[][]> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw new OcrError("not_configured");

  const pages = Array.from(
    { length: Math.max(1, Math.min(pageCount, OCR_MAX_PAGES)) },
    (_, index) => index,
  );

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(OCR_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        document: {
          type: "document_url",
          document_url: `data:application/pdf;base64,${encodeBase64(bytes)}`,
        },
        pages,
        include_image_base64: false,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? OCR_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw new OcrError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "upstream",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new OcrError("auth");
  }
  if (response.status === 429) throw new OcrError("rate_limited");
  if (!response.ok) throw new OcrError("upstream");

  const payload = await response.json().catch(() => null) as
    | { pages?: Array<{ index?: number; markdown?: unknown }> }
    | null;
  if (!payload || !Array.isArray(payload.pages)) {
    throw new OcrError("upstream");
  }

  return [...payload.pages]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((page) =>
      typeof page.markdown === "string" ? cleanOcrMarkdown(page.markdown) : []
    );
}
