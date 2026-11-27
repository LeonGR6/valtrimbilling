import { assertEquals, assertRejects } from "@std/assert";
import {
  foldSupportPages,
  buildPoDocument,
  lotsInText,
  type PoPage,
  readOrdersWithAi,
  verifyPoAnswer,
  withOcrText,
  pagesWithoutText,
} from "./changeOrderPoRead.ts";

const page = (number: number, lines: string[]): PoPage => ({ page: number, lines, source: "text" });

const document = buildPoDocument([
  page(1, [
    "Purchase Order # 50593297 FPO Request 2079438 - ON",
    "Lot / Block 1 / 32247",
    "Exterior Trim - 327010 1.00 $0.00 $453.08 $453.08",
    "Total FPO Amount $453.08",
  ]),
  page(2, [
    "Purchase Order # 50593294 FPO Request 2079548 - ON",
    "Lot / Block 2 / 32247",
    "Exterior Trim - 327010 1.00 $0.00 $437.10 $437.10",
    "Total FPO Amount $437.10",
  ]),
]);

const refOf = (cents: number, pageNumber: number) =>
  [...document.refs.values()].find((ref) => ref.cents === cents && ref.page === pageNumber)!.ref;

Deno.test("every printed amount gets a reference, parentheses read as negative", () => {
  const doc = buildPoDocument([page(1, ["Credit $ (7,660.80) and 1,689.6000 each"])]);
  assertEquals([...doc.refs.values()].map((ref) => ref.cents), [-766080, 168960]);
  assertEquals(doc.text.includes("[#1]"), true);
});

Deno.test("Lot ranges and lists are expanded", () => {
  assertEquals([...lotsInText("Lots 12 - 17")].filter((lot) => /^\d+$/u.test(lot) && Number(lot) >= 12), [
    "12", "13", "14", "15", "16", "17",
  ]);
  assertEquals(lotsInText("L48-50,56").has("49"), true);
  assertEquals(lotsInText("Lot: 012").has("12"), true);
});

Deno.test("two Field POs in one PDF: numbers and amounts come from the PDF", () => {
  const orders = verifyPoAnswer([
    {
      number: "50593297", kind: "FIELD_PO", pages: [1], total_ref: refOf(45308, 1),
      other_numbers: [{ label: "FPO Request", value: "2079438" }],
      lines: [{ lots: ["1"], lots_text: "Lot / Block 1 / 32247", amount_ref: refOf(45308, 1) }],
    },
    {
      number: "50593294", kind: "FIELD_PO", pages: [2], total_ref: refOf(43710, 2),
      lines: [{ lots: ["2"], lots_text: "Lot / Block 2 / 32247", amount_ref: refOf(43710, 2) }],
    },
  ], document);
  assertEquals(orders.map((order) => [order.number, order.totalCents, order.warnings]), [
    ["50593297", 45308, []],
    ["50593294", 43710, []],
  ]);
  assertEquals(orders[0].otherNumbers, [{ label: "FPO Request", value: "2079438" }]);
  assertEquals(orders[0].lines[0].lotsChecked, true);
});

Deno.test("what is not printed is dropped or flagged", () => {
  const [order] = verifyPoAnswer([{
    number: "99999999", pages: [1], total_ref: "#999",
    lines: [{ lots: ["7"], lots_text: "Lot 7", amount_ref: refOf(45308, 1) }],
  }], document);
  assertEquals(order.number, null);
  assertEquals(order.totalCents, null);
  assertEquals(order.lines[0].lotsChecked, false);
  assertEquals(order.warnings.length, 4);
});

Deno.test("lines that do not add up to the total are flagged", () => {
  const doc = buildPoDocument([page(1, ["CO# 4400102/247", "16 Plan1 184.18", "17 Plan1 184.18", "Current Change Order: 400.00"])]);
  const refs = [...doc.refs.values()];
  const [order] = verifyPoAnswer([{
    number: "4400102/247", total_ref: refs[2].ref,
    lines: [{ lots: ["16"], amount_ref: refs[0].ref }, { lots: ["17"], amount_ref: refs[1].ref }],
  }], doc);
  assertEquals(order.warnings, ["The lines add up to $368.36 but the total printed is $400.00."]);
});

Deno.test("a scanned page is found and filled with the OCR text", () => {
  const pages = [page(1, []), page(2, ["Purchase Order 1 with enough text to count as text"])];
  assertEquals(pagesWithoutText(pages), [1]);
  const filled = withOcrText(pages, [{ index: 0, markdown: "# Order\n| Total | $498.29 |\n|---|---|" }], [1]);
  assertEquals(filled[0].source, "ocr");
  assertEquals(filled[0].lines, ["Order", "| Total | $498.29 |"]);
});

Deno.test("the AI is asked with the document and its answer is checked", async () => {
  let sent = "";
  const fetcher = ((_url: string, init: RequestInit) => {
    sent = String(init.body);
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: { content: JSON.stringify({ orders: [{ number: "50593297", pages: [1], total_ref: refOf(45308, 1) }] }) },
        finish_reason: "stop",
      }],
    })));
  }) as typeof fetch;
  const result = await readOrdersWithAi(document, { apiKey: "test", fetcher });
  assertEquals(sent.includes("Total FPO Amount $453.08 [#"), true);
  assertEquals(result.orders[0].totalCents, 45308);
});

Deno.test("an AI error is said plainly", async () => {
  const fetcher = (() => Promise.resolve(new Response(JSON.stringify({ message: "Invalid model" }), { status: 400 }))) as typeof fetch;
  await assertRejects(
    () => readOrdersWithAi(document, { apiKey: "test", fetcher }),
    Error,
    "The AI could not read this PDF (error 400: Invalid model).",
  );
});

const sse = (pieces: string[], finish = "stop") =>
  new Response(
    [
      ...pieces.map((piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`),
      `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: finish }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

const answer = () => JSON.stringify({ orders: [{ number: "50593297", pages: [1], total_ref: refOf(45308, 1) }] });

Deno.test("a streamed answer is put together and checked", async () => {
  const text = answer();
  const fetcher = (() => Promise.resolve(sse([text.slice(0, 20), text.slice(20)]))) as typeof fetch;
  const result = await readOrdersWithAi(document, { apiKey: "test", fetcher });
  assertEquals(result.orders[0].totalCents, 45308);
});

Deno.test("a model that writes blanks without end is cut and the faster model is asked", async () => {
  const asked: string[] = [];
  const fetcher = ((_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model;
    asked.push(model);
    return Promise.resolve(model === "mistral-large-latest" ? sse(["{", ...Array(50).fill("          ")]) : sse([answer()]));
  }) as typeof fetch;
  const result = await readOrdersWithAi(document, { apiKey: "test", fetcher });
  assertEquals(asked, ["mistral-large-latest", "mistral-medium-latest"]);
  assertEquals(result.model, "mistral-medium-latest");
  assertEquals(result.orders[0].number, "50593297");
});

Deno.test("a model that stops sending is cut, and with no time left it is not asked again", async () => {
  const asked: string[] = [];
  const fetcher = ((_url: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)).model);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "{" } }] })}\n\n`));
        init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
      },
    });
    return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
  }) as typeof fetch;
  let clock = 0;
  await assertRejects(
    () =>
      readOrdersWithAi(document, {
        apiKey: "test",
        fetcher,
        idleMs: 20,
        deadline: 40_000,
        now: () => (clock += 15_000),
      }),
    Error,
    "The AI did not answer in time.",
  );
  assertEquals(asked, ["mistral-large-latest"]);
});

const po = (fields: Partial<import("./changeOrderPoRead.ts").ReadPo>) => ({
  position: 1, number: null, numberLabel: null, kind: "PURCHASE_ORDER" as const, pages: [1], date: null, builder: null,
  project: null, description: null, totalCents: null, netTotalCents: null, otherNumbers: [], lines: [], warnings: [],
  ...fields,
});

Deno.test("a page with no number and the same total joins its Purchase Order (Simi Valley page 5)", () => {
  const orders = foldSupportPages([
    po({ number: "4010-C-003232", pages: [1, 2, 3, 4], totalCents: 5575680 }),
    po({ position: 2, kind: "CHANGE_ORDER", pages: [5], totalCents: 5575680, warnings: ["No order number was found."] }),
  ]);
  assertEquals(orders.length, 1);
  assertEquals(orders[0].number, "4010-C-003232");
  assertEquals(orders[0].pages, [1, 2, 3, 4, 5]);
});

Deno.test("a page with no number and no amount joins the only numbered order", () => {
  const orders = foldSupportPages([po({ pages: [1] }), po({ position: 2, number: "123", pages: [2], totalCents: 100 })]);
  assertEquals(orders.map((order) => [order.number, order.position, order.pages]), [["123", 1, [1, 2]]]);
});

Deno.test("a page with no number stays apart when it matches no order, or several", () => {
  const otherTotal = [po({ number: "A", totalCents: 100 }), po({ position: 2, pages: [2], totalCents: 999 })];
  assertEquals(foldSupportPages(otherTotal).length, 2);
  const twoMatches = [
    po({ number: "A", totalCents: 100 }),
    po({ position: 2, number: "B", pages: [2], totalCents: 100 }),
    po({ position: 3, pages: [3], totalCents: 100 }),
  ];
  assertEquals(foldSupportPages(twoMatches).length, 3);
  const noAmountTwoOrders = [po({ number: "A" }), po({ position: 2, number: "B", pages: [2] }), po({ position: 3, pages: [3] })];
  assertEquals(foldSupportPages(noAmountTwoOrders).length, 3);
});
