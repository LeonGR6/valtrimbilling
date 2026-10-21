// Loads what the "options changed in the Sequence Sheet" email says, with the signed-in
// user's own permissions (RLS applies: `caller` is a user client, never the service
// role). The browser only names the (Lot, option) pairs that changed; everything else
// is read here, and a pair that does not match what the database says is left out:
//
//   added    the option really is selected for a Lot of the Job
//   removed  the option exists and is no longer selected for a Lot of the Job
//
// A removed option's price is the one thing the database no longer has (it was pinned
// to the deleted selection), so the browser may send the price the Lot was billing.
// Kept apart from the Edge Function so it can be tested with a fake client.

import {
  buildOptionsEmailSnapshot,
  type OptionsEmailAddition,
  type OptionsEmailKind,
} from "./purchaseOrderOptionsEmail.ts";

// Only what the loader uses of the Supabase client.
// deno-lint-ignore no-explicit-any
type Caller = { from(table: string): any };

export interface RequestedChange {
  lotId: string;
  optionId: string;
  // Added only: the import created the option in its Plan, not just selected it.
  createdOption?: boolean;
  // Removed only: what the Lot was billing for the option.
  price?: number | null;
  priceNotApplicable?: boolean;
}

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

function indexBy(rows: Row[], key: (row: Row) => string) {
  return new Map<string, Row>(
    rows.map((row): [string, Row] => [key(row), row]),
  );
}

const codeKey = (code: unknown) =>
  String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/gu, "");

export async function loadOptionsEmailSnapshot(
  caller: Caller,
  kind: OptionsEmailKind,
  changedBy: string,
  jobId: string,
  requested: RequestedChange[],
) {
  const job = one(
    await caller
      .from("jobs")
      .select(
        "id, code, builder_id, community, purchasing_id, job_coordinator_id, is_active",
      )
      .eq("id", jobId)
      .eq("is_active", true)
      .maybeSingle(),
  );
  if (!job) throw new Error("The Job is no longer available.");

  const lotIds = [...new Set(requested.map((item) => item.lotId))];
  const [builder, lots, lotOptions, people] = await Promise.all([
    caller.from("builders").select("id, name").eq("id", job.builder_id)
      .maybeSingle(),
    caller.from("lots").select("id, lot_number, plan_id, phase_id")
      .eq("job_id", job.id).in("id", lotIds),
    caller.from("lot_options").select("lot_id, option_id, option_price_id").in(
      "lot_id",
      lotIds,
    ),
    // Purchasing and the Job Coordinator are Company Contacts (people).
    caller.from("people").select("id, name, email")
      .in("id", [job.purchasing_id, job.job_coordinator_id].filter(Boolean)),
  ]);

  const lotRows = many(lots);
  const selected = new Map<string, { optionPriceId: string | null }>();
  for (const row of many(lotOptions)) {
    selected.set(`${row.lot_id}:${row.option_id}`, {
      optionPriceId: row.option_price_id == null
        ? null
        : String(row.option_price_id),
    });
  }
  const lotsById = indexBy(lotRows, (lot) => String(lot.id));

  // The pair has to be in the state the email describes: selected when it says
  // "added", not selected any more when it says "removed".
  const valid = requested.filter((item) =>
    lotsById.has(item.lotId) &&
    selected.has(`${item.lotId}:${item.optionId}`) === (kind === "added")
  );
  if (valid.length === 0) {
    throw new Error(
      kind === "added"
        ? "Those options are no longer selected in the Sequence Sheet."
        : "Those options are still selected in the Sequence Sheet.",
    );
  }

  const optionIds = [...new Set(valid.map((item) => item.optionId))];
  const phaseIds = [...new Set(lotRows.map((lot) => lot.phase_id))];
  const pinnedPriceIds = [...selected.values()]
    .map((item) => item.optionPriceId)
    .filter((id): id is string => id !== null);
  const [options, phases, pinnedPrices, openPrices, poLines] = await Promise
    .all([
      caller.from("plan_options").select(
        "id, plan_id, code, name, description",
      ).in("id", optionIds),
      caller.from("phases").select("id, code, building").in("id", phaseIds),
      pinnedPriceIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : caller.from("option_prices").select("id, price, is_not_applicable")
          .in("id", pinnedPriceIds),
      caller.from("option_prices").select("option_id, price, is_not_applicable")
        .in("option_id", optionIds).is("effective_to", null),
      // A removed option has no Purchase Order to point to.
      kind === "added"
        ? caller.from("purchase_order_current_lines")
          .select("lot_id, option_code_key, work_order_no, reference_no")
          .eq("job_id", job.id).in("lot_id", lotIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const optionsById = indexBy(many(options), (row) => String(row.id));
  // The Plan shown is the option's own: a Lot that changed Plan lost the options of
  // its old one, and those are what the email is about.
  const planIds = [...new Set(many(options).map((row) => row.plan_id))];
  const plans = planIds.length === 0
    ? { data: [], error: null }
    : await caller.from("plans").select("id, code").in("id", planIds);
  const plansById = indexBy(many(plans), (row) => String(row.id));
  const phasesById = indexBy(many(phases), (row) => String(row.id));
  const pinnedById = indexBy(many(pinnedPrices), (row) => String(row.id));
  const openByOption = indexBy(
    many(openPrices),
    (row) => String(row.option_id),
  );
  const poByLotAndCode = indexBy(
    many(poLines),
    (row) => `${row.lot_id}:${row.option_code_key}`,
  );

  const additions: OptionsEmailAddition[] = valid.flatMap((item) => {
    const lot = lotsById.get(item.lotId);
    const option = optionsById.get(item.optionId);
    if (!lot || !option) return [];
    const phase = phasesById.get(String(lot.phase_id));

    let price: number | null;
    let priceNotApplicable: boolean;
    if (kind === "removed" && item.price !== undefined) {
      // What the Lot was billing: the pinned price died with the selection.
      price = item.price === null ? null : Number(item.price);
      priceNotApplicable = item.priceNotApplicable === true;
    } else {
      const pinned = pinnedById.get(
        selected.get(`${item.lotId}:${item.optionId}`)?.optionPriceId ?? "",
      );
      const row = pinned ?? openByOption.get(item.optionId);
      price = row ? Number(row.price) : null;
      priceNotApplicable = row?.is_not_applicable === true;
    }
    const poLine = poByLotAndCode.get(`${item.lotId}:${codeKey(option.code)}`);

    return [{
      lotId: item.lotId,
      lotNumber: String(lot.lot_number ?? ""),
      phaseCode: String(phase?.code ?? ""),
      building: String(phase?.building ?? ""),
      planCode: String(
        plansById.get(String(option.plan_id))?.code ?? "",
      ),
      optionCode: String(option.code ?? ""),
      optionName: String(option.name ?? ""),
      optionDescription: String(option.description ?? ""),
      price,
      priceNotApplicable,
      workOrderNo: poLine ? String(poLine.work_order_no) : null,
      referenceNo: poLine ? String(poLine.reference_no) : null,
      createdInPlan: kind === "added" && item.createdOption === true,
    }];
  });

  const contacts = indexBy(many(people), (person) => String(person.id));
  const contact = (id: unknown) => {
    const person = contacts.get(String(id));
    return person
      ? {
        name: String(person.name ?? ""),
        email: String(person.email ?? ""),
      }
      : null;
  };

  return {
    jobId: String(job.id),
    snapshot: buildOptionsEmailSnapshot({
      kind,
      jobCode: String(job.code ?? ""),
      community: String(job.community ?? ""),
      builderName: String(one(builder)?.name ?? ""),
      changedBy,
      changedOn: new Date().toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      purchasing: contact(job.purchasing_id),
      jobCoordinator: contact(job.job_coordinator_id),
      additions,
    }),
  };
}
