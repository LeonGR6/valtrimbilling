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

export function visitCalendarFile({ folio, date, windowStart, address, work, now = new Date() }: {
  folio: string;
  date: string;
  windowStart: string;
  address: string;
  work: string;
  now?: Date;
}): EmailAttachment | null {
  const window = customerServiceWindows.find((entry) => entry.start === windowStart);
  const start = californiaInstant(date, windowStart);
  const end = window ? californiaInstant(date, window.end) : null;
  if (!window || !start || !end) return null;
  const reference = singleLine(folio);
  const description = [
    `Arrival window: ${formatServiceTime(window.start)} to ${formatServiceTime(window.end)}.`,
    singleLine(work) && `Work: ${singleLine(work)}.`,
    `Reference: ${reference}.`,
    "Reply to the confirmation email to reach your coordinator.",
  ].filter(Boolean).join(" ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Valtrim//Customer Service//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${reference.replace(/[^A-Za-z0-9-]/gu, "")}-${date.replaceAll("-", "")}-${windowStart.replace(":", "")}@valtriminc.com`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`Valtrim service visit (${reference})`)}`,
    ...(singleLine(address) ? [`LOCATION:${text(singleLine(address))}`] : []),
    `DESCRIPTION:${text(description)}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return {
    name: "valtrim-service-visit.ics",
    contentType: "text/calendar",
    content: `${lines.map(fold).join("\r\n")}\r\n`,
  };
}
