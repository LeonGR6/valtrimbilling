import { assertEquals, assertRejects } from "@std/assert";
import { loadOptionsEmailSnapshot } from "./purchaseOrderOptionsEmailLoader.ts";

// A stand-in for the user client: it answers each table with the rows it was given
// and ignores the filters, so these tests cover what the loader itself decides (which
// pairs count, which price is shown, who is addressed), not the database.
type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

const tables = (): Record<string, Row[]> => ({
  jobs: [{
    id: 4,
    code: "1326",
    builder_id: 2,
    community: "Heritage Walk",
    purchasing_id: 7,
    job_coordinator_id: 8,
    is_active: true,
  }],
  builders: [{ id: 2, name: "The Olson Company" }],
  people: [
    { id: 7, name: "Pat Purchasing", email: "pat@valtriminc.com" },
    { id: 8, name: "Jo Coordinator", email: "" },
  ],
  lots: [{ id: 27, lot_number: "27", plan_id: 12, phase_id: 5 }],
  lot_options: [
    { lot_id: 27, option_id: 3, option_price_id: 200 },
    { lot_id: 27, option_id: 4, option_price_id: null },
  ],
  plan_options: [
    {
      id: 3,
      code: "1STR0024",
      name: "Office with French Door",
      description: null,
    },
    {
      id: 4,
      code: "2FIN-5006",
      name: "Half Shelf",
      description: "Add Half Size Shelf",
    },
  ],
  phases: [{ id: 5, code: "MODELS", building: "." }],
  plans: [{ id: 12, code: "4B" }],
  option_prices: [
    // The same rows answer the pinned price and the open price look-ups.
    { id: 200, option_id: 3, price: "1126.00", is_not_applicable: false },
    { id: 201, option_id: 4, price: "81.00", is_not_applicable: false },
  ],
  purchase_order_current_lines: [
    {
      lot_id: 27,
      option_code_key: "1STR0024",
      work_order_no: "0820MDLH27-13325-19",
      reference_no: "0004617828",
    },
    {
      lot_id: 27,
      option_code_key: "2FIN5006",
      work_order_no: "0813MDLH27-13325-19",
      reference_no: "0004617537",
    },
  ],
});

Deno.test("loads the options, prices and sources of the pairs that were added", async () => {
  const { jobId, snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(tables()),
    "Andrés Pérez",
    "4",
    [
      { lotId: "27", optionId: "3", createdOption: true },
      { lotId: "27", optionId: "4", createdOption: false },
    ],
  );

  assertEquals(jobId, "4");
  assertEquals(snapshot.jobCode, "1326");
  assertEquals(snapshot.builderName, "The Olson Company");
  assertEquals(snapshot.addedBy, "Andrés Pérez");

  const [lot] = snapshot.lots;
  assertEquals([lot.lotNumber, lot.scope, lot.planCode], [
    "27",
    "Phase MODELS",
    "4B",
  ]);
  assertEquals(lot.options.map((option) => option.code), [
    "1STR0024",
    "2FIN-5006",
  ]);
  // The Lot's pinned price when it has one, else the option's open price.
  assertEquals(lot.options.map((option) => option.price), [1126, 81]);
  assertEquals(lot.options.map((option) => option.createdInPlan), [
    true,
    false,
  ]);
  // Work orders are found by option code, ignoring separators.
  assertEquals(
    lot.options[1].source,
    "Purchase Order · work order 0813MDLH27-13325-19 · ref 0004617537",
  );
  assertEquals(lot.options[1].description, "Add Half Size Shelf");
});

Deno.test("only Purchasing is addressed when the Job Coordinator has no email", async () => {
  const { snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(tables()),
    "Ana",
    "4",
    [
      { lotId: "27", optionId: "3", createdOption: false },
    ],
  );

  assertEquals(snapshot.purchasing?.email, "pat@valtriminc.com");
  assertEquals(snapshot.jobCoordinator, null);
  assertEquals(snapshot.missingRoles, ["Job Coordinator"]);
});

Deno.test("a pair that is not selected for a Lot of the Job is left out", async () => {
  const { snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(tables()),
    "Ana",
    "4",
    [
      { lotId: "27", optionId: "3", createdOption: false },
      // Selected nowhere.
      { lotId: "27", optionId: "99", createdOption: false },
      // A Lot that is not in this Job.
      { lotId: "500", optionId: "3", createdOption: false },
    ],
  );

  assertEquals(snapshot.lots.length, 1);
  assertEquals(snapshot.lots[0].options.map((option) => option.code), [
    "1STR0024",
  ]);
});

Deno.test("nothing selected in the Sequence Sheet means nothing to send", async () => {
  await assertRejects(
    () =>
      loadOptionsEmailSnapshot(
        fakeClientWith({ lot_options: [] }),
        "Ana",
        "4",
        [
          { lotId: "27", optionId: "3", createdOption: false },
        ],
      ),
    Error,
    "no longer selected in the Sequence Sheet",
  );

  await assertRejects(
    () =>
      loadOptionsEmailSnapshot(fakeClientWith({ jobs: [] }), "Ana", "4", [
        { lotId: "27", optionId: "3", createdOption: false },
      ]),
    Error,
    "Job is no longer available",
  );
});

function fakeClientWith(over: Record<string, Row[]>) {
  return fakeClient({ ...tables(), ...over });
}
