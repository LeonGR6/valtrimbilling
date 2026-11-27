// The calendar file (.ics) attached to the customer's confirmation (decided 23 Nov 2026):
// the arrival window at the property, so the customer can add the visit to their calendar
// with one click. Nothing internal: the same details as the email.
import { californiaInstant, customerServiceWindows, formatServiceTime } from "./customerServiceScheduling.mjs";

export interface EmailAttachment {
  name: string;
  contentType: string;
  content: string;
}

// 2026-11-24T16:00:00.000Z → 20261124T160000Z
const stamp = (instant: Date) => instant.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
const singleLine = (value: unknown) => String(value ?? "").replace(/\s+/gu, " ").trim();
// RFC 5545 text: backslash, semicolon and comma are escaped.
const text = (value: string) => value.replace(/[\\;,]/gu, (character) => `\\${character}`);

// Lines longer than 75 octets continue on the next line after a space (RFC 5545).
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const limit = parts.length ? 74 : 75;
    if (encoder.encode(current + character).length > limit) {
      parts.push(current);
      current = "";
    }
    current += character;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// Reschedule block (27 Nov 2026): one calendar event per request. The identifier no longer
// depends on the date, so a moved visit replaces the event instead of adding a second one,
// and a cancelled visit removes it (cancel: true). SEQUENCE only grows: every later file
// for the same request wins. Calendars that ignore it still get the email's words.
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);

export function visitCalendarFile({ folio, date, windowStart, address, work, now = new Date(), cancel = false }: {
  folio: string;
  date: string;
  windowStart: string;
  address: string;
  work: string;
  now?: Date;
  cancel?: boolean;
}): EmailAttachment | null {
  const window = customerServiceWindows.find((entry) => entry.start === windowStart);
  const start = californiaInstant(date, windowStart);
  const end = window ? californiaInstant(date, window.end) : null;
  if (!window || !start || !end) return null;
  const reference = singleLine(folio);
  const description = [
    cancel && "This visit was cancelled.",
    `Arrival window: ${formatServiceTime(window.start)} to ${formatServiceTime(window.end)}.`,
    singleLine(work) && `Work: ${singleLine(work)}.`,
    `Reference: ${reference}.`,
    "Reply to the email from Valtrim to reach your coordinator.",
  ].filter(Boolean).join(" ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Valtrim//Customer Service//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${reference.replace(/[^A-Za-z0-9-]/gu, "")}-visit@valtriminc.com`,
    `SEQUENCE:${Math.max(0, Math.floor((now.getTime() - SEQUENCE_EPOCH) / 1000))}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`${cancel ? "Cancelled: " : ""}Valtrim service visit (${reference})`)}`,
    ...(singleLine(address) ? [`LOCATION:${text(singleLine(address))}`] : []),
    `DESCRIPTION:${text(description)}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    `TRANSP:${cancel ? "TRANSPARENT" : "OPAQUE"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return {
    name: cancel ? "valtrim-service-visit-cancelled.ics" : "valtrim-service-visit.ics",
    contentType: "text/calendar",
    content: `${lines.map(fold).join("\r\n")}\r\n`,
  };
}
