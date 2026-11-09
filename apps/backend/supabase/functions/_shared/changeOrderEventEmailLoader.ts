// Loads what the "Extra / Change Order charged with a Calendar event" email says, with the signed-in
// user's own permissions (RLS applies: `caller` is a user client, never the service role). The browser
// only names the Extra / CO; the Job, the lots, their events and the Scheduling contact are all read
// here, so a tampered request cannot make the email say something the database does not.
//
// Only the lines that are charged with an event (EXT, DM or HW) are in the email. Lines with no event
// need an event of their own in the Extra / CO calendar and are not Scheduling's concern here.
//
// The email carries no prices, so none is read. Kept apart from the Edge Function so it can be tested
// with a fake client.

import {
  buildChangeOrderEmailSnapshot,
  type ChangeOrderEmailLine,
} from "./changeOrderEventEmail.ts";

// Only what the loader uses of the Supabase client.
// deno-lint-ignore no-explicit-any
type Caller = { from(table: string): any };

// The client is not typed with the database, so a row is read field by field.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function one(result: { data: unknown; error: unknown }) {
  if (result.error) throw result.error;
  return (result.data ?? null) as Row | null;
}

function many(result: { data: unknown; error: unknown }) {
  if (result.error) throw result.error;
  return (result.data ?? []) as Row[];
}

export async function loadChangeOrderEmailSnapshot(
  caller: Caller,
  sentBy: string,
  changeOrderId: string,
) {
  const changeOrder = one(
    await caller
      .from("change_orders")
      .select(
        "id, change_order_number, internal_number, status, job_id, requested_by",
      )
      .eq("id", changeOrderId)
      .maybeSingle(),
  );
  if (!changeOrder) {
    throw new Error("The Extra / Change Order is no longer available.");
  }
  if (changeOrder.status === "CANCELLED") {
    throw new Error("A cancelled Extra / Change Order cannot be announced.");
  }

  const [job, lines] = await Promise.all([
    caller
      .from("jobs")
      .select("id, code, builder_id, community, scheduling_id, is_active")
      .eq("id", changeOrder.job_id)
      .eq("is_active", true)
      .maybeSingle(),
    caller
      .from("change_order_lines")
      .select(
        "lot_id, line_number, phase_code, building, lot_number, plan_code, scope_of_work, billing_event, billing_event_date",
      )
      .eq("change_order_id", changeOrder.id)
      .not("billing_event", "is", null)
      .order("line_number", { ascending: true }),
  ]);

  const jobRow = one(job);
  if (!jobRow) throw new Error("The Job is no longer available.");

  const lineRows = many(lines);
  if (lineRows.length === 0) {
    throw new Error(
      "No lot of this Extra / Change Order is charged with a Calendar event.",
    );
  }

  const [builder, people] = await Promise.all([
    caller.from("builders").select("id, name").eq("id", jobRow.builder_id)
      .maybeSingle(),
    // Scheduling is a Company Contact (people).
    jobRow.scheduling_id
      ? caller.from("people").select("id, name, email").eq(
        "id",
        jobRow.scheduling_id,
      ).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const person = one(people);
  const emailLines: ChangeOrderEmailLine[] = lineRows.map((line) => ({
    lotNumber: String(line.lot_number ?? ""),
    planCode: String(line.plan_code ?? ""),
    phaseCode: String(line.phase_code ?? ""),
    building: String(line.building ?? ""),
    scopeOfWork: String(line.scope_of_work ?? ""),
    event: String(line.billing_event ?? ""),
    eventDate: line.billing_event_date
      ? String(line.billing_event_date).slice(0, 10)
      : null,
  }));

  return {
    changeOrderId: String(changeOrder.id),
    lotCount: emailLines.length,
    snapshot: buildChangeOrderEmailSnapshot({
      number: String(changeOrder.change_order_number ?? ""),
      internalNumber: String(changeOrder.internal_number ?? ""),
      status: String(changeOrder.status ?? ""),
      requestedBy: String(changeOrder.requested_by ?? ""),
      jobCode: String(jobRow.code ?? ""),
      community: String(jobRow.community ?? ""),
      builderName: String(one(builder)?.name ?? ""),
      sentBy,
      sentOn: new Date().toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      scheduling: person
        ? {
          name: String(person.name ?? ""),
          email: String(person.email ?? ""),
        }
        : null,
      lines: emailLines,
    }),
  };
}
