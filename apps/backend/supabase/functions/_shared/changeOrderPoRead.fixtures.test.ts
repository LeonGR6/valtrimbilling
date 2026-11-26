import { assertEquals } from "@std/assert";
import { buildPoDocument, pagesFromPdf, pagesWithoutText, verifyPoAnswer } from "./changeOrderPoRead.ts";
import { MAX_ANALYZED_PAGES, readReleasePdf } from "./releasePdf.ts";

// Runs the text side of the reader against real builder Purchase Orders in
// fixtures/private/change-order-pos (ignored by git: they are real documents). The AI is not called:
// the answers below are what a correct reading looks like, and the test checks that the PDF text
// lets every number in them be verified. Skipped when the folder is not there.

const FIXTURES = new URL("../../../../../fixtures/private/change-order-pos/", import.meta.url);

function available(name: string) {
  try {
    return Deno.statSync(new URL(name, FIXTURES)).isFile;
  } catch {
    return false;
  }
}

async function load(name: string) {
  const bytes = await Deno.readFile(new URL(name, FIXTURES));
  const pages = pagesFromPdf(await readReleasePdf(bytes, { maxContentPages: MAX_ANALYZED_PAGES }));
  return { pages, document: buildPoDocument(pages) };
}

const refFor = (document: ReturnType<typeof buildPoDocument>, cents: number, page?: number) =>
  [...document.refs.values()].find((ref) => ref.cents === cents && (page === undefined || ref.page === page))?.ref ?? null;

Deno.test({
  name: "every sample PDF opens; only the scanned Harmony PO has no text",
  ignore: !available("SIMI VALLEY 2- ATTIC ACCESS.pdf"),
  async fn() {
    const scanned: string[] = [];
    for (const entry of Deno.readDirSync(FIXTURES)) {
      if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
      const { pages } = await load(entry.name);
      if (pagesWithoutText(pages).length === pages.length) scanned.push(entry.name);
    }
    assertEquals(scanned, ["HARMONY- P1 LOT 7.pdf"]);
  },
});

Deno.test({
  name: "Simi Valley: 33 Lots at $1,689.60 are all printed amounts",
  ignore: !available("SIMI VALLEY 2- ATTIC ACCESS.pdf"),
  async fn() {
    const { document } = await load("SIMI VALLEY 2- ATTIC ACCESS.pdf");
    const each = [...document.refs.values()].filter((ref) => ref.cents === 168960);
    // Unit cost, total amount and amount due on each of the 33 lines.
    assertEquals(each.length >= 33 * 2, true);
    const lots = ["4", "6", "11", "13", "21", "40", "45", "48", "53", "63", "66"];
    const [order] = verifyPoAnswer([{
      number: "4010-C-003232", kind: "PURCHASE_ORDER", pages: [1],
      lines: lots.map((lot, index) => ({ lots: [lot], lots_text: null, amount_ref: each[index * 2].ref })),
    }], document);
    assertEquals(order.number, "4010-C-003232");
    assertEquals(order.warnings, []);
  },
});

Deno.test({
  name: "Indigo part 1: three Change Orders, the Lots of each add up to its total",
  ignore: !available("INDIGO P2-4 PART 1.pdf"),
  async fn() {
    const { document } = await load("INDIGO P2-4 PART 1.pdf");
    const lots = (page: number, cents: number, numbers: string[]) =>
      numbers.map((lot) => ({
        lots: [lot],
        amount_ref: [...document.refs.values()].filter((ref) => ref.cents === cents && ref.page === page)[numbers.indexOf(lot)]?.ref,
      }));
    const orders = verifyPoAnswer([
      { number: "4400102/247", kind: "CHANGE_ORDER", pages: [1], total_ref: refFor(document, 73672, 1), lines: lots(1, 18418, ["16", "17", "10", "11"]) },
      { number: "4400103/054", kind: "CHANGE_ORDER", pages: [2], total_ref: refFor(document, 161204, 2), lines: lots(2, 40301, ["44", "45", "46", "47"]) },
      { number: "4400104/053", kind: "CHANGE_ORDER", pages: [3], total_ref: refFor(document, 36838, 3), lines: lots(3, 18419, ["59", "60"]) },
    ], document);
    assertEquals(orders.map((order) => [order.number, order.totalCents, order.warnings]), [
      ["4400102/247", 73672, []],
      ["4400103/054", 161204, []],
      ["4400104/053", 36838, []],
    ]);
  },
});

Deno.test({
  name: "Althea: 'Lots 12 - 17' on one amount is checked as six Lots",
  ignore: !available("ALTHEA P1 L68.pdf"),
  async fn() {
    const { document } = await load("ALTHEA P1 L68.pdf");
    const [order] = verifyPoAnswer([{
      number: "M2068526708", kind: "PURCHASE_ORDER", total_ref: refFor(document, 68858),
      lines: [{ lots: ["12", "13", "14", "15", "16", "17"], lots_text: "Lots 12 - 17", amount_ref: refFor(document, 68858) }],
    }], document);
    assertEquals(order.lines[0].lotsChecked, true);
    assertEquals(order.warnings, []);
  },
});

Deno.test({
  name: "Rancho Madrina P42 Lot 1: the PO prints $2,757.81 (the Excel had $2,751.81)",
  ignore: !available("RANCHO MADRINA P42 LOT 1.pdf"),
  async fn() {
    const { document } = await load("RANCHO MADRINA P42 LOT 1.pdf");
    assertEquals(refFor(document, 275781) !== null, true);
    assertEquals(refFor(document, 275181), null);
  },
});
