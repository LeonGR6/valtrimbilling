// The email that tells a Job's Scheduling contact which lots of an Extra / Change Order will be
// charged with an event that is already on the Calendar (EXT, DM or HW), so the extra work is done
// along with it. Pure: the Edge Function loads the data with the signed-in user's permissions and
// passes it in, so nothing here touches the network.
//
// The message is HTML with a plain-text twin, has no attachment, no link back to the application and
// no prices (Scheduling only needs to know where the work is and what it is). Sending it goes through
// the same Resend helper as the other emails (sendSequenceSheetWithResend).

export type CalendarEvent = "EXT" | "DM" | "HW";

// The order the events are listed in, and what each one is called in the Calendar.
export const EVENT_NAMES: Record<CalendarEvent, string> = {
  EXT: "Exterior frames",
  DM: "Doors and Material",
  HW: "Hardware",
};
const EVENT_ORDER = Object.keys(EVENT_NAMES) as CalendarEvent[];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

export interface ChangeOrderEmailRecipient {
  role: string;
  name: string;
  email: string;
}

export interface ChangeOrderEmailLot {
  lotNumber: string;
  planCode: string;
  scopeOfWork: string;
}

// The lots of one Phase / Building that are charged with the same event on the same date.
export interface ChangeOrderEmailGroup {
  event: CalendarEvent;
  eventName: string;
  // "Phase 2 · Building 1"; empty when the Phase has neither.
  place: string;
  // "YYYY-MM-DD" as the Calendar had it when the Extra / CO was saved; null when it was not recorded.
  eventDate: string | null;
  lots: ChangeOrderEmailLot[];
}

export interface ChangeOrderEmailSnapshot {
  number: string;
  internalNumber: string;
  status: string;
  requestedBy: string;
  jobCode: string;
  community: string;
  builderName: string;
  // Who sent it (the signed-in user), and when.
  sentBy: string;
  sentOn: string;
  scheduling: ChangeOrderEmailRecipient | null;
  // The roles that should receive it but have no email on file.
  missingRoles: string[];
  groups: ChangeOrderEmailGroup[];
}

export interface ChangeOrderEmailDraft {
  key: string;
  label: string;
  subject: string;
  recipients: ChangeOrderEmailRecipient[];
}

export interface RenderedChangeOrderEmail {
  subject: string;
  text: string;
  html: string;
}

// --- From loaded rows to the snapshot ------------------------------------------------

export interface ChangeOrderEmailContact {
  name: string;
  email: string;
}

// One line of the Extra / CO that is charged with an event, as the Edge Function loads it.
export interface ChangeOrderEmailLine {
  lotNumber: string;
  planCode: string;
  phaseCode: string;
  building: string;
  scopeOfWork: string;
  event: string;
  eventDate: string | null;
}

export interface ChangeOrderEmailSource {
  number: string;
  internalNumber: string;
  status: string;
  requestedBy: string;
  jobCode: string;
  community: string;
  builderName: string;
  sentBy: string;
  sentOn: string;
  // Null when the Job has nobody in that role; an empty email means no email on file.
  scheduling: ChangeOrderEmailContact | null;
  lines: ChangeOrderEmailLine[];
}

function phaseLabel(value: string) {
  const code = value.trim().replace(/^PHASE[\s#:\-.]*/iu, "").replace(
    /^P(?=[A-Z0-9])/iu,
    "",
  );
  return code ? `Phase ${code}` : "";
}

// A Phase can have no Building, and some store a placeholder like "." for it.
function buildingLabel(value: string) {
  const code = value.trim().replace(/^BUILDING[\s#:\-.]*/iu, "").replace(
    /^B(?=[A-Z0-9])/iu,
    "",
  );
  return /[A-Za-z0-9]/u.test(code) ? `Building ${code}` : "";
}

const isCalendarEvent = (value: string): value is CalendarEvent =>
  (EVENT_ORDER as string[]).includes(value);

const naturally = (left: string, right: string) =>
  left.localeCompare(right, "en", { numeric: true });

/** Groups the lines by event, Phase / Building and date, and decides who should get the email. */
export function buildChangeOrderEmailSnapshot(
  source: ChangeOrderEmailSource,
): ChangeOrderEmailSnapshot {
  const groups = new Map<string, ChangeOrderEmailGroup>();
  for (const line of source.lines) {
    if (!isCalendarEvent(line.event)) continue;
    const place = [phaseLabel(line.phaseCode), buildingLabel(line.building)]
      .filter(Boolean)
      .join(" · ");
    const key = [line.event, place, line.eventDate ?? ""].join("|");
    const group = groups.get(key) ?? {
      event: line.event,
      eventName: EVENT_NAMES[line.event],
      place,
      eventDate: line.eventDate,
      lots: [],
    };
    group.lots.push({
      lotNumber: line.lotNumber,
      planCode: line.planCode,
      scopeOfWork: line.scopeOfWork.trim(),
    });
    groups.set(key, group);
  }

  const email = source.scheduling?.email.trim().toLowerCase() ?? "";
  const scheduling = source.scheduling && email
    ? { role: "Scheduling", name: source.scheduling.name, email }
    : null;

  return {
    number: source.number,
    internalNumber: source.internalNumber,
    status: source.status,
    requestedBy: source.requestedBy,
    jobCode: source.jobCode,
    community: source.community,
    builderName: source.builderName,
    sentBy: source.sentBy,
    sentOn: source.sentOn,
    scheduling,
    missingRoles: scheduling ? [] : ["Scheduling"],
    groups: [...groups.values()]
      .map((group) => ({
        ...group,
        lots: [...group.lots].sort((a, b) =>
          naturally(a.lotNumber, b.lotNumber)
        ),
      }))
      .sort((a, b) =>
        EVENT_ORDER.indexOf(a.event) - EVENT_ORDER.indexOf(b.event) ||
        naturally(a.place, b.place) ||
        (a.eventDate ?? "").localeCompare(b.eventDate ?? "")
      ),
  };
}

// --- The message -----------------------------------------------------------------------

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function lotCount(snapshot: ChangeOrderEmailSnapshot) {
  return snapshot.groups.reduce((total, group) => total + group.lots.length, 0);
}

/** The events the email is about, in the Calendar's order: ["EXT", "DM"]. */
function eventsOf(snapshot: ChangeOrderEmailSnapshot) {
  return EVENT_ORDER.filter((event) =>
    snapshot.groups.some((group) => group.event === event)
  );
}

/** "EXT", "EXT and DM", "EXT, DM and HW". */
function joinEvents(events: string[]) {
  return events.length > 1
    ? `${events.slice(0, -1).join(", ")} and ${events.at(-1)}`
    : events[0] ?? "";
}

/** "Fri, Nov 20, 2026" from "2026-11-20"; the weekday is there because Scheduling plans by it. */
export function formatEmailDate(dateKey: string | null) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function changeOrderEmailSubject(snapshot: ChangeOrderEmailSnapshot) {
  const events = eventsOf(snapshot);
  const charged = events.length === 0
    ? "charged with a Calendar event"
    : `charged with the ${joinEvents(events)} ${
      events.length === 1 ? "event" : "events"
    }`;
  return `Extra / Change Order ${snapshot.number} · Job #${snapshot.jobCode} · ${charged}`;
}

/** The heading of the email: "Extra / Change Order for #1247 · Rancho Madrina" (just the Job when it has no Community). */
export function changeOrderEmailTitle(snapshot: ChangeOrderEmailSnapshot) {
  const community = snapshot.community.trim();
  return `Extra / Change Order for #${snapshot.jobCode}${
    community ? ` · ${community}` : ""
  }`;
}

function present(...recipients: (ChangeOrderEmailRecipient | null)[]) {
  return recipients.filter(
    (recipient): recipient is ChangeOrderEmailRecipient =>
      Boolean(recipient?.email),
  );
}

/** The email to review: the Job's Scheduling contact, only as a default. */
export function buildChangeOrderEmailDraft(
  snapshot: ChangeOrderEmailSnapshot,
): ChangeOrderEmailDraft {
  return {
    key: "change-order-event",
    label: "Extra / Change Order charged with a Calendar event",
    subject: changeOrderEmailSubject(snapshot),
    recipients: present(snapshot.scheduling),
  };
}

function intro(snapshot: ChangeOrderEmailSnapshot) {
  const lots = lotCount(snapshot);
  const events = eventsOf(snapshot);
  const where = events.length === 1
    ? `${EVENT_NAMES[events[0]]} (${events[0]}) event`
    : `${joinEvents(events)} events`;
  return `${
    plural(lots, "lot has", "lots have")
  } extra work that will be done and charged with ${
    lots === 1 ? "its" : "their"
  } ${where} already on the Calendar. Please make sure the work is included.`;
}

const CELL =
  "padding:10px 14px;color:#1e293b;font-size:14px;vertical-align:top;";
const LABEL =
  "padding:0 18px 8px 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;vertical-align:top;";
const VALUE =
  "padding:0 0 8px;color:#1e293b;font-size:14px;font-weight:700;vertical-align:top;";

function groupHtml(group: ChangeOrderEmailGroup) {
  const date = formatEmailDate(group.eventDate);
  const heading = [group.place, `${group.event} · ${group.eventName}`, date]
    .filter(Boolean)
    .join(" — ");
  const rows = group.lots.map((lot, index) => {
    const last = index === group.lots.length - 1;
    const border = last ? "border-bottom:1px solid #e2e8f0;" : "";
    return `
    <tr style="background-color:${index % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td style="width:110px;${CELL}${border}font-weight:700;">Lot ${
      escapeHtml(lot.lotNumber)
    }</td>
      <td style="width:90px;${CELL}${border}">${
      escapeHtml(lot.planCode || "—")
    }</td>
      <td style="${CELL}${border}">${escapeHtml(lot.scopeOfWork)}</td>
    </tr>`;
  }).join("");
  return `
    <tr style="background-color:#f1f5f9;">
      <td colspan="3" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#334155;font-size:13px;font-weight:700;">${
    escapeHtml(heading)
  }</td>
    </tr>${rows}`;
}

export function renderChangeOrderEmail(
  snapshot: ChangeOrderEmailSnapshot,
): RenderedChangeOrderEmail {
  const subject = changeOrderEmailSubject(snapshot);
  const introText = intro(snapshot);
  const status = STATUS_LABELS[snapshot.status] ?? snapshot.status;
  const title = changeOrderEmailTitle(snapshot);

  const textGroups = snapshot.groups.flatMap((group) => [
    [
      group.place,
      `${group.event} · ${group.eventName}`,
      formatEmailDate(group.eventDate),
    ].filter(Boolean).join(" — "),
    ...group.lots.map((lot) =>
      [`Lot ${lot.lotNumber}`, `Plan ${lot.planCode || "unavailable"}`, lot.scopeOfWork]
        .join("\t")
    ),
    "",
  ]);
  const text = [
    title,
    `Builder: ${snapshot.builderName}`,
    `Community: ${snapshot.community}`,
    `Job: #${snapshot.jobCode}`,
    `Extra / Change Order: ${snapshot.number}${
      snapshot.internalNumber && snapshot.internalNumber !== snapshot.number
        ? ` (${snapshot.internalNumber})`
        : ""
    }`,
    `Status: ${status}`,
    `Requested by: ${snapshot.requestedBy}`,
    "",
    introText,
    "",
    ...textGroups,
    `Sent by ${snapshot.sentBy} on ${snapshot.sentOn}.`,
  ].join("\n");

  const html = `
    <div style="margin:0;padding:28px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:820px;margin:0 auto;border-collapse:separate;">
        <tr>
          <td style="padding:24px 26px;background-color:#2563eb;border-radius:10px 10px 0 0;">
            <p style="margin:0 0 5px;color:#dbeafe;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">ValtrimBilling</p>
            <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">${
    escapeHtml(title)
  }</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 26px 8px;background-color:#ffffff;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="${LABEL}">Builder</td>
                <td style="${VALUE}">${escapeHtml(snapshot.builderName)}</td>
                <td style="${LABEL}padding-left:28px;">Community</td>
                <td style="${VALUE}">${escapeHtml(snapshot.community)}</td>
              </tr>
              <tr>
                <td style="${LABEL}">Job</td>
                <td style="${VALUE}">#${escapeHtml(snapshot.jobCode)}</td>
                <td style="${LABEL}padding-left:28px;">Requested by</td>
                <td style="${VALUE}">${escapeHtml(snapshot.requestedBy)}</td>
              </tr>
              <tr>
                <td style="${LABEL}">Extra / CO</td>
                <td colspan="3" style="${VALUE}">${
    escapeHtml(snapshot.number)
  }${
    snapshot.internalNumber && snapshot.internalNumber !== snapshot.number
      ? ` <span style="color:#64748b;font-weight:400;">(${
        escapeHtml(snapshot.internalNumber)
      })</span>`
      : ""
  } <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background-color:#e2e8f0;color:#334155;font-size:11px;font-weight:700;">${
    escapeHtml(status)
  }</span></td>
              </tr>
            </table>
            <p style="margin:12px 0 6px;color:#334155;font-size:14px;line-height:1.5;">${
    escapeHtml(introText)
  }</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 26px 20px;background-color:#ffffff;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
              <thead>
                <tr style="background-color:#f8fafc;">
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Lot</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Plan</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Scope of Work</th>
                </tr>
              </thead>
              <tbody>${snapshot.groups.map(groupHtml).join("")}</tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 26px 22px;background-color:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;">
            <p style="margin:0;color:#64748b;font-size:12px;">Sent by ${
    escapeHtml(snapshot.sentBy)
  } on ${escapeHtml(snapshot.sentOn)}. Event dates are the ones on the Calendar when the Extra / Change Order was saved.</p>
          </td>
        </tr>
      </table>
    </div>`;

  return { subject, text, html };
}
