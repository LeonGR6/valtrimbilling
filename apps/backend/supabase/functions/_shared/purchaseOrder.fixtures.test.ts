import { assertEquals } from "@std/assert";
import { parsePurchaseOrder } from "./purchaseOrder.ts";
import { MAX_ANALYZED_PAGES, readReleasePdf } from "./releasePdf.ts";

// Runs the real pipeline against the sample Purchase Orders in
// fixtures/private/purchase-orders (ignored by git: they are real builder
// documents). The tests skip themselves when the folder is not there, so a fresh
// clone and CI stay green. Run with:
//   npm run functions:test --workspace=@valtrimbilling/backend

const FIXTURES = new URL(
  "../../../../../fixtures/private/purchase-orders/",
  import.meta.url,
);
const LOT_27 = "olson-lot-27.pdf";
const LOT_28 = "olson-lot-28.pdf";

function available(name: string) {
  try {
    return Deno.statSync(new URL(name, FIXTURES)).isFile;
  } catch {
    return false;
  }
}

async function parse(name: string) {
  const bytes = await Deno.readFile(new URL(name, FIXTURES));
  const content = await readReleasePdf(bytes, {
    maxContentPages: MAX_ANALYZED_PAGES,
  });
  return parsePurchaseOrder(content.pages);
}

Deno.test({
  name: "Olson LOT 27: three work orders with one option each",
  ignore: !available(LOT_27),
  async fn() {
    const parsed = await parse(LOT_27);
    assertEquals(parsed.parser, "olson");
    assertEquals(parsed.issues, []);
    assertEquals(parsed.workOrders.length, 3);

    for (const workOrder of parsed.workOrders) {
      assertEquals(workOrder.lotRaw, "27");
      assertEquals(workOrder.phaseRaw, "MDL");
      assertEquals(workOrder.planRaw, "4");
      assertEquals(workOrder.elevationRaw, "B");
      assertEquals(workOrder.tractRaw, "84681");
      assertEquals(workOrder.lines.length, 1);
    }

    assertEquals(
      parsed.workOrders.map((workOrder) => ({
        workOrderNo: workOrder.workOrderNo,
        code: workOrder.lines[0].optionCodeRaw,
        referenceNo: workOrder.lines[0].referenceNo,
        unitPriceCents: workOrder.lines[0].unitPriceCents,
        totalCents: workOrder.lines[0].totalCents,
        declaredTotalCents: workOrder.declaredTotalCents,
      })),
      [
        {
          workOrderNo: "0813MDLH27-13325-19",
          code: "2FIN5006",
          referenceNo: "0004617537",
          unitPriceCents: 8100,
          totalCents: 8100,
          declaredTotalCents: 8100,
        },
        {
          workOrderNo: "0820MDLH27-13325-19",
          code: "1STR0024",
          referenceNo: "0004617828",
          unitPriceCents: 112600,
          totalCents: 112600,
          declaredTotalCents: 112600,
        },
        {
          workOrderNo: "0821MDLH27-13325-19",
          code: "2CAB3033",
          referenceNo: "0004618737",
          unitPriceCents: -1400,
          totalCents: -1400,
          declaredTotalCents: -1400,
        },
      ],
    );
  },
});

Deno.test({
  name: "Olson LOT 27: descriptions and revisions",
  ignore: !available(LOT_27),
  async fn() {
    const [first, second, third] = (await parse(LOT_27)).workOrders.map(
      (workOrder) => workOrder.lines[0],
    );

    assertEquals(first.descriptionLines, [
      "Add Half Size Lower Second Shelf and Pole at Wardrobe",
      "Bedroom 3",
    ]);
    assertEquals(first.date, "2026-08-13");
    assertEquals(first.revisedOn, "2026-09-02");
    assertEquals(first.previousCostCents, 0);

    assertEquals(second.descriptionLines, [
      "Office with Exterior French Door First Floor",
    ]);

    assertEquals(third.descriptionLines, [
      "Add Upper Laundry Cabinet with Shelf and Pole",
      "Does Not Upgrade With Whole House",
      "Thermofoil White Flat Slab",
    ]);
    // This one prints no "Cost has changed" note.
    assertEquals(third.previousCostCents, null);
  },
});

Deno.test({
  name: "Olson LOT 28: one work order over two pages with two options",
  ignore: !available(LOT_28),
  async fn() {
    const parsed = await parse(LOT_28);
    assertEquals(parsed.issues, []);
    assertEquals(parsed.workOrders.length, 1);

    const [workOrder] = parsed.workOrders;
    assertEquals(workOrder.workOrderNo, "0813MDLH28-13325-14");
    assertEquals(workOrder.lotRaw, "28");
    assertEquals(workOrder.phaseRaw, "MDL");
    assertEquals(workOrder.planRaw, "2");
    assertEquals(workOrder.elevationRaw, "A");
    assertEquals(workOrder.declaredTotalCents, 222200);

    assertEquals(
      workOrder.lines.map((line) => [
        line.optionCodeRaw,
        line.totalCents,
      ]),
      [["2FIN7002", 193500], ["2WRD0009", 28700]],
    );
    assertEquals(workOrder.lines[0].descriptionLines, [
      "Interior Door Upgrade",
      "Model: Masonite Heritage Collection",
      "Includes: House to garage fire rated door",
    ]);
    assertEquals(workOrder.lines[1].descriptionLines, [
      "Mirrored Walk-in Closet Wardrobe Door Bedroom 3",
    ]);
  },
});
