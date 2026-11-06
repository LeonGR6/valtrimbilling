// Automatic appointment transitions (approved 2026-11-05): when a customer window
// starts the request moves to WORKING, and when it ends the appointment and its
// request move to COMPLETED, for every appointment of that window. COMPLETED means
// the window ended, not that the work was verified.
//
// This module only decides which transitions are due. The service-role RPC
// apply_customer_service_appointment_transitions writes them forward-only and
// re-checks each one against the database clock.

export type TransitionTarget = "WORKING" | "COMPLETED";

export type TransitionCandidate = {
  id: number;
  request_id: number;
  window_starts_at: string;
  window_ends_at: string;
  state: string;
  is_current: boolean;
  service_requests: { workflow_stage: string } | null;
};

export type AppointmentTransition = { appointmentId: number; to: TransitionTarget };

export function dueAppointmentTransitions(rows: TransitionCandidate[], now: Date): AppointmentTransition[] {
  return rows.flatMap((row): AppointmentTransition[] => {
    if (!row.is_current || row.state !== "SCHEDULED") return [];
    if (now.getTime() >= new Date(row.window_ends_at).getTime()) {
      return [{ appointmentId: row.id, to: "COMPLETED" }];
    }
    if (
      now.getTime() >= new Date(row.window_starts_at).getTime() &&
      row.service_requests?.workflow_stage === "CONFIRMED"
    ) {
      return [{ appointmentId: row.id, to: "WORKING" }];
    }
    return [];
  });
}
