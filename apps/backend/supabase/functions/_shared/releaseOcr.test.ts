import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  cleanOcrMarkdown,
  OCR_ENDPOINT,
  OCR_MODEL,
  OcrError,
  ocrWithMistral,
} from "./releaseOcr.ts";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 test");
const apiKey = "test-key-should-never-appear";

function respond(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function failureOf(fetcher: typeof fetch) {
  const error = await assertRejects(
    () => ocrWithMistral(pdfBytes, 1, { apiKey, fetcher }),
    OcrError,
  );
  return error as OcrError;
}

Deno.test("OCR refuses to run without an API key and says how to fix it", async () => {
  const error = await assertRejects(
    () => ocrWithMistral(pdfBytes, 1, { apiKey: undefined }),
    OcrError,
  ) as OcrError;
  assertEquals(error.failure, "not_configured");
  assert(error.message.includes("MISTRAL_API_KEY"));
});

Deno.test("OCR sends the PDF as a base64 data URL and only the first pages", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetcher = ((url: string, init: RequestInit) => {
    captured = { url, init };
    return Promise.resolve(respond({
      pages: [
        { index: 1, markdown: "## Second page" },
        { index: 0, markdown: "# **UNCONDITIONAL WAIVER**\n\nThrough Date:" },
      ],
    }));
  }) as unknown as typeof fetch;

  const pages = await ocrWithMistral(pdfBytes, 10, { apiKey, fetcher });

  assertEquals(captured!.url, OCR_ENDPOINT);
  const headers = captured!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, `Bearer ${apiKey}`);
  const body = JSON.parse(captured!.init.body as string);
  assertEquals(body.model, OCR_MODEL);
  assertEquals(body.pages, [0, 1, 2]);
  assertEquals(body.include_image_base64, false);
  assertEquals(body.include_blocks, true);
  assertEquals(body.document.type, "document_url");
  assert(body.document.document_url.startsWith("data:application/pdf;base64,JVBERi"));
  assertEquals(pages.map(({ lines }) => lines), [
    ["UNCONDITIONAL WAIVER", "Through Date:"],
    ["Second page"],
  ]);
});

Deno.test("a one page PDF asks for page 0 only", async () => {
  let pages: unknown;
  const fetcher = ((_url: string, init: RequestInit) => {
    pages = JSON.parse(init.body as string).pages;
    return Promise.resolve(respond({ pages: [{ index: 0, markdown: "x" }] }));
  }) as unknown as typeof fetch;
  await ocrWithMistral(pdfBytes, 1, { apiKey, fetcher });
  assertEquals(pages, [0]);
});

Deno.test("OCR failures map to fixed messages that never echo the key or the response", async () => {
  const cases: Array<[Response | Error, string]> = [
    [respond("secret body", 401), "auth"],
    [respond("secret body", 403), "auth"],
    [respond("secret body", 429), "rate_limited"],
    [respond("secret body", 500), "upstream"],
    [respond("not json at all", 200), "upstream"],
    [respond({ unexpected: true }, 200), "upstream"],
    [new DOMException("timed out", "TimeoutError"), "timeout"],
    [new TypeError("network down"), "upstream"],
  ];

  for (const [outcome, failure] of cases) {
    const fetcher = (() =>
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome)) as unknown as typeof fetch;
    const error = await failureOf(fetcher);
    assertEquals(error.failure, failure);
    assert(!error.message.includes(apiKey));
    assert(!error.message.includes("secret body"));
  }
});

Deno.test("OCR markdown becomes plain lines", () => {
  assertEquals(
    cleanOcrMarkdown(
      [
        "# CONDITIONAL WAIVER AND RELEASE ON **FINAL** PAYMENT",
        "",
        "> NOTICE: this document",
        "- Amount of Check: $\\_\\_\\_\\_",
        "| Through Date: | |",
        "![img-0.jpeg](img-0.jpeg)",
        "<!-- comment -->",
      ].join("\n"),
    ),
    [
      "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
      "NOTICE: this document",
      "Amount of Check: $____",
      "Through Date:",
    ],
  );
});

Deno.test("OCR keeps paragraph boxes with the page image size, in reading order", async () => {
  const fetcher = (() =>
    Promise.resolve(respond({
      pages: [{
        index: 0,
        markdown: "ignored when blocks exist",
        dimensions: { dpi: 200, width: 1700, height: 2200 },
        blocks: [
          { type: "title", top_left_x: 10, top_left_y: 20, bottom_right_x: 400, bottom_right_y: 60, content: "# TITLE" },
          { type: "text", top_left_x: 10, top_left_y: 80, bottom_right_x: 200, bottom_right_y: 100, content: "Through Date:" },
          { type: "image", top_left_x: 0, top_left_y: 0, bottom_right_x: 5, bottom_right_y: 5 },
          { type: "text", top_left_x: 50, top_left_y: 50, bottom_right_x: 40, bottom_right_y: 60, content: "inverted box" },
        ],
      }],
    }))) as unknown as typeof fetch;

  const [page] = await ocrWithMistral(pdfBytes, 1, { apiKey, fetcher });
  assertEquals(page.width, 1700);
  assertEquals(page.height, 2200);
  // The image block has no text and the inverted box is not a valid box.
  assertEquals(page.lines, ["TITLE", "Through Date:"]);
  assertEquals(page.blocks.length, 2);
  assertEquals(page.blocks[1], { text: "Through Date:", left: 10, top: 80, right: 200, bottom: 100 });
});

Deno.test("OCR falls back to the page text when no boxes or size come back", async () => {
  const fetcher = (() =>
    Promise.resolve(respond({
      pages: [{ index: 0, markdown: "# TITLE\n\nThrough Date:", blocks: [{ type: "text", top_left_x: 1, top_left_y: 1, bottom_right_x: 9, bottom_right_y: 9, content: "x" }] }],
    }))) as unknown as typeof fetch;

  const [page] = await ocrWithMistral(pdfBytes, 1, { apiKey, fetcher });
  // Boxes without the page image size cannot be placed, so they are dropped.
  assertEquals(page.blocks, []);
  assertEquals(page.width, null);
  assertEquals(page.lines, ["x"]);
});

Deno.test("OCR table markdown loses its separator rows", () => {
  assertEquals(
    cleanOcrMarkdown("| Name of Claimant: | |\n|---|---|\n| Through Date: | |\n---"),
    ["Name of Claimant:", "Through Date:"],
  );
  assertEquals(
    cleanOcrMarkdown("<table><tr><td>Owner:</td><td></td></tr></table>"),
    ["Owner:"],
  );
});
