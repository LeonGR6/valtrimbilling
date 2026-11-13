import { assertEquals, assertRejects } from "@std/assert";
import { loadOptionsEmailSnapshot } from "./purchaseOrderOptionsEmailLoader.ts";

// A stand-in for the user client: it answers each table with the rows it was given
// and ignores the filters, so these tests cover what the loader itself decides (which
// pairs count, who is addressed), not the database.
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
    { lot_id: 27, option_id: 3 },
    { lot_id: 27, option_id: 4 },
  ],
  plan_options: [
    {
      id: 3,
      plan_id: 12,
      code: "1STR0024",
      name: "Office with French Door",
      description: null,
    },
    {
      id: 4,
      plan_id: 12,
      code: "2FIN-5006",
      name: "Half Shelf",
      description: "Add Half Size Shelf",
    },
  ],
  phases: [{ id: 5, code: "MODELS", building: "." }],
  plans: [{ id: 12, code: "4B" }],
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

Deno.test("loads the options and sources of the pairs that were added", async () => {
  const { jobId, snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(tables()),
    "added",
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
  assertEquals(snapshot.changedBy, "Andrés Pérez");

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
    "added",
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
    "added",
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
        "added",
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
      loadOptionsEmailSnapshot(
        fakeClientWith({ jobs: [] }),
        "added",
        "Ana",
        "4",
        [
          { lotId: "27", optionId: "3", createdOption: false },
        ],
      ),
    Error,
    "Job is no longer available",
  );
});

function fakeClientWith(over: Record<string, Row[]>) {
  return fakeClient({ ...tables(), ...over });
}

Deno.test("a removed option is loaded from what the database no longer has selected", async () => {
  // Option 5 is not in lot_options any more (it was unchecked); option 3 still is.
  const data = tables();
  data.plan_options.push({
    id: 5,
    plan_id: 12,
    code: "2CAB3033",
    name: "Add Upper Laundry Cabinet",
    description: null,
  });
  const { snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(data),
    "removed",
    "Ana",
    "4",
    [
      // Gone from the Lot: it counts.
      { lotId: "27", optionId: "5" },
      // Still selected: it did not change, so it is not in the email.
      { lotId: "27", optionId: "3" },
    ],
  );

  assertEquals(snapshot.kind, "removed");
  const [lot] = snapshot.lots;
  assertEquals(lot.options.map((option) => option.code), ["2CAB3033"]);
  assertEquals(lot.planCode, "4B");
  // A removed option points to no Purchase Order and was not created by anyone.
  assertEquals(lot.options[0].source, "");
  assertEquals(lot.options[0].createdInPlan, false);
});

Deno.test("nothing removed means nothing to send", async () => {
  // Both pairs are still selected.
  await assertRejects(
    () =>
      loadOptionsEmailSnapshot(fakeClient(tables()), "removed", "Ana", "4", [
        { lotId: "27", optionId: "3" },
        { lotId: "27", optionId: "4" },
      ]),
    Error,
    "still selected in the Sequence Sheet",
  );
});

Deno.test("an option added by editing is loaded like an added one, without a Purchase Order", async () => {
  const { snapshot } = await loadOptionsEmailSnapshot(
    fakeClient(tables()),
    "added_manually",
    "Ana",
    "4",
    [
      { lotId: "27", optionId: "3", createdOption: true },
      // Not selected: it was not added.
      { lotId: "27", optionId: "99" },
    ],
  );

  assertEquals(snapshot.kind, "added_manually");
  const [lot] = snapshot.lots;
  assertEquals(lot.options.map((option) => option.code), ["1STR0024"]);
  // The fixture has a Purchase Order line for this option, and the email ignores it.
  assertEquals(lot.options[0].source, "");
  assertEquals(lot.options[0].createdInPlan, false);
});

Deno.test("nothing selected means nothing was added by editing", async () => {
  await assertRejects(
    () =>
      loadOptionsEmailSnapshot(
        fakeClientWith({ lot_options: [] }),
        "added_manually",
        "Ana",
        "4",
        [{ lotId: "27", optionId: "3" }],
      ),
    Error,
    "no longer selected in the Sequence Sheet",
  );
});
