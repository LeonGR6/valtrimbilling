import { assertEquals } from "@std/assert";
import { loadDmReminders } from "./dmReminderLoader.ts";

// A stand-in for the user client: it answers each table with the rows it was given and
// ignores the filters, so these tests cover what the loader itself decides (which DMs
// count, who is addressed), not the database.
type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

const DATE = "2026-10-23";

const tables = (): Record<string, Row[]> => ({
  production_schedules: [
    // A normal DM, one of another variant, one on another day, one switched off.
    { id: 13, stage_id: 1, activity_id: 5, variant: "BASE", scheduled_date: DATE, is_active: true },
    { id: 14, stage_id: 1, activity_id: 5, variant: "BASEBOARD_INSTALL", scheduled_date: DATE, is_active: true },
    { id: 15, stage_id: 1, activity_id: 5, variant: "BASE", scheduled_date: "2026-10-24", is_active: true },
    { id: 16, stage_id: 1, activity_id: 5, variant: "BASE", scheduled_date: DATE, is_active: false },
    // A BASE schedule of an HW stage and one of a cancelled activity.
    { id: 17, stage_id: 2, activity_id: 5, variant: "BASE", scheduled_date: DATE, is_active: true },
    { id: 18, stage_id: 1, activity_id: 6, variant: "BASE", scheduled_date: DATE, is_active: true },
  ],
  production_stages: [
    { id: 1, stage_type: "DM", is_enabled: true },
    { id: 2, stage_type: "HW", is_enabled: true },
  ],
  production_activities: [
    { id: 5, job_id: 1, phase_id: 3, status: "ACTIVE" },
    { id: 6, job_id: 1, phase_id: 3, status: "CANCELLED" },
  ],
  production_schedule_lots: [
    { schedule_id: 13, lot_id: 10 },
    { schedule_id: 13, lot_id: 2 },
    { schedule_id: 13, lot_id: 99 },
  ],
  jobs: [{
    id: 1,
    code: "1319",
    builder_id: 1,
    community: "EL MONTE",
    supervisor_id: 7,
    project_manager_id: 8,
    is_active: true,
  }],
  phases: [{ id: 3, code: "2", building: "1" }],
  lots: [
    { id: 10, lot_number: "10", plan_id: 12, is_reverse: false, is_utility_building: false },
    { id: 2, lot_number: "2", plan_id: 12, is_reverse: true, is_utility_building: false },
    { id: 99, lot_number: "", plan_id: 12, is_reverse: false, is_utility_building: true },
  ],
  plans: [{ id: 12, code: "4B" }],
  lot_options: [
    { lot_id: 2, option_id: 4 },
    { lot_id: 2, option_id: 3 },
  ],
  plan_options: [
    { id: 3, code: "C-205", name: "Base", description: null },
    { id: 4, code: "C-101", name: "Crown", description: "Crown molding" },
  ],
  builders: [{ id: 1, name: "KB Home" }],
  people: [
    { id: 7, name: "Hilario", email: "Hilario@valtriminc.com" },
    { id: 8, name: "Pat", email: "" },
  ],
  dm_reminder_emails: [],
});

Deno.test("only the normal DM of an active activity on that day is loaded", async () => {
  const events = await loadDmReminders(fakeClient(tables()), DATE);

  assertEquals(events.map((event) => event.scheduleId), ["13"]);
  assertEquals(events[0].jobCode, "1319");
  assertEquals(events[0].builderName, "KB Home");
  assertEquals(events[0].phaseCode, "2");
  assertEquals(events[0].sentAt, null);
});

Deno.test("it shows the lots of that DM in order, with their Plan and options, and leaves utility rows out", async () => {
  const [event] = await loadDmReminders(fakeClient(tables()), DATE);

  assertEquals(event.lots.map((lot) => lot.lotNumber), ["2", "10"]);
  assertEquals(event.lots[0].planCode, "4B");
  assertEquals(event.lots[0].reverse, true);
  // Sorted by code; the description falls back to the option's name.
  assertEquals(event.lots[0].options, [
    { code: "C-101", description: "Crown molding" },
    { code: "C-205", description: "Base" },
  ]);
  assertEquals(event.lots[1].options, []);
});

Deno.test("it addresses the Job's Supervisor and Project Manager and says who has no email", async () => {
  const [event] = await loadDmReminders(fakeClient(tables()), DATE);

  assertEquals(event.supervisor, {
    role: "Supervisor",
    name: "Hilario",
    email: "hilario@valtriminc.com",
  });
  assertEquals(event.projectManager, null);
  assertEquals(event.missingRoles, ["Project Manager"]);
});

Deno.test("a DM already announced says when, and a Job that is no longer active has no DM", async () => {
  const withLog = tables();
  withLog.dm_reminder_emails = [{ schedule_id: 13, event_date: DATE, sent_at: "2026-10-22T16:00:00Z" }];
  const [event] = await loadDmReminders(fakeClient(withLog), DATE);
  assertEquals(event.sentAt, "2026-10-22T16:00:00Z");

  const inactive = tables();
  inactive.jobs = [{ ...inactive.jobs[0], is_active: false }];
  assertEquals(await loadDmReminders(fakeClient(inactive), DATE), []);
});

Deno.test("naming one DM loads only that one, and a day with none is empty", async () => {
  assertEquals((await loadDmReminders(fakeClient(tables()), DATE, "13")).length, 1);
  assertEquals(await loadDmReminders(fakeClient(tables()), DATE, "999"), []);
  assertEquals(await loadDmReminders(fakeClient({}), DATE), []);
});
