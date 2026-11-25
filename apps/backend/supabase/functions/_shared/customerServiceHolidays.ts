// Loads the holidays (service_holidays, decided 24 Nov 2026) into the shared scheduling
// rules, so date checks and business days skip them. Each Edge Function that validates a
// visit date or counts business days calls it first.
import { setCustomerServiceHolidays } from "./customerServiceScheduling.mjs";
import type { serviceClient } from "./supabase.ts";

export async function loadCustomerServiceHolidays(admin: ReturnType<typeof serviceClient>) {
  const { data, error } = await admin.from("service_holidays").select("holiday_date, name");
  if (error) throw error;
  setCustomerServiceHolidays((data ?? []).map((row) => ({ date: String(row.holiday_date), name: String(row.name) })));
}
