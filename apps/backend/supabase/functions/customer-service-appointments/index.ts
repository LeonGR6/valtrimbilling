// Registers an accepted Customer Service appointment. The browser cannot write
// appointments: this function revalidates capacity with the shared rules against
// the current database and then calls one service-role RPC that stores the
// appointment, its travel estimates and the CONFIRMED stage atomically.
// Cancelling has no capacity rule and is a guarded RPC the browser calls directly.
import { handlePreflight, json } from "../_shared/cors.ts";
import {
  AppointmentInputError,
  californiaDayRange,
  parseRegisterInput,
  statusForDatabaseError,
  validateRegistration,
} from "../_shared/customerServiceAppointments.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
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
    throw new RequestError("You do not have permission to register Customer Service appointments.", 403);
  }
  return user.id;
}

async function register(req: Request, actorId: string) {
  const body = await req.json().catch(() => null);
  let input;
  try {
    input = parseRegisterInput(body);
  } catch (error) {
    if (error instanceof AppointmentInputError) throw new RequestError(error.message, 400);
    throw error;
  }
  const day = californiaDayRange(input.date);
  if (!day) throw new RequestError("Select a valid service date.", 400);

  const admin = serviceClient();
  const [requestResult, techniciansResult, appointmentsResult] = await Promise.all([
    admin.from("service_requests")
      .select("id, folio, workflow_stage, closed_at, valtrim_items_confirmed, estimated_duration_minutes, crew_size, customer_unavailable_dates, due_on")
      .eq("id", input.requestId)
      .maybeSingle(),
    admin.from("service_technician_roster")
      .select("id, name, is_active")
      .in("id", input.technicianIds),
    admin.from("service_appointments")
      .select("id, request_id, technician_ids, window_starts_at, starts_at, ends_at, pickup_minutes, service_requests(folio)")
      .eq("is_current", true)
      .overlaps("technician_ids", input.technicianIds)
      .gte("window_starts_at", day.start)
      .lt("window_starts_at", day.end),
  ]);
  for (const result of [requestResult, techniciansResult, appointmentsResult]) {
    if (result.error) throw result.error;
  }

  const validation = validateRegistration({
    input,
    request: requestResult.data,
    technicians: techniciansResult.data ?? [],
    // deno-lint-ignore no-explicit-any
    dayAppointments: (appointmentsResult.data ?? []) as any,
  });
  if (!validation.rpcArgs) {
    throw new RequestError("The appointment cannot be registered.", 422, validation.errors);
  }

  const { data, error } = await admin.rpc("register_customer_service_appointment", {
    p_actor_id: actorId,
    ...validation.rpcArgs,
  });
  if (error) {
    const status = statusForDatabaseError(error.code);
    if (status === 500) throw error;
    throw new RequestError(error.message, status);
  }
  return json({ ok: true, ...data });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const actorId = await authorize(req);
    return await register(req, actorId);
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message, errors: error.details ?? [] }, error.status);
    }
    console.error("Customer Service appointment registration failed.", error);
    return json({ error: "The appointment could not be registered. Try again." }, 500);
  }
});
