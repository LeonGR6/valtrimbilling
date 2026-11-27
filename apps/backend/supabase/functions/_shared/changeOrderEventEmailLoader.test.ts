import { assertEquals, assertRejects } from "@std/assert";
import { loadChangeOrderEmailSnapshot } from "./changeOrderEventEmailLoader.ts";

// A stand-in for the user client: it answers each table with the rows it was given and ignores the
// filters, so these tests cover what the loader itself decides (what counts, who is addressed), not
// the database.
type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
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
  change_orders: [{
    id: 5,
    change_order_number: "CO-0005",
    internal_number: null,
    status: "PENDING",
    job_id: 4,
    requested_by: "Carlos Ramirez",
  }],
  jobs: [{
    id: 4,
    code: "1295",
    builder_id: 2,
    community: "Indigo",
    scheduling_id: 7,
    is_active: true,
  }],
  builders: [{ id: 2, name: "The Olson Company" }],
  people: [{ id: 7, name: "Sam Scheduler", email: "sam@valtriminc.com" }],
  change_order_lines: [
    {
      lot_id: 70,
      line_number: 1,
      phase_code: "2",
      building: "1",
      lot_number: "7",
      plan_code: "A",
      scope_of_work: "Change locks",
      billing_event: "EXT",
      billing_event_date: "2026-11-20",
    },
    {
      lot_id: 80,
      line_number: 2,
      phase_code: "2",
      building: "1",
      lot_number: "8",
      plan_code: "A",
      scope_of_work: "Change locks",
      billing_event: "EXT",
      billing_event_date: "2026-11-20T00:00:00+00:00",
    },
  ],
});

Deno.test("the email is built from the Extra / CO as the database has it", async () => {
  const loaded = await loadChangeOrderEmailSnapshot(
    fakeClient(tables()),
    "Andrés Pérez",
    "5",
  );

  assertEquals(loaded.changeOrderId, "5");
  assertEquals(loaded.lotCount, 2);
  assertEquals(loaded.snapshot.number, "CO-0005");
  assertEquals(loaded.snapshot.builderName, "The Olson Company");
  assertEquals(loaded.snapshot.sentBy, "Andrés Pérez");
  assertEquals(loaded.snapshot.scheduling?.email, "sam@valtriminc.com");
  assertEquals(loaded.snapshot.groups.length, 1);
  // A timestamp from the database is cut to the day.
  assertEquals(loaded.snapshot.groups[0].eventDate, "2026-11-20");
  assertEquals(loaded.snapshot.groups[0].lots.map((lot) => lot.lotNumber), [
    "7",
    "8",
  ]);
});

Deno.test("a Job with nobody in Scheduling still loads, and says nobody is addressed", async () => {
  const data = tables();
  data.jobs[0].scheduling_id = null;
  const loaded = await loadChangeOrderEmailSnapshot(fakeClient(data), "A", "5");
  assertEquals(loaded.snapshot.scheduling, null);
  assertEquals(loaded.snapshot.missingRoles, ["Scheduling"]);
});

Deno.test("an Extra / CO that is not there, or a Job that is not active, is refused", async () => {
  const gone = tables();
  gone.change_orders = [];
  await assertRejects(
    () => loadChangeOrderEmailSnapshot(fakeClient(gone), "A", "5"),
    Error,
    "no longer available",
  );

  const noJob = tables();
  noJob.jobs = [];
  await assertRejects(
    () => loadChangeOrderEmailSnapshot(fakeClient(noJob), "A", "5"),
    Error,
    "The Job is no longer available",
  );
});

Deno.test("a cancelled Extra / CO is not announced", async () => {
  const data = tables();
  data.change_orders[0].status = "CANCELLED";
  await assertRejects(
    () => loadChangeOrderEmailSnapshot(fakeClient(data), "A", "5"),
    Error,
    "cancelled",
  );
});

Deno.test("an Extra / CO with no lot charged with an event has nothing to say", async () => {
  const data = tables();
  data.change_order_lines = [];
  await assertRejects(
    () => loadChangeOrderEmailSnapshot(fakeClient(data), "A", "5"),
    Error,
    "No lot of this Extra / Change Order",
  );
});

Deno.test("the lots of the events of their own come with the date and note of their event", async () => {
  const withEvents = tables();
  withEvents.change_order_event_overview = [{
    id: 9,
    scheduled_date: "2026-11-26",
    note: "Bring the ladder",
    lots: [
      { line_id: 3, lot_id: 90, phase_code: "2", building: "1", lot_number: "9", plan_code: "B", scope_of_work: "Change locks" },
    ],
  }];
  const loaded = await loadChangeOrderEmailSnapshot(fakeClient(withEvents), "Andrés Pérez", "5");

  assertEquals(loaded.lotCount, 3);
  assertEquals(
    loaded.snapshot.groups.map((group) => [group.event, group.eventDate, group.note, group.lots.map((lot) => lot.lotNumber)]),
    [
      ["EXT", "2026-11-20", "", ["7", "8"]],
      ["CO", "2026-11-26", "Bring the ladder", ["9"]],
    ],
  );

  // Only events of their own is enough to have something to say.
  const onlyEvents = { ...withEvents, change_order_lines: [] };
  const own = await loadChangeOrderEmailSnapshot(fakeClient(onlyEvents), "Andrés Pérez", "5");
  assertEquals(own.lotCount, 1);
});
