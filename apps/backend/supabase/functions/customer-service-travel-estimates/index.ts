// Fills travel minutes between Customer Service visits from Google Routes API.
// The API key stays in the GOOGLE_MAPS_API_KEY secret and never reaches the
// browser. Stored estimates are returned as they are; new Routes results are
// stored with source ROUTES_API (never over an existing row) so the same leg
// is not billed twice. A failure returns no minutes, never zero.
//
// Two request bodies:
// - { legs }: minutes for the planner's travel legs (computeRoutes, with traffic
//   when the traffic mode is on).
// - { nearby: { requestId, candidateIds } }: driving miles for the nearby-visit
//   colors (computeRouteMatrix without traffic).
import { handlePreflight, json } from "../_shared/cors.ts";
import {
  parseTravelInput,
  resolveTravelLegs,
  TRAFFIC_MODES,
  type TrafficMode,
  TravelInputError,
} from "../_shared/customerServiceTravel.ts";
import { type NearbyInput, parseNearbyInput, resolveNearbyDriving } from "../_shared/customerServiceTravelMatrix.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const ESTIMATE_COLUMNS =
  "from_request_id, to_request_id, minutes, source, static_minutes, distance_miles, departure_at, traffic_model";

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

async function authorize(req: Request): Promise<string> {
  const caller = userClient(req);
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) throw new RequestError("Sign in first.", 401);

  const { data: profile, error } = await caller
    .from("app_users")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    throw new RequestError("You do not have permission to plan Customer Service appointments.", 403);
  }
  return user.id;
}

// Input problems are the caller's to fix (400), never a server failure.
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof TravelInputError) throw new RequestError(error.message, 400);
    throw error;
  }
}

async function nearbyDriving(input: NearbyInput, actorId: string) {
  const ids = [input.requestId, ...input.candidateIds];
  const admin = serviceClient();
  const [requestsResult, outboundResult, inboundResult, settingsResult] = await Promise.all([
    admin.from("service_requests").select("id, folio, service_properties(latitude, longitude)").in("id", ids),
    admin.from("service_travel_estimates").select(ESTIMATE_COLUMNS)
      .eq("from_request_id", input.requestId).in("to_request_id", input.candidateIds),
    admin.from("service_travel_estimates").select(ESTIMATE_COLUMNS)
      .eq("to_request_id", input.requestId).in("from_request_id", input.candidateIds),
    admin.from("service_scheduling_settings")
      .select("distance_green_max_miles, distance_yellow_max_miles, distance_orange_max_miles").eq("id", 1).single(),
  ]);
  for (const result of [requestsResult, outboundResult, inboundResult, settingsResult]) {
    if (result.error) throw result.error;
  }

  const settings = settingsResult.data;
  if (!settings) throw new Error("Customer Service scheduling settings are missing.");
  let resolved;
  try {
    resolved = await resolveNearbyDriving({
      input,
      // deno-lint-ignore no-explicit-any
      requests: (requestsResult.data ?? []) as any,
      stored: [...(outboundResult.data ?? []), ...(inboundResult.data ?? [])],
      bands: {
        distanceGreenMaxMiles: Number(settings.distance_green_max_miles),
        distanceYellowMaxMiles: Number(settings.distance_yellow_max_miles),
        distanceOrangeMaxMiles: Number(settings.distance_orange_max_miles),
      },
      apiKey: Deno.env.get("GOOGLE_MAPS_API_KEY"),
      actorId,
    });
  } catch (error) {
    if (error instanceof TravelInputError) throw new RequestError(error.message, 400);
    throw error;
  }
  const { results, rowsToStore, distanceUpdates } = resolved;

  if (rowsToStore.length) {
    // ignoreDuplicates: a value saved meanwhile (manual or with traffic) wins.
    const { error } = await admin.from("service_travel_estimates")
      .upsert(rowsToStore, { onConflict: "from_request_id,to_request_id", ignoreDuplicates: true });
    if (error) console.error("Route Matrix distances could not be stored.", error);
  }
  for (const { from_request_id, to_request_id, ...values } of distanceUpdates) {
    // Only the distance is filled in; the saved minutes and their source stay.
    const { error } = await admin.from("service_travel_estimates")
      .update(values)
      .eq("from_request_id", from_request_id)
      .eq("to_request_id", to_request_id)
      .is("distance_miles", null);
    if (error) console.error("Route Matrix distance could not be saved.", error);
  }
  return json({ candidates: results });
}

async function estimate(req: Request, actorId: string) {
  const body = await req.json().catch(() => null);
  const nearby = parsed(() => parseNearbyInput(body));
  if (nearby) return nearbyDriving(nearby, actorId);
  const legs = parsed(() => parseTravelInput(body));

  const ids = [...new Set(legs.flatMap((leg) => [leg.fromRequestId, leg.toRequestId]))];
  const admin = serviceClient();
  const [requestsResult, storedResult, settingsResult] = await Promise.all([
    admin.from("service_requests").select("id, folio, service_properties(latitude, longitude)").in("id", ids),
    admin.from("service_travel_estimates")
      .select(ESTIMATE_COLUMNS)
      .in("from_request_id", ids)
      .in("to_request_id", ids),
    admin.from("service_scheduling_settings").select("travel_traffic_mode").eq("id", 1).single(),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (storedResult.error) throw storedResult.error;
  if (settingsResult.error) throw settingsResult.error;

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
    actorId,
    trafficMode,
  });

  if (rowsToStore.length) {
    // ignoreDuplicates: a value saved meanwhile (for example a manual one) wins.
    const { error } = await admin.from("service_travel_estimates")
      .upsert(rowsToStore, { onConflict: "from_request_id,to_request_id", ignoreDuplicates: true });
    if (error) console.error("Routes API estimates could not be stored.", error);
  }
  for (const row of rowsToReplace) {
    // Only ROUTES_API rows are replaced; a manual value saved meanwhile is kept.
    const { from_request_id, to_request_id, created_by: _createdBy, ...values } = row;
    const { error } = await admin.from("service_travel_estimates")
      .update(values)
      .eq("from_request_id", from_request_id)
      .eq("to_request_id", to_request_id)
      .eq("source", "ROUTES_API");
    if (error) console.error("Routes API estimate could not be refreshed.", error);
  }
  return json({ legs: results });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const actorId = await authorize(req);
    return await estimate(req, actorId);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("Customer Service travel estimate failed.", error);
    return json({ error: "Travel times could not be calculated. Enter them manually." }, 500);
  }
});
