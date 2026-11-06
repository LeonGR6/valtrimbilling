// Fills travel minutes between Customer Service visits from Google Routes API.
// The API key stays in the GOOGLE_MAPS_API_KEY secret and never reaches the
// browser. Stored estimates are returned as they are; new Routes results are
// stored with source ROUTES_API (never over an existing row) so the same leg
// is not billed twice. A failure returns no minutes, never zero.
import { handlePreflight, json } from "../_shared/cors.ts";
import { parseTravelInput, resolveTravelLegs, TravelInputError } from "../_shared/customerServiceTravel.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

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

async function estimate(req: Request, actorId: string) {
  const body = await req.json().catch(() => null);
  let legs;
  try {
    legs = parseTravelInput(body);
  } catch (error) {
    if (error instanceof TravelInputError) throw new RequestError(error.message, 400);
    throw error;
  }

  const ids = [...new Set(legs.flatMap((leg) => [leg.fromRequestId, leg.toRequestId]))];
  const admin = serviceClient();
  const [requestsResult, storedResult] = await Promise.all([
    admin.from("service_requests").select("id, folio, service_properties(latitude, longitude)").in("id", ids),
    admin.from("service_travel_estimates")
      .select("from_request_id, to_request_id, minutes, source")
      .in("from_request_id", ids)
      .in("to_request_id", ids),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (storedResult.error) throw storedResult.error;

  const { results, rowsToStore } = await resolveTravelLegs({
    legs,
    // deno-lint-ignore no-explicit-any
    requests: (requestsResult.data ?? []) as any,
    stored: storedResult.data ?? [],
    apiKey: Deno.env.get("GOOGLE_MAPS_API_KEY"),
    actorId,
  });

  if (rowsToStore.length) {
    // ignoreDuplicates: a value saved meanwhile (for example a manual one) wins.
    const { error } = await admin.from("service_travel_estimates")
      .upsert(rowsToStore, { onConflict: "from_request_id,to_request_id", ignoreDuplicates: true });
    if (error) console.error("Routes API estimates could not be stored.", error);
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
