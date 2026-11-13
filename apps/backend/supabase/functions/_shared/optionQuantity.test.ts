import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { loadDmReminders } from "./dmReminderLoader.ts";
import { renderDmReminderEmail } from "./dmReminderEmail.ts";
import type { DmReminderEvent } from "./dmReminderEmail.ts";
import { optionUnitsFields, optionUnitsLabel, optionUnitsOf } from "./optionQuantity.ts";
import { buildOptionsEmailSnapshot, renderOptionsEmail } from "./purchaseOrderOptionsEmail.ts";
import { loadOptionsEmailSnapshot } from "./purchaseOrderOptionsEmailLoader.ts";
import { renderSequenceSheetEmail } from "./sequenceSheetEmail.ts";
import type { SequenceSheetEmailSnapshot } from "./sequenceSheetEmail.ts";

type Row = Record<string, unknown>;

// A stand-in for the user client: it answers each table with the rows it was given and ignores
// the filters, like the one in the loader tests.
function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

Deno.test("the units label says the quantity and the places, and nothing for one plain unit", () => {
  assertEquals(optionUnitsLabel({}), "");
  assertEquals(optionUnitsLabel({ quantity: 1, locations: [] }), "");
  assertEquals(optionUnitsLabel({ quantity: 3 }), "×3");
  assertEquals(optionUnitsLabel({ quantity: 1, locations: ["Garage"] }), "(Garage)");
  assertEquals(
    optionUnitsLabel({ quantity: 2, locations: ["1st floor", " 2nd floor ", ""] }),
    "×2 (1st floor, 2nd floor)",
  );
});

Deno.test("a lot_options row is read as a quantity and places, never below the places named", () => {
  assertEquals(optionUnitsOf({ quantity: 3, locations: ["A"] }), { quantity: 3, locations: ["A"] });
  assertEquals(optionUnitsOf({}), { quantity: 1, locations: [] });
  assertEquals(optionUnitsOf({ quantity: "oops", locations: ["A", "B"] }), { quantity: 2, locations: ["A", "B"] });
  assertEquals(optionUnitsOf(null), { quantity: 1, locations: [] });
  // A loader adds nothing for an option that was never repeated.
  assertEquals(optionUnitsFields({ quantity: 1, locations: [] }), {});
  assertEquals(optionUnitsFields(undefined), {});
  assertEquals(optionUnitsFields({ quantity: 2, locations: [] }), { quantity: 2, locations: [] });
});

Deno.test("the Sequence Sheet email says the quantity and places of an option, and nothing for the others", () => {
  const snapshot: SequenceSheetEmailSnapshot = {
    phaseId: "501",
    jobCode: "1307",
    community: "River Walk",
    builderName: "Acme",
    phaseCode: "2",
    building: "15",
    defaultRecipientName: "Jamie",
    defaultRecipientEmail: "jamie@example.com",
    isFirstRelease: false,
    jobCoordinator: null,
    optionsCoordinator: null,
    purchasing: null,
    supervisor: null,
    lots: [{
      lotNumber: "9",
      planCode: "4B",
      reverse: false,
      options: [
        { code: "C-101", description: "Crown", quantity: 2, locations: ["1st floor", "2nd floor"] },
        { code: "C-205", description: "Base" },
      ],
    }],
  };
  const { text, html } = renderSequenceSheetEmail(snapshot);

  assertStringIncludes(text, "C-101 · Crown ×2 (1st floor, 2nd floor), C-205 · Base");
  assertStringIncludes(html, "C-101 · Crown ×2 (1st floor, 2nd floor)");
  assertStringIncludes(html, ">C-205 · Base<");
});

Deno.test("the DM reminder says the quantity and places of an option", () => {
  const event: DmReminderEvent = {
    scheduleId: "13",
    eventDate: "2026-10-23",
    split: false,
    jobId: "1",
    jobCode: "1319",
    community: "EL MONTE",
    builderName: "KB Home",
    phaseCode: "1",
    building: "2",
    lots: [{
      lotNumber: "2",
      planCode: "4B",
      reverse: false,
      options: [{ code: "C-101", description: "Crown", quantity: 3, locations: ["Hall"] }],
    }],
    supervisor: null,
    projectManager: null,
    missingRoles: [],
    sentAt: null,
  };
  const { text, html } = renderDmReminderEmail(event);

  assertStringIncludes(text, "C-101 · Crown ×3 (Hall)");
  assertStringIncludes(html, "C-101 · Crown ×3 (Hall)");
});

Deno.test("the options email says the quantity and places of an added option", () => {
  const snapshot = buildOptionsEmailSnapshot({
    kind: "added",
    jobCode: "1326",
    community: "Heritage Walk",
    builderName: "Olson",
    changedBy: "Ana",
    changedOn: "Oct 21, 2026",
    purchasing: { name: "Pat", email: "pat@valtriminc.com" },
    jobCoordinator: null,
    additions: ["A", "B"].map((code, index) => ({
      lotId: "27",
      lotNumber: "27",
      phaseCode: "MODELS",
      building: ".",
      planCode: "4B",
      optionCode: code,
      optionName: `Option ${code}`,
      optionDescription: "",
      workOrderNo: null,
      referenceNo: null,
      createdInPlan: false,
      ...(index === 0 ? { quantity: 2, locations: ["1st floor", "2nd floor"] } : {}),
    })),
  });
  const [lot] = snapshot.lots;
  assertEquals(lot.options[0].quantity, 2);
  // An option that was never repeated carries no quantity keys at all.
  assert(!("quantity" in lot.options[1]));

  const { text, html } = renderOptionsEmail(snapshot);
  assertStringIncludes(text, "A · Option A ×2 (1st floor, 2nd floor)");
  assertStringIncludes(html, "×2 (1st floor, 2nd floor)");
  assertStringIncludes(text, "B · Option B");
  assert(!text.includes("B · Option B ×"));
});

Deno.test("the DM loader reads the quantity and places from the Lot's options", async () => {
  const events = await loadDmReminders(
    fakeClient({
      production_schedules: [
        { id: 13, stage_id: 1, activity_id: 5, variant: "BASE", scheduled_date: "2026-10-23", is_active: true },
      ],
      production_stages: [{ id: 1, stage_type: "DM", is_enabled: true }],
      production_activities: [{ id: 5, job_id: 1, phase_id: 3, status: "ACTIVE" }],
      production_schedule_lots: [{ schedule_id: 13, lot_id: 2 }],
      jobs: [{ id: 1, code: "1319", builder_id: 1, community: "EL MONTE", supervisor_id: 7, project_manager_id: 8, is_active: true }],
      phases: [{ id: 3, code: "2", building: "1" }],
      lots: [{ id: 2, lot_number: "2", plan_id: 12, is_reverse: false, is_utility_building: false }],
      plans: [{ id: 12, code: "4B" }],
      lot_options: [
        { lot_id: 2, option_id: 4, quantity: 2, locations: ["1st floor", "2nd floor"] },
        { lot_id: 2, option_id: 3, quantity: 1, locations: [] },
      ],
      plan_options: [
        { id: 3, code: "C-205", name: "Base", description: null },
        { id: 4, code: "C-101", name: "Crown", description: null },
      ],
      builders: [{ id: 1, name: "KB Home" }],
      people: [],
      dm_reminder_emails: [],
    }),
    "2026-10-23",
  );

  assertEquals(events[0].lots[0].options, [
    { code: "C-101", description: "Crown", quantity: 2, locations: ["1st floor", "2nd floor"] },
    { code: "C-205", description: "Base" },
  ]);
});

Deno.test("the options email loader reads the quantity of an added option and none for a removed one", async () => {
  const tables = (lotOptions: Row[]): Record<string, Row[]> => ({
    jobs: [{ id: 4, code: "1326", builder_id: 2, community: "Heritage Walk", purchasing_id: 7, job_coordinator_id: 8, is_active: true }],
    builders: [{ id: 2, name: "Olson" }],
    people: [{ id: 7, name: "Pat", email: "pat@valtriminc.com" }],
    lots: [{ id: 27, lot_number: "27", plan_id: 12, phase_id: 5 }],
    lot_options: lotOptions,
    plan_options: [{ id: 3, plan_id: 12, code: "1STR0024", name: "Office", description: null }],
    phases: [{ id: 5, code: "MODELS", building: "." }],
    plans: [{ id: 12, code: "4B" }],
    purchase_order_current_lines: [],
  });

  const added = await loadOptionsEmailSnapshot(
    fakeClient(tables([{ lot_id: 27, option_id: 3, quantity: 3, locations: ["Garage"] }])),
    "added_manually",
    "Ana",
    "4",
    [{ lotId: "27", optionId: "3" }],
  );
  assertEquals(added.snapshot.lots[0].options[0].quantity, 3);
  assertEquals(added.snapshot.lots[0].options[0].locations, ["Garage"]);

  const removed = await loadOptionsEmailSnapshot(
    fakeClient(tables([])),
    "removed",
    "Ana",
    "4",
    [{ lotId: "27", optionId: "3" }],
  );
  assert(!("quantity" in removed.snapshot.lots[0].options[0]));
});
