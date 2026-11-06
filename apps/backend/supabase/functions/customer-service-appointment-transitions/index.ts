// Moves Customer Service appointments with the clock: WORKING when the customer
// window starts and COMPLETED when it ends (approved 2026-11-05). pg_cron calls
// this every minute.
//
// No caller credential is required: the outcome depends only on the server clock
// and the stored appointments, the work is idempotent, and the RPC moves states
// forward only after re-checking each window against the database clock.
import { json } from "../_shared/cors.ts";
import {
  type TransitionCandidate,
  dueAppointmentTransitions,
} from "../_shared/customerServiceAppointmentTransitions.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const admin = serviceClient();
    const now = new Date();
    const { data, error } = await admin.from("service_appointments")
      .select("id, request_id, window_starts_at, window_ends_at, state, is_current, service_requests(workflow_stage)")
      .eq("is_current", true)
      .eq("state", "SCHEDULED")
      .lte("window_starts_at", now.toISOString());
    if (error) throw error;

    const transitions = dueAppointmentTransitions((data ?? []) as unknown as TransitionCandidate[], now);
    if (!transitions.length) return json({ status: "IDLE", working: 0, completed: 0, skipped: 0 });

    const { data: result, error: applyError } = await admin.rpc("apply_customer_service_appointment_transitions", {
      p_transitions: transitions,
    });
    if (applyError) throw applyError;
    return json({ status: "APPLIED", ...result });
  } catch (error) {
    console.error("Customer Service appointment transitions failed.", error);
    return json({ error: "The appointment transitions could not be applied." }, 500);
  }
});
