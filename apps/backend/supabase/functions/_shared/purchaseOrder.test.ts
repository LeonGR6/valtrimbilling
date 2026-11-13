import { assertEquals, assertThrows } from "@std/assert";
import { parsePurchaseOrder } from "./purchaseOrder.ts";
import {
  matchLot,
  matchOption,
  matchPhase,
  matchPlan,
  planFitsLotPlan,
  stringSimilarity,
} from "./purchaseOrderMatch.ts";
import {
  normalizeLotKey,
  normalizeOptionCode,
  normalizePhaseKey,
  optionNameAndDescription,
  planKeyCandidates,
  planParts,
} from "./purchaseOrderNormalize.ts";
import { parseSignedCents, toIsoDate } from "./purchaseOrderOlson.ts";
import { PurchaseOrderError } from "./purchaseOrderTypes.ts";
import type { PageContent } from "./releaseTypes.ts";

// Made-up text laid out like an Olson Vendor Notice, so these tests run without
// the private sample PDFs. Each inner array is one printed row; its cells are
// separate text runs, like the real file.

type Row = string[];

function pageOf(page: number, rows: Row[]): PageContent {
  const runs = rows.flatMap((row, index) =>
    row.map((text, column) => ({
      text,
      x: 40 + column * 80,
      y: 700 - index * 12,
      width: 60,
      height: 9,
    }))
  );
  return { page, width: 612, height: 792, rotation: 0, runs, widgets: [] };
}

const HEADER = (workOrder: string, lot: string): Row[] => [
  ["Page", "1", "of", "1", "Print Date: 1/2/2027"],
  ["Vendor Notice"],
  ["The Example Company"],
  ["Vendor:", "ValTrim Inc.", "Work Order:", workOrder],
  ["Buyers:", "MODEL SALES OFFICE"],
  [
    "Lot/Unit:",
    lot,
    "Phase:",
    "MDL",
    "Plan:",
    "4",
    "Tract:",
    "100",
    "Elevation:",
    "B",
  ],
  ["Date", "Option", "Reference#", "Quantity", "Unit Price", "Total"],
  ["R E V I S I O N"],
];

const FOOTER: Row[] = [
  ["Pursuant to the Terms, Conditions and Specifications"],
  ["Order submitted on 1/2/27 8:06 PM Pacific Time."],
];

const line = (
  code: string,
  reference: string,
  quantity: string,
  unit: string,
  total: string,
): Row => ["1/1/2027", code, reference, quantity, unit, total];

const noticeOne: Row[] = [
  ...HEADER("WO-1", "27"),
  line("2FIN5006", "0004617537", "1", "$81.00", "$81.00"),
  ["Revised by Someone - Bldr Super"],
  ["Add Half Size Shelf"],
  ["Bedroom 3"],
  ["Stage:", "4"],
  ["R E V I S E D"],
  [
    "Revised on 1/2/2027. WO:WO-1-8.",
    "Cost has changed from $0.00 to $81.00.",
  ],
  ["$81.00"],
  ...FOOTER,
];

const noticeTwo: Row[] = [
  ...HEADER("WO-2", "28"),
  line("2CAB3033", "0004618737", "1", "($14.00)", "($14.00)"),
  ["Revised by Someone - Bldr Super"],
  ["Upper Cabinet with Pole"],
  ["Stage:", "4"],
  ["R E V I S E D"],
  ["($14.00)"],
  ...FOOTER,
];

Deno.test("parses each notice on its own and reads negative prices", () => {
  const parsed = parsePurchaseOrder([
    pageOf(1, noticeOne),
    pageOf(2, noticeTwo),
  ]);

  assertEquals(parsed.issues, []);
  assertEquals(parsed.workOrders.map((workOrder) => workOrder.workOrderNo), [
    "WO-1",
    "WO-2",
  ]);
  assertEquals(parsed.workOrders[0].lotRaw, "27");
  assertEquals(parsed.workOrders[0].lines[0].descriptionLines, [
    "Add Half Size Shelf",
    "Bedroom 3",
  ]);
  assertEquals(parsed.workOrders[0].lines[0].previousCostCents, 0);
  assertEquals(parsed.workOrders[0].lines[0].revisedOn, "2027-01-02");
  assertEquals(parsed.workOrders[1].lines[0].unitPriceCents, -1400);
  assertEquals(parsed.workOrders[1].declaredTotalCents, -1400);
});

Deno.test("a notice that runs onto a second page stays one work order", () => {
  const first: Row[] = [
    ...HEADER("WO-3", "28"),
    line("2FIN7002", "0004617549", "1", "$1,935.00", "$1,935.00"),
    ["Revised by Someone"],
    ["Interior Door Upgrade"],
    ["Stage:", "3"],
    ["R E V I S I O N"],
    line("2WRD0009", "0004617551", "1", "$287.00", "$287.00"),
    ["Revised by Someone"],
    ["Mirrored Wardrobe Door"],
    ["Stage:", "3"],
    ["$2,222.00"],
  ];
  const second: Row[] = [["Page", "2", "of", "2"], ...FOOTER];

  const parsed = parsePurchaseOrder([pageOf(1, first), pageOf(2, second)]);
  assertEquals(parsed.issues, []);
  assertEquals(parsed.workOrders.length, 1);
  assertEquals(parsed.workOrders[0].lines.length, 2);
  assertEquals(parsed.workOrders[0].declaredTotalCents, 222200);
});

Deno.test("reports lines that do not add up instead of failing", () => {
  const broken: Row[] = [
    ...HEADER("WO-4", "29"),
    line("2FIN5006", "0004617537", "2", "$81.00", "$100.00"),
    ["Stage:", "4"],
    ["$99.00"],
    ...FOOTER,
  ];
  const parsed = parsePurchaseOrder([pageOf(1, broken)]);
  assertEquals(
    parsed.issues.map((issue) => issue.code).sort(),
    ["line_total_mismatch", "work_order_total_mismatch"],
  );
});

Deno.test("flags a notice without option lines", () => {
  const parsed = parsePurchaseOrder([
    pageOf(1, [...HEADER("WO-5", "30"), ...FOOTER]),
  ]);
  assertEquals(parsed.issues.map((issue) => issue.code), ["no_lines"]);
});

Deno.test("rejects a PDF that is not a supported Purchase Order", () => {
  const other = pageOf(1, [
    ["Payment Schedule for Heritage Walk"],
    ["Lot", "Draw 1", "Draw 2", "Draw 3"],
  ]);
  const error = assertThrows(
    () => parsePurchaseOrder([other]),
    PurchaseOrderError,
  );
  assertEquals(error.reason, "unrecognized_layout");

  const scanned = assertThrows(
    () => parsePurchaseOrder([pageOf(1, [])]),
    PurchaseOrderError,
  );
  assertEquals(scanned.reason, "no_text");
});

Deno.test("amounts and dates", () => {
  assertEquals(parseSignedCents("$1,126.00"), 112600);
  assertEquals(parseSignedCents("($14.00)"), -1400);
  assertEquals(parseSignedCents("-$14.00"), -1400);
  assertEquals(parseSignedCents("14"), null);
  assertEquals(toIsoDate("8/13/2026"), "2026-08-13");
  assertEquals(toIsoDate("2/30/2026"), null);
});

Deno.test("normalizes Phase, Lot, Plan and option keys", () => {
  assertEquals(normalizePhaseKey("Phase 4"), "4");
  assertEquals(normalizePhaseKey("PHASE4"), "4");
  assertEquals(normalizePhaseKey("4"), "4");
  assertEquals(normalizePhaseKey("Models"), "MODELS");
  assertEquals(normalizePhaseKey("Phoenix"), "PHOENIX");
  assertEquals(normalizeLotKey("Lot 027"), "27");
  assertEquals(normalizeLotKey("#27"), "27");
  assertEquals(normalizeLotKey("01A"), "1A");
  assertEquals(planKeyCandidates("4", "B"), ["4B", "4"]);
  assertEquals(planKeyCandidates("Plan 4B", null), ["4B"]);
  assertEquals(normalizeOptionCode("2fin-5006"), "2FIN5006");
});

Deno.test("matches the printed Phase with the system's Phase", () => {
  const phases = [{ code: "MODELS" }, { code: "1" }, { code: "2" }];

  for (const printed of ["Models", "MODELS", "Model"]) {
    const match = matchPhase(printed, phases);
    assertEquals(match.status, "matched");
  }
  const abbreviation = matchPhase("MDL", phases);
  assertEquals(abbreviation.status, "suggested");
  if (abbreviation.status === "suggested") {
    assertEquals(abbreviation.candidate.code, "MODELS");
  }

  assertEquals(matchPhase("Phase 2", phases).status, "matched");
  assertEquals(matchPhase("Phase 3", phases).status, "none");
  assertEquals(matchPhase("XYZ", phases).status, "none");
});

Deno.test("a learned alias settles a Phase without guessing", () => {
  const phases = [{ code: "MODELS" }, { code: "MOUNTAIN" }];
  // "MO" fits both names, so it is ambiguous until a reviewer chooses.
  assertEquals(matchPhase("MO", phases).status, "ambiguous");
  const aliases = new Map([["MO", "MODELS"]]);
  const match = matchPhase("MO", phases, aliases);
  assertEquals(match.status, "matched");
  if (match.status === "matched") {
    assertEquals(match.kind, "alias");
    assertEquals(match.candidate.code, "MODELS");
  }
});

Deno.test("Plans are the printed Plan plus its elevation", () => {
  const plans = [{ code: "4A" }, { code: "4B" }, { code: "4C" }];

  const combined = matchPlan("4", "B", plans);
  assertEquals(combined.status, "matched");
  if (combined.status === "matched") {
    assertEquals(combined.candidate.code, "4B");
  }

  // Plans never match by resemblance: 4D is not close to 4C.
  assertEquals(matchPlan("4", "D", plans).status, "none");

  const bare = matchPlan("4", "B", [{ code: "4" }]);
  assertEquals(bare.status, "matched");
  if (bare.status === "matched") assertEquals(bare.kind, "elevation_ignored");

  assertEquals(matchPlan("Plan 4B", null, plans).status, "matched");
});

Deno.test("a Plan is read by its number, elevation and ADA, not by how it is written", () => {
  const parts = (plan: string, elevation: string | null = null) =>
    planParts(plan, elevation);

  // The PO prints the Plan and the elevation apart; the system joins them.
  assertEquals(parts("4", "B"), { base: "4", elevation: "B", ada: false });
  assertEquals(parts("4B"), { base: "4", elevation: "B", ada: false });
  assertEquals(parts("Plan 4B"), { base: "4", elevation: "B", ada: false });

  // The R after the elevation is the same Plan mirrored.
  assertEquals(parts("1", "CR"), { base: "1", elevation: "C", ada: false });
  assertEquals(parts("2", "B-R"), { base: "2", elevation: "B", ada: false });
  assertEquals(parts("3", "A-R"), { base: "3", elevation: "A", ada: false });

  // ADA is its own version, written apart or attached.
  assertEquals(parts("3", "AR ADA"), { base: "3", elevation: "A", ada: true });
  assertEquals(parts("3", "A ADA"), { base: "3", elevation: "A", ada: true });
  assertEquals(parts("3B-ADA"), { base: "3", elevation: "B", ada: true });

  // What the system adds after the elevation is not part of it.
  assertEquals(parts("2B STC32"), { base: "2", elevation: "B", ada: false });
  assertEquals(parts("1A B200A"), { base: "1", elevation: "A", ada: false });
  assertEquals(parts("2X STC29"), { base: "2", elevation: "X", ada: false });

  // No elevation, decimals and names that are not numbered Plans.
  assertEquals(parts("3"), { base: "3", elevation: "", ada: false });
  assertEquals(parts("1 FLOORING"), { base: "1", elevation: "", ada: false });
  assertEquals(parts("4.1"), { base: "4.1", elevation: "", ada: false });
  assertEquals(parts("67"), { base: "67", elevation: "", ada: false });
  assertEquals(parts("NEGATIVE PLAN TEST").base, "");
  assertEquals(parts("2", "R"), { base: "2", elevation: "R", ada: false });
});

Deno.test("a printed Plan fits the Lot's Plan when only the notation differs", () => {
  // What the real POs print against what the system holds.
  assertEquals(planFitsLotPlan("1", "CR", "1C"), true);
  assertEquals(planFitsLotPlan("4", "CR", "4C"), true);
  assertEquals(planFitsLotPlan("2", "B-R", "2B STC32"), true);
  assertEquals(planFitsLotPlan("2", "B", "2B STC29"), true);
  assertEquals(planFitsLotPlan("3", "A ADA", "3A-ADA"), true);
  assertEquals(planFitsLotPlan("3", "AR ADA", "3A-ADA"), true);

  // Another elevation, another number or another version is another Plan.
  assertEquals(planFitsLotPlan("3", "AR ADA", "3B-ADA"), false);
  assertEquals(planFitsLotPlan("3", "A", "3A-ADA"), false);
  assertEquals(planFitsLotPlan("3", "A ADA", "3A"), false);
  assertEquals(planFitsLotPlan("5", "CR", "4C"), false);
  assertEquals(planFitsLotPlan("4", "BR", "4C"), false);

  // Nothing to compare the elevation with: left to the other rules.
  assertEquals(planFitsLotPlan("3", "A", "3"), false);
  assertEquals(planFitsLotPlan("3", null, "3A"), false);
  assertEquals(planFitsLotPlan("X", null, "3A"), false);
});

Deno.test("Lots match by number only", () => {
  const lots = [{ lotNumber: "27" }, { lotNumber: "28" }];
  assertEquals(matchLot("027", lots).status, "matched");
  assertEquals(matchLot("Lot 28", lots).status, "matched");
  assertEquals(matchLot("29", lots).status, "none");
});

Deno.test("options match by code and tell same-code options apart by description", () => {
  const options = [
    {
      code: "2FIN5006",
      name: "Add Half Size Lower Second Shelf and Pole",
      description: null,
    },
  ];

  const found = matchOption("2FIN5006", [
    "Add Half Size Lower Second Shelf and Pole at Wardrobe",
    "Bedroom 3",
  ], options);
  assertEquals(found.status, "matched");
  if (found.status === "matched") assertEquals(found.descriptionDiffers, false);

  const other = matchOption("2FIN5006", ["Garage Cabinet"], options);
  assertEquals(other.status, "matched");
  if (other.status === "matched") assertEquals(other.descriptionDiffers, true);

  assertEquals(
    matchOption("9ZZZ0000", ["Anything"], options).status,
    "missing",
  );

  const twins = [
    {
      code: "2CAB3033",
      name: "Add Upper Laundry Cabinet with Shelf and Pole",
      description: null,
    },
    {
      code: "2CAB3033",
      name: "Replace Pantry Door Hardware",
      description: null,
    },
  ];
  const picked = matchOption("2CAB3033", [
    "Add Upper Laundry Cabinet with Shelf and Pole",
  ], twins);
  assertEquals(picked.status, "matched");
  if (picked.status === "matched") {
    assertEquals(picked.candidate.name, twins[0].name);
  }
  assertEquals(
    matchOption("2CAB3033", ["Something unrelated"], twins).status,
    "ambiguous",
  );
});

Deno.test("name and description of a new option come from the printed lines", () => {
  assertEquals(
    optionNameAndDescription([
      "Interior Door Upgrade",
      "Model: Masonite",
      "Includes: fire rated door",
    ]),
    {
      name: "Interior Door Upgrade",
      description: "Model: Masonite · Includes: fire rated door",
    },
  );
  assertEquals(optionNameAndDescription(["Only a name"]), {
    name: "Only a name",
    description: null,
  });
  assertEquals(optionNameAndDescription(["x".repeat(400)]).name.length, 300);
});

Deno.test("string similarity", () => {
  assertEquals(stringSimilarity("MODELS", "MODELS"), 1);
  assertEquals(stringSimilarity("MODEL", "MODELS") > 0.7, true);
  assertEquals(stringSimilarity("MDL", "XYZ"), 0);
});
