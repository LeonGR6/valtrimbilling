// Loads the DMs of one day with what their email says: the Job, its Phase, the lots of that DM
// with their Plan and options, and the Job's Supervisor and Project Manager. It reads with the
// signed-in user's own permissions (RLS applies: `caller` is a user client, never the service
// role), so a user sees only what they could already see in the app.
//
// Only the main DM counts: the BASE schedule of a DM stage that is on, or, when the DM was split,
// each of its DIVISION parts (a split replaces the BASE schedule, so a part is announced on its
// own day with its own lots). The activity and the Job must still be active. Kept apart from the Edge Function so it can be
// tested with a fake client. There are no prices here: they are never read.

import type {
  DmReminderContact,
  DmReminderEvent,
  DmReminderLot,
} from "./dmReminderEmail.ts";

// Only what the loader uses of the Supabase client.
// deno-lint-ignore no-explicit-any
type Caller = { from(table: string): any };

// The client is not typed with the database, so a row is read field by field.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// A baseboard install is a different visit and is not announced.
const MAIN_DM_VARIANTS = ["BASE", "DIVISION"];

function many(result: { data: unknown; error: unknown }) {
  if (result.error) throw result.error;
  return (result.data ?? []) as Row[];
}

function indexBy(rows: Row[], key: (row: Row) => string) {
  return new Map<string, Row>(
    rows.map((row): [string, Row] => [key(row), row]),
  );
}

function unique(values: unknown[]) {
  return [...new Set(values.filter((value) => value != null).map(String))];
}

function contact(
  role: string,
  person: Row | undefined,
): DmReminderContact | null {
  const email = String(person?.email ?? "").trim().toLowerCase();
  return person && email
    ? { role, name: String(person.name ?? ""), email }
    : null;
}

/**
 * The DMs of `date`. With `scheduleId`, only that one (so a preview or a send names the DM and
 * the server finds everything else, instead of trusting what the browser says).
 */
export async function loadDmReminders(
  caller: Caller,
  date: string,
  scheduleId: string | null = null,
): Promise<DmReminderEvent[]> {
  let query = caller
    .from("production_schedules")
    .select("id, stage_id, activity_id, variant, scheduled_date, is_active")
    .eq("scheduled_date", date)
    .in("variant", MAIN_DM_VARIANTS)
    .eq("is_active", true);
  if (scheduleId !== null) query = query.eq("id", scheduleId);
  const schedules = many(await query).filter((row) =>
    MAIN_DM_VARIANTS.includes(row.variant) && row.is_active !== false &&
    String(row.scheduled_date).slice(0, 10) === date &&
    (scheduleId === null || String(row.id) === scheduleId)
  );
  if (schedules.length === 0) return [];

  const [stages, activities, scheduleLots, sendLog] = await Promise.all([
    caller.from("production_stages").select("id, stage_type, is_enabled")
      .in("id", unique(schedules.map((row) => row.stage_id))),
    caller.from("production_activities").select("id, job_id, phase_id, status")
      .in("id", unique(schedules.map((row) => row.activity_id))),
    caller.from("production_schedule_lots").select("schedule_id, lot_id")
      .in("schedule_id", unique(schedules.map((row) => row.id))),
    caller.from("dm_reminder_emails").select("schedule_id, event_date, sent_at")
      .eq("event_date", date)
      .in("schedule_id", unique(schedules.map((row) => row.id))),
  ]);

  const dmStages = indexBy(
    many(stages).filter((row) => row.stage_type === "DM" && row.is_enabled),
    (row) => String(row.id),
  );
  const activeActivities = indexBy(
    many(activities).filter((row) => row.status === "ACTIVE"),
    (row) => String(row.id),
  );
  const wanted = schedules.filter((row) =>
    dmStages.has(String(row.stage_id)) &&
    activeActivities.has(String(row.activity_id))
  );
  if (wanted.length === 0) return [];

  const jobIds = unique(
    wanted.map((row) => activeActivities.get(String(row.activity_id))?.job_id),
  );
  const phaseIds = unique(
    wanted.map((row) =>
      activeActivities.get(String(row.activity_id))?.phase_id
    ),
  );
  const lotIds = unique(many(scheduleLots).map((row) => row.lot_id));

  const [jobsResult, phasesResult, lotsResult, lotOptionsResult] = await Promise
    .all([
      caller.from("jobs").select(
        "id, code, builder_id, community, supervisor_id, project_manager_id, is_active",
      ).in("id", jobIds),
      caller.from("phases").select("id, code, building").in("id", phaseIds),
      caller.from("lots").select(
        "id, lot_number, plan_id, is_reverse, is_utility_building",
      ).in("id", lotIds),
      caller.from("lot_options").select("lot_id, option_id").in("lot_id", lotIds),
    ]);

  const jobs = indexBy(
    many(jobsResult).filter((row) => row.is_active !== false),
    (row) => String(row.id),
  );
  const lots = indexBy(many(lotsResult), (row) => String(row.id));
  const optionIds = unique(many(lotOptionsResult).map((row) => row.option_id));
  const planIds = unique([...lots.values()].map((row) => row.plan_id));
  const builderIds = unique([...jobs.values()].map((row) => row.builder_id));
  const peopleIds = unique(
    [...jobs.values()].flatMap((row) => [row.supervisor_id, row.project_manager_id]),
  );

  const [buildersResult, peopleResult, plansResult, optionsResult] = await Promise
    .all([
      caller.from("builders").select("id, name").in("id", builderIds),
      caller.from("people").select("id, name, email").in("id", peopleIds),
      caller.from("plans").select("id, code").in("id", planIds),
      caller.from("plan_options").select("id, code, name, description")
        .in("id", optionIds),
    ]);

  const builders = indexBy(many(buildersResult), (row) => String(row.id));
  const people = indexBy(many(peopleResult), (row) => String(row.id));
  const plans = indexBy(many(plansResult), (row) => String(row.id));
  const options = indexBy(many(optionsResult), (row) => String(row.id));
  const phases = indexBy(many(phasesResult), (row) => String(row.id));
  // When each DM was last announced: the newest send of that day.
  const sent = new Map<string, string>();
  for (const row of many(sendLog)) {
    const key = String(row.schedule_id);
    const at = String(row.sent_at);
    if (!sent.has(key) || Date.parse(at) > Date.parse(sent.get(key)!)) {
      sent.set(key, at);
    }
  }

  const lotIdsBySchedule = new Map<string, string[]>();
  for (const row of many(scheduleLots)) {
    const key = String(row.schedule_id);
    lotIdsBySchedule.set(key, [...(lotIdsBySchedule.get(key) ?? []), String(row.lot_id)]);
  }
  const optionIdsByLot = new Map<string, string[]>();
  for (const row of many(lotOptionsResult)) {
    const key = String(row.lot_id);
    optionIdsByLot.set(key, [...(optionIdsByLot.get(key) ?? []), String(row.option_id)]);
  }

  const events: DmReminderEvent[] = [];
  for (const schedule of wanted) {
    const activity = activeActivities.get(String(schedule.activity_id))!;
    const job = jobs.get(String(activity.job_id));
    if (!job) continue;
    const phase = phases.get(String(activity.phase_id));

    const eventLots: DmReminderLot[] = (lotIdsBySchedule.get(String(schedule.id)) ?? [])
      .map((lotId) => lots.get(lotId))
      // A utility building has no Lot number of its own and no options.
      .filter((lot): lot is Row => Boolean(lot) && !lot!.is_utility_building)
      .map((lot) => ({
        lotNumber: String(lot.lot_number ?? ""),
        planCode: String(plans.get(String(lot.plan_id))?.code ?? ""),
        reverse: Boolean(lot.is_reverse),
        options: (optionIdsByLot.get(String(lot.id)) ?? [])
          .map((optionId) => options.get(optionId))
          .filter((option): option is Row => Boolean(option))
          .map((option) => ({
            code: String(option.code ?? ""),
            description: String(option.description ?? "").trim() ||
              String(option.name ?? "").trim(),
          }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      }))
      .sort((a, b) =>
        a.lotNumber.localeCompare(b.lotNumber, "en", { numeric: true })
      );
    if (eventLots.length === 0) continue;

    const supervisor = contact("Supervisor", people.get(String(job.supervisor_id)));
    const projectManager = contact(
      "Project Manager",
      people.get(String(job.project_manager_id)),
    );

    events.push({
      scheduleId: String(schedule.id),
      eventDate: date,
      split: schedule.variant === "DIVISION",
      jobId: String(job.id),
      jobCode: String(job.code ?? ""),
      community: String(job.community ?? ""),
      builderName: String(builders.get(String(job.builder_id))?.name ?? ""),
      phaseCode: String(phase?.code ?? ""),
      building: String(phase?.building ?? ""),
      lots: eventLots,
      supervisor,
      projectManager,
      missingRoles: [
        ...(supervisor ? [] : ["Supervisor"]),
        ...(projectManager ? [] : ["Project Manager"]),
      ],
      sentAt: sent.get(String(schedule.id)) ?? null,
    });
  }

  return events.sort((a, b) =>
    a.jobCode.localeCompare(b.jobCode, "en", { numeric: true }) ||
    a.phaseCode.localeCompare(b.phaseCode, "en", { numeric: true }) ||
    a.lots[0].lotNumber.localeCompare(b.lots[0].lotNumber, "en", { numeric: true })
  );
}
