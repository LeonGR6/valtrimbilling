import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  answerText,
  buildAiDocument,
  buildAiRequest,
  collapseLetterSpacing,
  describeJob,
  mistralScheduleReader,
  parseAiAnswer,
  PaymentScheduleAiError,
  providerErrorDetail,
} from "./paymentScheduleAi.ts";
import type { AiAnswer, AiDocument, AiJobContext, AiReader } from "./paymentScheduleAi.ts";
import { verifyAiAnswer } from "./paymentScheduleAiVerify.ts";
import { analyzePaymentScheduleWithAi, readPaymentSchedulePdf } from "./paymentScheduleAnalysis.ts";
import { templateAnalysisColumns } from "./paymentScheduleRecord.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

function run(text: string, x: number, y: number): TextRun {
  return { text, x, y, width: text.length * 5, height: 9 };
}

function page(number: number, runs: TextRun[]): PageContent {
  return { page: number, width: 792, height: 612, rotation: 0, runs, widgets: [] };
}

// A purchase order report: one block per Lot and activity.
const PAGES = [
  page(1, [
    run("L o t :", 300, 500),
    run("0 0 1", 330, 500),
    run("40-240-10", 40, 480),
    run("Exterior Frames", 100, 480),
    run("$200.00", 700, 480),
    run("40-240-20", 40, 460),
    run("Material Delivered", 100, 460),
    run("$800.00", 700, 460),
    run("40-240-50", 40, 440),
    run("Utility Closet", 100, 440),
    run("$300.00", 700, 440),
  ]),
  page(2, [
    run("Lot:", 300, 500),
    run("002", 330, 500),
    run("40-240-10", 40, 480),
    run("$250.00", 700, 480),
    run("40-240-20", 40, 460),
    run("$750.00", 700, 460),
    run("40-240-50", 40, 440),
    run("$300.00", 700, 440),
  ]),
];

const CONTEXT: AiJobContext = {
  draws: [
    { draw: 1, name: "EXTERIOR FRAMES", percentage: 20 },
    { draw: 2, name: "MATERIAL DELIVERED", percentage: 80 },
  ],
  lots: [
    { phase: "1", lot: "1", plan: "A", priceCents: 100_000, utility: false },
    { phase: "1", lot: "2", plan: "B", priceCents: 100_000, utility: false },
    { phase: "1", lot: "UTILITY-1", plan: "UTILITY", priceCents: 60_000, utility: true },
  ],
};

function answer(lots: AiAnswer["lots"], extra: Partial<AiAnswer> = {}): AiAnswer {
  return { lots, drawLabels: [], notes: [], ...extra };
}

Deno.test("letter-spaced text reads as one word; normal text is kept", () => {
  assertEquals(collapseLetterSpacing("L o t :"), "Lot:");
  assertEquals(collapseLetterSpacing("0 0 1"), "001");
  assertEquals(collapseLetterSpacing("3 9 2 7 7 - 1"), "39277-1");
  assertEquals(collapseLetterSpacing("Exterior Frames"), "Exterior Frames");
  assertEquals(collapseLetterSpacing("U M"), "U M");
});

Deno.test("the document tags every amount with a reference, in reading order", () => {
  const document = buildAiDocument(PAGES);
  assertEquals(document.refs.size, 6);
  assert(document.text.includes("Lot: | 001"));
  assert(document.text.includes("$200.00 [#1]"));
  assert(document.text.includes("=== Page 2 ==="));
  assertEquals(document.refs.get("#4")!.cents, 25_000);
  assert(document.words.has("001"));
});

Deno.test("the Job description lists draws, Lots and the shared utility building", () => {
  const text = describeJob(CONTEXT);
  assert(text.includes("Draw 2: MATERIAL DELIVERED (80% of the Lot price)"));
  assert(text.includes("Lot 1: Plan A, $1000.00"));
  assert(text.includes("Utility building: $600.00, shared by the 2 Lots of this Phase"));
});

Deno.test("the answer keeps only well-formed Lots and references", () => {
  const parsed = parseAiAnswer(JSON.stringify({
    lots: [
      { lot: "001", phase: null, draws: [{ draw: 1, ref: "[#1]" }, { draw: 9, ref: "#2" }, { draw: 2, ref: "800.00" }], utility: "#3" },
      { lot: "", draws: [] },
      "junk",
    ],
    drawLabels: [{ draw: 1, label: "Exterior Frames", code: "40-240-10" }],
    notes: ["One PO per Lot and activity.", 5],
  }));
  assertEquals(parsed.lots.length, 1);
  assertEquals(parsed.lots[0].draws, [{ draw: 1, ref: "#1" }]);
  assertEquals(parsed.lots[0].utility, "#3");
  assertEquals(parsed.notes, ["One PO per Lot and activity."]);
  assertThrows(() => parseAiAnswer("not json"), PaymentScheduleAiError);
  assertThrows(() => parseAiAnswer(undefined), PaymentScheduleAiError);
});

Deno.test("verified cells take amount, page and highlight from the PDF", () => {
  const document = buildAiDocument(PAGES);
  const result = verifyAiAnswer(
    answer([
      { lot: "001", phase: null, draws: [{ draw: 1, ref: "#1" }, { draw: 2, ref: "#2" }], utility: "#3" },
      { lot: "002", phase: null, draws: [{ draw: 1, ref: "#4" }, { draw: 2, ref: "#5" }], utility: "#6" },
    ], { drawLabels: [{ draw: 1, label: "Exterior Frames", code: "40-240-10" }] }),
    document,
    CONTEXT,
    "test-model",
  );

  assertEquals(result.layout, "line_items");
  assertEquals(result.cells.length, 4);
  assertEquals(result.cells[0], {
    ...result.cells[0],
    phase: null,
    lot: "001",
    draw: 1,
    amount: 200,
    page: 1,
  });
  assertEquals(result.cells[2].page, 2);
  assertEquals(result.foundTotalCents, 200_000);
  assertEquals(result.draws, [
    { draw: 1, name: "EXTERIOR FRAMES", costCode: "40-240-10" },
    { draw: 2, name: "MATERIAL DELIVERED", costCode: null },
  ]);
  // Lot 2 adds up to its price but is split 25/75 instead of 20/80.
  assertEquals(result.issues.map((issue) => issue.code), ["percentage_mismatch"]);
  assertEquals(result.issues[0].lot, "002");
  assertEquals(result.ai.lotsChecked, 2);
  assertEquals(result.ai.lotsMatchingPrice, 2);
  assertEquals(result.ai.utility, { count: 2, matching: 2, totalCents: 60_000 });
  assertEquals(result.utilityCells!.map((cell) => [cell.lot, cell.amount, cell.page]), [["001", 300, 1], ["002", 300, 2]]);
});

Deno.test("invented references, unknown Lots and draws, reused amounts are not trusted", () => {
  const document = buildAiDocument(PAGES);
  const result = verifyAiAnswer(
    answer([
      { lot: "001", phase: "9", draws: [{ draw: 1, ref: "#1" }, { draw: 2, ref: "#99" }], utility: null },
      { lot: "007", phase: null, draws: [{ draw: 1, ref: "#1" }, { draw: 2, ref: "#5" }], utility: null },
      { lot: "002", phase: null, draws: [{ draw: 3, ref: "#4" }], utility: "#3" },
    ]),
    document,
    CONTEXT,
    "test-model",
  );

  // Phase "9" is not printed in the PDF, so it is dropped.
  assertEquals(result.cells.map((cell) => [cell.phase, cell.lot, cell.draw]), [
    [null, "001", 1],
    [null, "007", 2],
  ]);
  const codes = result.issues.map((issue) => issue.code);
  assert(codes.includes("missing_draw"));
  assert(codes.includes("unknown_lot"));
  assert(codes.includes("duplicate_cell"));
  assert(codes.includes("unrecognized_row"));
  assert(result.issues.some((issue) => issue.message.includes("not printed in the PDF")));
  assert(result.issues.some((issue) => issue.message.includes("draw the Billing Setup does not have")));
});

Deno.test("price and utility mismatches are reported per Lot", () => {
  const document = buildAiDocument(PAGES);
  const context: AiJobContext = {
    ...CONTEXT,
    lots: [
      { phase: "1", lot: "1", plan: "A", priceCents: 90_000, utility: false },
      { phase: "1", lot: "2", plan: "B", priceCents: 100_000, utility: false },
      { phase: "1", lot: "3", plan: "B", priceCents: 100_000, utility: false },
      { phase: "1", lot: "UTILITY-1", plan: "UTILITY", priceCents: 60_000, utility: true },
    ],
  };
  const result = verifyAiAnswer(
    answer([
      { lot: "001", phase: null, draws: [{ draw: 1, ref: "#1" }, { draw: 2, ref: "#2" }], utility: "#3" },
    ]),
    document,
    context,
    "test-model",
  );
  const price = result.issues.find((issue) => issue.code === "price_mismatch")!;
  assertEquals(price.message, "The draws add up to $1,000.00, but in the Job its Plan A costs $900.00.");
  const utility = result.issues.find((issue) => issue.code === "utility_mismatch")!;
  assert(utility.message.includes("split among its 3 Lots is $200.00"));
  const missing = result.issues.find((issue) => issue.code === "missing_lots")!;
  assertEquals(missing.message, "Lots of the Job not found in the PDF: 2 (Phase 1), 3 (Phase 1).");
});

Deno.test("no cell found is a failure, not an empty schedule", () => {
  const document = buildAiDocument(PAGES);
  assertThrows(() => verifyAiAnswer(answer([]), document, CONTEXT, "m"));
});

Deno.test("the Mistral reader sends the model and reads the JSON answer", async () => {
  let sent: Record<string, unknown> | null = null;
  const reader = mistralScheduleReader({
    apiKey: "key",
    model: "some-model",
    fetcher: (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Promise.resolve(Response.json({
        choices: [{ message: { content: '{"lots":[{"lot":"1","draws":[{"draw":1,"ref":"#1"}]}]}' } }],
      }));
    },
  });
  const result = await reader.read(buildAiDocument(PAGES), CONTEXT);
  assertEquals(result.lots[0].draws, [{ draw: 1, ref: "#1" }]);
  assertEquals(sent!.model, "some-model");
  assertEquals(sent!.temperature, 0);
  assertEquals(sent!.top_p, 1);
  assertEquals(reader.model, "some-model");

  const busy = mistralScheduleReader({
    apiKey: "key",
    fetcher: () => Promise.resolve(new Response("", { status: 429 })),
  });
  await assertRejects(() => busy.read(buildAiDocument(PAGES), CONTEXT), PaymentScheduleAiError, "busy");

  const rejected = mistralScheduleReader({
    apiKey: "key",
    fetcher: () => Promise.resolve(Response.json({ object: "error", message: "Invalid model: x" }, { status: 400 })),
  });
  await assertRejects(
    () => rejected.read(buildAiDocument(PAGES), CONTEXT),
    PaymentScheduleAiError,
    "(error 400: Invalid model: x)",
  );
  assertEquals(providerErrorDetail({ detail: [{ msg: "bad" }] }), '[{"msg":"bad"}]');
  assertEquals(providerErrorDetail(null), "");

  const reasoning = mistralScheduleReader({
    apiKey: "key",
    fetcher: () =>
      Promise.resolve(Response.json({
        choices: [{
          finish_reason: "stop",
          message: {
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "Lot 1 has..." }] },
              { type: "text", text: '{"lots":[{"lot":"1","draws":[{"draw":2,"ref":"#2"}]}]}' },
            ],
          },
        }],
      })),
  });
  const reasoned = await reasoning.read(buildAiDocument(PAGES), CONTEXT);
  assertEquals(reasoned.lots[0].draws, [{ draw: 2, ref: "#2" }]);

  const empty = mistralScheduleReader({
    apiKey: "key",
    fetcher: () =>
      Promise.resolve(Response.json({ choices: [{ finish_reason: "stop", message: { content: [{ type: "thinking", thinking: [] }] } }] })),
  });
  await assertRejects(() => empty.read(buildAiDocument(PAGES), CONTEXT), PaymentScheduleAiError, 'stopped with "stop"');
  assertEquals(answerText("  "), null);
  assertEquals(answerText([{ type: "text", text: "{" }, { type: "text", text: "}" }]), "{}");

  const cut = mistralScheduleReader({
    apiKey: "key",
    fetcher: () => Promise.resolve(Response.json({ choices: [{ finish_reason: "length", message: { content: "{" } }] })),
  });
  await assertRejects(() => cut.read(buildAiDocument(PAGES), CONTEXT), PaymentScheduleAiError, "cut off");
});

Deno.test("the request carries the Job and the tagged text", () => {
  const request = buildAiRequest(buildAiDocument(PAGES), CONTEXT, "m");
  const user = request.messages[1].content;
  assert(user.includes("Draws of the Job's Billing Setup:"));
  assert(user.includes("$800.00 [#2]"));
  assertEquals(request.response_format, { type: "json_object" });
});

// --- The real PDF of Job 1323 -------------------------------------------------------
//
// Monte Vista's "Project Purchase Order Report": one purchase order per Lot and activity
// (40-240-10 to -40 are the four draws, -50 the Utility closet). The model is replaced
// by a reader that answers the way a correct model would, from the tagged text, so this
// checks the document, the verification and the record on the real PDF.

const FIXTURE = new URL(
  "../../../../../fixtures/private/payment-schedules/Example Payment Schedule 6 Purchase Order Report.pdf",
  import.meta.url,
);
const fixtureAvailable = (() => {
  try {
    return Deno.statSync(FIXTURE).isFile;
  } catch {
    return false;
  }
})();

// The Job as the database had it on 2026-11-24.
const PLAN_PRICES: Record<string, number> = { "1": 408_500, "2": 400_100, "3": 453_800, "3X": 454_300 };
const PHASE_PLANS: Record<string, Array<[string, string]>> = {
  "1": [["1", "3"], ["2", "2"], ["3", "1"], ["4", "1"], ["5", "3X"]],
  "2": [["6", "3X"], ["7", "2"], ["8", "1"], ["9", "1"], ["10", "2"], ["11", "3"]],
  "3": [["12", "3X"], ["13", "2"], ["14", "1"], ["15", "1"], ["16", "3"]],
  "4": [["17", "3"], ["18", "2"], ["19", "1"], ["20", "1"], ["21", "2"], ["22", "3X"]],
  "5": [["23", "3X"], ["24", "2"], ["25", "1"], ["26", "1"], ["27", "2"], ["28", "3"]],
};
const JOB_1323: AiJobContext = {
  draws: [
    { draw: 1, name: "EXTERIOR FRAMES", percentage: 20 },
    { draw: 2, name: "MATERIAL DELIVERED", percentage: 55 },
    { draw: 3, name: "INSTALLED MATERIAL", percentage: 20 },
    { draw: 4, name: "INSTALLED HARDWARE", percentage: 5 },
  ],
  lots: Object.entries(PHASE_PLANS).flatMap(([phase, lots]) => [
    ...lots.map(([lot, plan]) => ({ phase, lot, plan, priceCents: PLAN_PRICES[plan], utility: false })),
    { phase, lot: "UTILITY-1", plan: "UTILITY", priceCents: 315_000, utility: true },
  ]),
};

const ACTIVITY_DRAW: Record<string, number> = { "10": 1, "20": 2, "30": 3, "40": 4 };

/** Answers as a correct model would, reading the tagged text line by line. */
const scriptedReader: AiReader = {
  model: "scripted",
  read(document: AiDocument) {
    const lots = new Map<string, AiAnswer["lots"][number]>();
    let lot: string | null = null;
    for (const line of document.text.split("\n")) {
      const pieces = line.split(" | ");
      const lotAt = pieces.indexOf("Lot:");
      if (lotAt >= 0 && pieces[lotAt + 1]) lot = pieces[lotAt + 1];
      const activity = /^40-240-(\d0)$/u.exec(pieces[0] ?? "");
      const ref = /\[(#\d+)\]$/u.exec(pieces[pieces.length - 1] ?? "")?.[1];
      if (!activity || !ref || !lot) continue;
      const entry = lots.get(lot) ?? { lot, phase: null, draws: [], utility: null };
      if (activity[1] === "50") entry.utility = ref;
      else entry.draws.push({ draw: ACTIVITY_DRAW[activity[1]], ref });
      lots.set(lot, entry);
    }
    return Promise.resolve({
      lots: [...lots.values()],
      drawLabels: [{ draw: 1, label: "Finish Carpentry - Exterior Frames", code: "40-240-10" }],
      notes: ["One purchase order per Lot and activity."],
    });
  },
};

Deno.test({
  name: "fixture Job 1323: 28 Lots, 4 draws each, Utility split by Phase, 9 Lots off the Job price",
  ignore: !fixtureAvailable,
  async fn() {
    const content = await readPaymentSchedulePdf(await Deno.readFile(FIXTURE));
    const analysis = await analyzePaymentScheduleWithAi(content, JOB_1323, scriptedReader);

    assertEquals(analysis.pageCount, 28);
    assertEquals(analysis.cells.length, 112);
    assertEquals(new Set(analysis.cells.map((cell) => cell.lot)).size, 28);
    const lot1 = analysis.cells.filter((cell) => cell.lot === "001").map((cell) => cell.amount);
    assertEquals(lot1, [908.6, 2498.65, 908.6, 227.15]);
    assertEquals(analysis.draws[0], { draw: 1, name: "EXTERIOR FRAMES", costCode: "40-240-10" });

    // 3,150 / 5 Lots = 630 in Phases 1 and 3; 3,150 / 6 Lots = 525 in the others: 5 x 3,150.
    assertEquals(analysis.ai!.utility, { count: 28, matching: 28, totalCents: 1_575_000 });

    const prices = analysis.issues.filter((issue) => issue.code === "price_mismatch");
    assertEquals(prices.map((issue) => issue.lot), ["001", "002", "003", "004", "005", "006", "012", "022", "023"]);
    assertEquals(analysis.ai!.lotsChecked, 28);
    assertEquals(analysis.ai!.lotsMatchingPrice, 19);
    // Every Lot follows 20 / 55 / 20 / 5.
    assertEquals(analysis.issues.filter((issue) => issue.code === "percentage_mismatch"), []);
    assertEquals(analysis.issues.filter((issue) => issue.code !== "price_mismatch"), []);

    for (const cell of analysis.cells) {
      assert(cell.rect.x >= 0 && cell.rect.y >= 0 && cell.rect.x + cell.rect.w <= 1 && cell.rect.y + cell.rect.h <= 1);
    }

    // The Utility amounts are kept, one per Lot, highlighted like the draws.
    assertEquals(analysis.utilityCells!.length, 28);
    assertEquals(analysis.utilityCells![0].lot, "001");
    assertEquals(analysis.utilityCells![0].amount, 630);
    assertEquals(analysis.utilityCells!.filter((cell) => cell.amount === 525).length, 18);

    const columns = templateAnalysisColumns(analysis);
    assertEquals(columns.layout, "line_items");
    assertEquals(columns.analysis.ai?.model, "scripted");
    assertEquals(columns.analysis.ai?.utility?.total, 15_750);
    assertEquals(columns.analysis.utilityCells?.length, 28);
  },
});
