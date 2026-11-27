import { assert, assertEquals, assertThrows } from "@std/assert";
import { buildAiDocument } from "./paymentScheduleAi.ts";
import type { AiAnswer, AiDocument, AiJobContext, AiReader } from "./paymentScheduleAi.ts";
import { analyzePaymentScheduleWithAi, readPaymentSchedulePdf } from "./paymentScheduleAnalysis.ts";
import { verifyAiAnswer } from "./paymentScheduleAiVerify.ts";
import {
  learnRecipe,
  parseRecipeRules,
  readWithRecipe,
  RecipeError,
  recipeMatches,
} from "./paymentScheduleRecipe.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";

function run(text: string, x: number, y: number): TextRun {
  return { text, x, y, width: text.length * 5, height: 9 };
}

function page(number: number, runs: TextRun[]): PageContent {
  return { page: number, width: 792, height: 612, rotation: 0, runs, widgets: [] };
}

// Two Lots of a purchase order report, one page each.
function poPage(number: number, lot: string, amounts: [string, string, string]) {
  return page(number, [
    run("Purchase Order Report", 300, 580),
    run("Acme Homes", 300, 565),
    run("Lot:", 300, 500),
    run(lot, 330, 500),
    run("Plan:", 400, 500),
    run("2A", 430, 500),
    run("PO Total:", 40, 490),
    run(amounts[0], 100, 490),
    run("40-10", 40, 480),
    run("Frames", 100, 480),
    run(amounts[0], 700, 480),
    run("40-20", 40, 460),
    run("Material", 100, 460),
    run(amounts[1], 700, 460),
    run("40-50", 40, 440),
    run("Utility Closet", 100, 440),
    run(amounts[2], 700, 440),
  ]);
}

const PAGES = [poPage(1, "001", ["$200.00", "$800.00", "$300.00"]), poPage(2, "002", ["$250.00", "$750.00", "$300.00"])];

const CONTEXT: AiJobContext = {
  draws: [
    { draw: 1, name: "FRAMES", percentage: null },
    { draw: 2, name: "MATERIAL", percentage: null },
  ],
  lots: [],
};

/** What a correct AI answers for PAGES. */
function correctAnswer(document: AiDocument): AiAnswer {
  const lots: AiAnswer["lots"] = [];
  for (const line of document.lines) {
    const lotAt = line.pieces.indexOf("Lot:");
    if (lotAt >= 0) lots.push({ lot: line.pieces[lotAt + 1], phase: null, draws: [], utility: null });
    const code = line.pieces[0];
    const ref = line.refs.at(-1);
    if (!ref || !lots.length) continue;
    if (code === "40-10") lots.at(-1)!.draws.push({ draw: 1, ref });
    if (code === "40-20") lots.at(-1)!.draws.push({ draw: 2, ref });
    if (code === "40-50") lots.at(-1)!.utility = ref;
  }
  return { lots, drawLabels: [], notes: [] };
}

function confirmed(document: AiDocument) {
  return verifyAiAnswer(correctAnswer(document), document, CONTEXT, "ai");
}

Deno.test("a layout is learned from the confirmed cells: the Lot label and a text per draw and Utility", () => {
  const document = buildAiDocument(PAGES);
  const schedule = confirmed(document);
  const { rules, signatureKey } = learnRecipe(document, schedule);

  assertEquals(rules.lotLabel, "Lot:");
  assertEquals(rules.draws, [{ draw: 1, key: "40-10" }, { draw: 2, key: "40-20" }]);
  assertEquals(rules.utility, { key: "40-50" });
  assertEquals(rules.signature, ["Purchase Order Report", "Acme Homes", "Plan:", "PO Total:"]);
  assert(signatureKey.includes("1=40-10"));
  // Nothing of the content: no amount, no Lot.
  assert(!JSON.stringify(rules).includes("200.00"));
  assert(!JSON.stringify(rules).includes("001"));
});

Deno.test("reading with the recipe gives the same cells as the confirmed reading", () => {
  const document = buildAiDocument(PAGES);
  const schedule = confirmed(document);
  const { rules } = learnRecipe(document, schedule);

  // A new PDF of the same builder: other Lots and amounts, same layout.
  const next = buildAiDocument([
    poPage(1, "007", ["$100.00", "$400.00", "$150.00"]),
    poPage(2, "008", ["$110.00", "$390.00", "$150.00"]),
  ]);
  const answer = readWithRecipe(next, rules)!;
  const read = verifyAiAnswer(answer, next, CONTEXT, "recipe");
  assertEquals(read.cells.map((cell) => [cell.lot, cell.draw, cell.amount]), [
    ["007", 1, 100],
    ["007", 2, 400],
    ["008", 1, 110],
    ["008", 2, 390],
  ]);
  assertEquals(read.utilityCells!.map((cell) => [cell.lot, cell.amount]), [["007", 150], ["008", 150]]);
});

Deno.test("another layout does not match the recipe", () => {
  const document = buildAiDocument(PAGES);
  const { rules } = learnRecipe(document, confirmed(document));
  const other = buildAiDocument([page(1, [run("Exhibit B", 100, 500), run("Lot", 100, 480), run("$5.00", 300, 480)])]);
  assertEquals(recipeMatches(other, rules), false);
  assertEquals(readWithRecipe(other, rules), null);
});

Deno.test("a layout is not learned when a draw cannot be told apart or the cells are not found", () => {
  const document = buildAiDocument(PAGES);
  const schedule = confirmed(document);
  // Draw 2 claimed on the Utility line of Lot 001: no text is shared by its lines only.
  const mixed = schedule.cells.map((cell) =>
    cell.lot === "001" && cell.draw === 2 ? { ...cell, amount: 300, rect: schedule.utilityCells![0].rect } : cell
  );
  assertThrows(
    () => learnRecipe(document, { cells: mixed, utilityCells: [] }),
    RecipeError,
  );
  // An amount that is not where it says.
  assertThrows(
    () => learnRecipe(document, { cells: [{ ...schedule.cells[0], amount: 999 }] }),
    RecipeError,
    "could not be found",
  );
});

Deno.test("stored rules are read back only with the expected shape", () => {
  const document = buildAiDocument(PAGES);
  const { rules } = learnRecipe(document, confirmed(document));
  assertEquals(parseRecipeRules(JSON.parse(JSON.stringify(rules))), rules);
  assertEquals(parseRecipeRules({ ...rules, version: 2 }), null);
  assertEquals(parseRecipeRules({ ...rules, draws: [] }), null);
  assertEquals(parseRecipeRules({ ...rules, draws: [{ draw: 1 }] }), null);
  assertEquals(parseRecipeRules(null), null);
});

// --- The real PDF of Job 1323 -------------------------------------------------------

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

const ACTIVITY_DRAW: Record<string, number> = { "10": 1, "20": 2, "30": 3, "40": 4 };
const scriptedReader: AiReader = {
  model: "scripted",
  read(document: AiDocument) {
    const lots = new Map<string, AiAnswer["lots"][number]>();
    let lot: string | null = null;
    for (const line of document.lines) {
      const lotAt = line.pieces.indexOf("Lot:");
      if (lotAt >= 0 && line.pieces[lotAt + 1]) lot = line.pieces[lotAt + 1];
      const activity = /^40-240-(\d0)$/u.exec(line.pieces[0] ?? "");
      const ref = line.refs.at(-1);
      if (!activity || !ref || !lot) continue;
      const entry = lots.get(lot) ?? { lot, phase: null, draws: [], utility: null };
      if (activity[1] === "50") entry.utility = ref;
      else entry.draws.push({ draw: ACTIVITY_DRAW[activity[1]], ref });
      lots.set(lot, entry);
    }
    return Promise.resolve({ lots: [...lots.values()], drawLabels: [], notes: [] });
  },
};

Deno.test({
  name: "fixture Job 1323: the Monte Vista layout is learned and read back without AI, amount for amount",
  ignore: !fixtureAvailable,
  async fn() {
    const content = await readPaymentSchedulePdf(await Deno.readFile(FIXTURE));
    const context: AiJobContext = {
      draws: [1, 2, 3, 4].map((draw) => ({ draw, name: `D${draw}`, percentage: null })),
      lots: [],
    };
    const ai = await analyzePaymentScheduleWithAi(content, context, scriptedReader);
    const document = buildAiDocument(content.pages);
    const { rules } = learnRecipe(document, { cells: ai.cells, utilityCells: ai.utilityCells });

    assertEquals(rules.lotLabel, "Lot:");
    assertEquals(rules.draws.map(({ key }) => key), ["40-240-10", "40-240-20", "40-240-30", "40-240-40"]);
    assertEquals(rules.utility, { key: "40-240-50" });
    assert(rules.signature.includes("Project Purchase Order Report"));

    const read = verifyAiAnswer(readWithRecipe(document, rules)!, document, context, "recipe");
    assertEquals(read.cells, ai.cells);
    assertEquals(read.utilityCells, ai.utilityCells);
  },
});
