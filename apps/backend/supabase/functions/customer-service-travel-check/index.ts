// Day-before traffic check (docs/customer-service-proposal-fit-plan.md, block R6).
// pg_cron calls it every afternoon. It asks Google again, with traffic, for the legs
// between consecutive visits of each technician on the next business day and saves
// them; the screens show each visit's delay margin from those minutes (on screen only,
// decision D6 of 10 Nov 2026). Manual legs are never recalculated.
//
// No caller credential is required, like the appointment transitions: the date comes
// from the server clock, and a second run for the same date within six hours returns
// without calling Google, so any caller can cost at most one run.
import { json } from "../_shared/cors.ts";
import { californiaDayRange } from "../_shared/customerServiceAppointments.ts";
import { resolveTravelLegs, TRAFFIC_MODES, type TrafficMode } from "../_shared/customerServiceTravel.ts";
import { nextBusinessDay, recentlyChecked, travelCheckLegs } from "../_shared/customerServiceTravelCheck.ts";
import { serviceClient } from "../_shared/supabase.ts";

const ESTIMATE_COLUMNS =
  "from_request_id, to_request_id, minutes, source, static_minutes, distance_miles, departure_at, traffic_model";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const admin = serviceClient();
    const now = new Date();
    const targetDate = nextBusinessDay(now);
    const last = await admin.from("service_travel_check_runs")
      .select("checked_at").eq("target_date", targetDate).maybeSingle();
    if (last.error) throw last.error;
    if (recentlyChecked(last.data?.checked_at, now)) return json({ status: "RECENTLY_CHECKED", targetDate });

    const day = californiaDayRange(targetDate)!;
    const appointments = await admin.from("service_appointments")
      .select("id, request_id, technician_ids, starts_at, ends_at, pickup_minutes")
      .eq("is_current", true)
      .eq("state", "SCHEDULED")
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end);
    if (appointments.error) throw appointments.error;
    const legs = travelCheckLegs(appointments.data ?? []);

    let refreshed = 0;
    let failed = 0;
    if (legs.length) {
      const ids = [...new Set(legs.flatMap((leg) => [leg.fromRequestId, leg.toRequestId]))];
      const [requestsResult, storedResult, settingsResult] = await Promise.all([
        admin.from("service_requests").select("id, folio, service_properties(latitude, longitude)").in("id", ids),
        admin.from("service_travel_estimates").select(ESTIMATE_COLUMNS).in("from_request_id", ids).in("to_request_id", ids),
        admin.from("service_scheduling_settings").select("travel_traffic_mode").eq("id", 1).single(),
      ]);
      for (const result of [requestsResult, storedResult, settingsResult]) {
        if (result.error) throw result.error;
      }
      const configuredMode = settingsResult.data?.travel_traffic_mode;
      const trafficMode: TrafficMode = (TRAFFIC_MODES as readonly string[]).includes(configuredMode)
        ? configuredMode as TrafficMode
        : "OFF";

      const { results, rowsToStore, rowsToReplace } = await resolveTravelLegs({
        legs,
        // deno-lint-ignore no-explicit-any
        requests: (requestsResult.data ?? []) as any,
        stored: storedResult.data ?? [],
        apiKey: Deno.env.get("GOOGLE_MAPS_API_KEY"),
        actorId: null,
        trafficMode,
        now,
        refresh: true,
      });
      if (rowsToStore.length) {
        // ignoreDuplicates: a value saved meanwhile (for example a manual one) wins.
        const { error } = await admin.from("service_travel_estimates")
          .upsert(rowsToStore, { onConflict: "from_request_id,to_request_id", ignoreDuplicates: true });
        if (error) console.error("Traffic check estimates could not be stored.", error);
      }
      for (const row of rowsToReplace) {
        // Only ROUTES_API rows are replaced; a manual value saved meanwhile is kept.
        const { from_request_id, to_request_id, created_by: _createdBy, ...values } = row;
        const { error } = await admin.from("service_travel_estimates")
          .update(values)
          .eq("from_request_id", from_request_id)
          .eq("to_request_id", to_request_id)
          .eq("source", "ROUTES_API");
        if (error) console.error("Traffic check estimate could not be refreshed.", error);
      }
      refreshed = results.filter((result) => result.status === "CALCULATED").length;
      failed = results.filter((result) => result.status !== "CALCULATED" && result.source !== "MANUAL").length;
    }

    const run = await admin.from("service_travel_check_runs").upsert(
      { target_date: targetDate, checked_at: now.toISOString(), legs: legs.length, refreshed, failed },
      { onConflict: "target_date" },
    );
    if (run.error) throw run.error;
    return json({ status: "CHECKED", targetDate, legs: legs.length, refreshed, failed });
  } catch (error) {
    console.error("Customer Service traffic check failed.", error);
    return json({ error: "The traffic check could not be completed." }, 500);
  }
});
