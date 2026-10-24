// The email that tells a Job's Supervisor and Project Manager, the day before, that a DM
// is scheduled and which lots of the Sequence Sheet it covers. Pure: the Edge Function loads
// the data (dmReminderLoader.ts) and passes it in, so nothing here touches the network.
//
// The message is HTML with a plain-text twin, like the Sequence Sheet email, and carries no
// prices: only each Lot, its Plan, whether it is Reverse and the options it has.
//
// Who it goes to is decided by the person sending it: the Job's Supervisor and Project Manager
// are only the addresses it starts with, and they can be removed or joined by anyone else.

export interface DmReminderContact {
  role: string;
  name: string;
  email: string;
}

export interface DmReminderOption {
  code: string;
  description: string;
}

export interface DmReminderLot {
  lotNumber: string;
  planCode: string;
  reverse: boolean;
  options: DmReminderOption[];
}

/** One DM on the Calendar, with everything its email says and the people it is for. */
export interface DmReminderEvent {
  scheduleId: string;
  // YYYY-MM-DD, the day of the DM.
  eventDate: string;
  // The DM was split and this is one of its parts: it covers only some of the Phase's lots.
  split: boolean;
  jobId: string;
  jobCode: string;
  community: string;
  builderName: string;
  phaseCode: string;
  building: string;
  lots: DmReminderLot[];
  supervisor: DmReminderContact | null;
  projectManager: DmReminderContact | null;
  // The roles that should receive it but have no email on file.
  missingRoles: string[];
  // When an email for this DM and day last went out, or null.
  sentAt: string | null;
}

export interface DmReminderDraft {
  subject: string;
  recipients: DmReminderContact[];
}

export interface RenderedDmReminder {
  subject: string;
  text: string;
  html: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// --- Dates ------------------------------------------------------------------

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

const LOS_ANGELES_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in California, where the Calendar lives. */
export function todayInLosAngeles(now: Date = new Date()): string {
  return LOS_ANGELES_DAY.format(now);
}

/** The day after `date`: the day whose DMs are announced today. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** "Fri, Oct 23, 2026". */
export function formatEventDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Wording ---------------------------------------------------------------------------

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

/** "Phase 1 · Building 2", or just "Phase 1". */
export function dmScope(event: DmReminderEvent) {
  return [phaseLabel(event.phaseCode), buildingLabel(event.building)]
    .filter(Boolean)
    .join(" · ");
}

function lotsLabel(event: DmReminderEvent) {
  return event.lots.length === 1
    ? `Lot ${event.lots[0].lotNumber}`
    : plural(event.lots.length, "Lot", "Lots");
}

export function dmReminderSubject(event: DmReminderEvent) {
  return `DM ${formatEventDate(event.eventDate)} · Job #${event.jobCode} · ${
    [dmScope(event), lotsLabel(event)].filter(Boolean).join(" · ")
  }`;
}

/** The email to review: the Job's Supervisor and Project Manager, both only defaults. */
export function buildDmReminderDraft(event: DmReminderEvent): DmReminderDraft {
  return {
    subject: dmReminderSubject(event),
    recipients: [event.supervisor, event.projectManager].filter(
      (contact): contact is DmReminderContact => Boolean(contact?.email),
    ),
  };
}

// --- Rendering -------------------------------------------------------------------------

const BAR = "#2563eb";
const SOFT = "#dbeafe";
const CELL = "padding:12px 14px;color:#1e293b;font-size:14px;vertical-align:top;";
const HEAD =
  "padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;";

function optionLabel(option: DmReminderOption) {
  const code = option.code.trim();
  const description = option.description.trim();
  if (code && description) return `${code} · ${description}`;
  return code || description || "Option unavailable";
}

function optionHtml(option: DmReminderOption) {
  return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:4px 8px;border:1px solid #cbd5e1;border-radius:999px;background-color:#ffffff;color:#334155;font-size:12px;line-height:1.35;">${
    escapeHtml(optionLabel(option))
  }</span>`;
}

function lotRowHtml(lot: DmReminderLot, index: number) {
  const options = lot.options.length > 0
    ? lot.options.map(optionHtml).join("")
    : '<span style="color:#64748b;font-size:13px;">No options selected</span>';
  const reverse = lot.reverse
    ? '<span style="display:inline-block;padding:4px 9px;border-radius:999px;background-color:#2563eb;color:#ffffff;font-size:12px;font-weight:700;">Yes</span>'
    : '<span style="display:inline-block;padding:4px 9px;border:1px solid #cbd5e1;border-radius:999px;background-color:#ffffff;color:#475569;font-size:12px;font-weight:700;">No</span>';
  const border = "border-bottom:1px solid #e2e8f0;";
  return `
    <tr style="background-color:${index % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td style="width:64px;${CELL}${border}font-weight:700;">${
    escapeHtml(lot.lotNumber)
  }</td>
      <td style="width:100px;${CELL}${border}">${
    escapeHtml(lot.planCode || "Plan unavailable")
  }</td>
      <td align="center" style="width:82px;${CELL}${border}">${reverse}</td>
      <td style="${CELL}${border}padding-top:10px;padding-bottom:10px;">${options}</td>
    </tr>`;
}

export function renderDmReminderEmail(
  event: DmReminderEvent,
): RenderedDmReminder {
  const subject = dmReminderSubject(event);
  const when = formatEventDate(event.eventDate);
  const scope = dmScope(event);
  const intro = event.split
    ? `A DM is scheduled for ${when}. It was split into parts; these are the Sequence Sheet lots of this part.`
    : `A DM is scheduled for ${when}. These are the Sequence Sheet lots it covers.`;

  const textRows = event.lots.map((lot) =>
    [
      `Lot ${lot.lotNumber}`,
      `Plan ${lot.planCode || "unavailable"}`,
      `Reverse: ${lot.reverse ? "Yes" : "No"}`,
      lot.options.length > 0
        ? lot.options.map(optionLabel).join("; ")
        : "No options selected",
    ].join("\t")
  );
  const text = [
    `DM scheduled for ${when}`,
    `Builder: ${event.builderName}`,
    `Community: ${event.community}`,
    `Job: #${event.jobCode}`,
    ...(scope ? [`Scope: ${scope}`] : []),
    "",
    intro,
    "",
    "Lot\tPlan\tReverse\tOptions",
    ...textRows,
  ].join("\n");

  const label =
    "padding:0 18px 10px 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;";
  const value = "padding:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;";
  const html = `
    <div style="margin:0;padding:28px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:820px;margin:0 auto;border-collapse:separate;">
        <tr>
          <td style="padding:24px 26px;background-color:${BAR};border-radius:10px 10px 0 0;">
            <p style="margin:0 0 5px;color:${SOFT};font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">ValtrimBilling</p>
            <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">DM scheduled for ${
    escapeHtml(when)
  }</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 26px 8px;background-color:#ffffff;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="${label}">Builder</td>
                <td style="${value}">${escapeHtml(event.builderName)}</td>
                <td style="${label}padding-left:28px;">Community</td>
                <td style="${value}">${escapeHtml(event.community)}</td>
              </tr>
              <tr>
                <td style="${label}padding-bottom:0;">Job</td>
                <td style="${value}padding-bottom:0;">#${
    escapeHtml(event.jobCode)
  }</td>
                <td style="${label}padding-left:28px;padding-bottom:0;">${
    scope ? "Scope" : ""
  }</td>
                <td style="${value}padding-bottom:0;">${escapeHtml(scope)}</td>
              </tr>
            </table>
            <p style="margin:18px 0 6px;color:#334155;font-size:14px;line-height:1.5;">${
    escapeHtml(intro)
  }</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 26px 24px;background-color:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
              <thead>
                <tr style="background-color:#f1f5f9;">
                  <th align="left" style="${HEAD}">Lot</th>
                  <th align="left" style="${HEAD}">Plan</th>
                  <th align="center" style="${HEAD}">Reverse</th>
                  <th align="left" style="${HEAD}">Options</th>
                </tr>
              </thead>
              <tbody>${event.lots.map(lotRowHtml).join("")}</tbody>
            </table>
          </td>
        </tr>
      </table>
    </div>`;

  return { subject, text, html };
}
