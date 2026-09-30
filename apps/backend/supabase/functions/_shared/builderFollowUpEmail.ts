export interface BuilderFollowUpEmailSnapshot {
  alreadySent: boolean;
  providerMessageId?: string;
  outboxId: string | null;
  idempotencyKey: string;
  checkpointId: string;
  scheduleId: string;
  checkpointCode: string;
  daysBefore: number;
  dueOn: string;
  workDate: string;
  stageType: "EXT" | "DM" | "HW";
  variant: string;
  jobCode: string;
  community: string;
  builderName: string;
  phaseCode: string;
  building: string;
  lotStartLabel: string;
  lotEndLabel: string;
  recipientContactId: string;
  recipientName: string;
  recipientEmail: string;
}

export interface RenderedBuilderFollowUpEmail {
  subject: string;
  text: string;
  html: string;
}

export interface BuilderFollowUpResponseLinks {
  confirmed: string;
  notReady: string;
}

export interface BuilderFollowUpEscalationSnapshot {
  alreadySent: boolean;
  providerMessageId?: string;
  escalationId: string;
  idempotencyKey: string;
  noResponseEventId: string;
  scheduleId: string;
  noResponseSince: string;
  waitBusinessDays: number;
  dueOn: string;
  workDate: string;
  stageType: "EXT" | "SHUTTER" | "DM" | "HW";
  variant: string;
  jobCode: string;
  community: string;
  builderName: string;
  phaseCode: string;
  building: string;
  lotStartLabel: string;
  lotEndLabel: string;
  superintendentContactId: string;
  superintendentName: string;
  superintendentEmail: string;
  recipientEmails: string[];
}

export interface RenderedBuilderFollowUpEscalationEmail {
  subject: string;
  text: string;
  html: string;
}

export interface BuilderFollowUpResponseEmailSnapshot {
  alreadySent: boolean;
  providerMessageId?: string;
  notificationId: string;
  notificationType: "JOBSITE_RECEIPT" | "INTERNAL_ALERT";
  idempotencyKey: string;
  recipientEmails: string[];
  responseTokenId: string;
  scheduleId: string;
  responseAction: "CONFIRMED" | "NOT_READY";
  respondedAt: string;
  targetWorkDate: string;
  finalWorkDate: string;
  stageType: "EXT" | "SHUTTER" | "DM" | "HW";
  variant: string;
  jobCode: string;
  community: string;
  builderName: string;
  phaseCode: string;
  building: string;
  lotStartLabel: string;
  lotEndLabel: string;
  superintendentName: string;
  superintendentEmail: string;
  reason: string | null;
}

interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  snapshot: BuilderFollowUpEmailSnapshot;
  rendered: RenderedBuilderFollowUpEmail;
}

interface EscalationResendOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  snapshot: BuilderFollowUpEscalationSnapshot;
  rendered: RenderedBuilderFollowUpEscalationEmail;
}

interface ResponseResendOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  snapshot: BuilderFollowUpResponseEmailSnapshot;
  rendered: RenderedBuilderFollowUpEmail;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailShell(options: {
  content: string;
  preheader: string;
  maxWidth?: number;
}) {
  return `
    <div style="margin:0;padding:24px;background-color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${escapeHtml(options.preheader)}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${
    options.maxWidth ?? 640
  }px;margin:0 auto;background-color:#ffffff;border:1px solid #dfe5ee;border-radius:12px;">
        <tr>
          <td style="padding:32px;">
            ${options.content}
          </td>
        </tr>
      </table>
    </div>
  `.trim();
}

function detailsTable(rows: Array<[label: string, value: string]>) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:collapse;">
      ${
    rows.map(([label, value], index) => `
        <tr>
          <td style="width:120px;padding:8px 0;${
      index === 0 ? "" : "border-top:1px solid #e8edf4;"
    }font-size:14px;color:#64748b;">
            ${escapeHtml(label)}
          </td>
          <td style="padding:8px 0;${
      index === 0 ? "" : "border-top:1px solid #e8edf4;"
    }font-size:14px;font-weight:700;color:#172033;">
            ${escapeHtml(value)}
          </td>
        </tr>
      `).join("")
  }
    </table>
  `.trim();
}

function checkpointLabel(code: string) {
  const labels: Record<string, string> = {
    EIGHT_WEEKS: "Eight-week",
    FOUR_WEEKS: "Four-week",
    TWO_WEEKS: "Two-week",
    ONE_WEEK: "One-week",
  };
  return labels[code] ?? code
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./u, (value) => value.toUpperCase());
}

function lotValue(startLabel: string, endLabel: string) {
  if (!startLabel && !endLabel) return "Not specified";
  if (!endLabel || startLabel === endLabel) return startLabel || endLabel;
  return `${startLabel}–${endLabel}`;
}

function formatWorkDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The follow-up work date is invalid.");
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function lotLabel(snapshot: BuilderFollowUpEmailSnapshot) {
  if (!snapshot.lotStartLabel && !snapshot.lotEndLabel) {
    return "the scheduled lots";
  }
  if (
    !snapshot.lotEndLabel || snapshot.lotStartLabel === snapshot.lotEndLabel
  ) {
    return `Lot ${snapshot.lotStartLabel || snapshot.lotEndLabel}`;
  }
  return `Lots ${snapshot.lotStartLabel}–${snapshot.lotEndLabel}`;
}

function escalationLotLabel(snapshot: BuilderFollowUpEscalationSnapshot) {
  if (!snapshot.lotStartLabel && !snapshot.lotEndLabel) {
    return "Lots not specified";
  }
  if (
    !snapshot.lotEndLabel || snapshot.lotStartLabel === snapshot.lotEndLabel
  ) {
    return `Lot ${snapshot.lotStartLabel || snapshot.lotEndLabel}`;
  }
  return `Lots ${snapshot.lotStartLabel}–${snapshot.lotEndLabel}`;
}

const stageTypeLabels = {
  EXT: "Exterior Frames",
  SHUTTER: "Shutter",
  DM: "Doors and Moldings",
  HW: "Hardware",
} as const;

function stageTypeLabel(stageType: string) {
  return stageTypeLabels[stageType as keyof typeof stageTypeLabels] ??
    stageType;
}

export function renderBuilderFollowUpEmail(
  snapshot: BuilderFollowUpEmailSnapshot,
  responseLinks?: BuilderFollowUpResponseLinks,
): RenderedBuilderFollowUpEmail {
  const workDate = formatWorkDate(snapshot.workDate);
  const lots = lotLabel(snapshot);
  const location = snapshot.community.trim() || "Not specified";
  const stage = stageTypeLabel(snapshot.stageType);
  const subject =
    `Action requested: confirm ${stage} for ${snapshot.jobCode} on ${snapshot.workDate}`;
  const greeting = `Hello ${snapshot.recipientName},`;
  const request =
    `ValTrim is following up to confirm ${stage} work for ${snapshot.jobCode} (${location}), ${lots}, scheduled for ${workDate}.`;
  const response = responseLinks
    ? "Please select Confirmed, or select Not ready and choose the new Production date."
    : "Please reply to confirm the date, request a reschedule, or let us know about any readiness or scheduling conflict.";
  const reference = `Reference: ${
    checkpointLabel(snapshot.checkpointCode)
  } follow-up · ${snapshot.daysBefore} days before scheduled work.`;
  const responseText = responseLinks
    ? [
      "",
      `Confirmed: ${responseLinks.confirmed}`,
      `Not ready / choose a new date: ${responseLinks.notReady}`,
      "",
      "Opening a link does not record a response. Review the details and submit the response on the secure ValTrim page.",
    ]
    : [];
  const footer =
    "ValtrimBilling is the source of truth for this schedule. A submitted Not ready response immediately updates the official Production date to the date selected on the secure page.";
  const text = [
    greeting,
    "",
    request,
    "",
    response,
    ...responseText,
    "",
    reference,
    "",
    footer,
  ].join("\n");
  const responseSection = responseLinks
    ? `
      <p style="margin:0 0 16px;font-size:16px;font-weight:700;line-height:1.5;color:#172033;">
        Please select one of the following options:
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
        <tr>
          <td style="padding-bottom:12px;">
            <a href="${
      escapeHtml(responseLinks.confirmed)
    }" style="display:block;padding:14px 20px;background-color:#16803c;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;">
              Confirm scheduled date
            </a>
          </td>
        </tr>
        <tr>
          <td>
            <a href="${
      escapeHtml(responseLinks.notReady)
    }" style="display:block;padding:14px 20px;background-color:#b54708;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;">
              Not ready — choose a new date
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">
        Opening a button does not record your response. Review the details and submit your selection on the secure ValTrim page.
      </p>
    `
    : `
      <div style="margin:0 0 24px;padding:14px 16px;background-color:#eff6ff;border-left:4px solid #2563eb;border-radius:4px;">
        <p style="margin:0;font-size:14px;line-height:1.5;color:#1e3a8a;">
          ${escapeHtml(response)}
        </p>
      </div>
    `;
  const html = emailShell({
    preheader:
      `Please confirm ${stage} for ${snapshot.jobCode} on ${workDate}.`,
    content: `
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#2563eb;">
        Production confirmation requested
      </p>
      <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#172033;">
        Please review the scheduled work
      </h1>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#475569;">
        Hello <strong style="color:#172033;">${
      escapeHtml(snapshot.recipientName)
    }</strong>,
      </p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
        ValTrim is following up to confirm the
        <strong style="color:#172033;">${
      escapeHtml(stage)
    }</strong> work scheduled
        for Job <strong style="color:#172033;">${
      escapeHtml(snapshot.jobCode)
    }</strong>.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
        <tr>
          <td style="padding:20px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#1d4ed8;">
              Scheduled production date
            </p>
            <p style="margin:0;font-size:20px;font-weight:700;line-height:1.4;color:#1e3a8a;">
              ${escapeHtml(workDate)}
            </p>
          </td>
        </tr>
      </table>
      ${
      detailsTable([
        ["Job", snapshot.jobCode],
        ["Community", location],
        ["Lots", lotValue(snapshot.lotStartLabel, snapshot.lotEndLabel)],
        ["Work type", stage],
      ])
    }
      ${responseSection}
      <div style="margin:0 0 24px;padding:14px 16px;background-color:#fff8f0;border-left:4px solid #b54708;border-radius:4px;">
        <p style="margin:0;font-size:13px;line-height:1.5;color:#7c2d12;">
          If you submit <strong>Not ready</strong>, the official Production date will be updated immediately to the new date selected on the secure page.
        </p>
      </div>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;">
        <strong style="color:#475569;">Reference:</strong>
        ${
      escapeHtml(checkpointLabel(snapshot.checkpointCode))
    } follow-up · ${snapshot.daysBefore} days before scheduled work
      </p>
      <hr style="margin:24px 0;border:0;border-top:1px solid #d5dce7;" />
      <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
        ValtrimBilling is the source of truth for this Production schedule.
      </p>
    `,
  });

  return { subject, text, html };
}

export function renderBuilderFollowUpEscalationEmail(
  snapshot: BuilderFollowUpEscalationSnapshot,
): RenderedBuilderFollowUpEscalationEmail {
  const workDate = formatWorkDate(snapshot.workDate);
  const lots = escalationLotLabel(snapshot);
  const recipients = snapshot.recipientEmails.join(", ");
  const stage = stageTypeLabel(snapshot.stageType);
  const subject =
    `Needs attention: no response for ${stage} • ${snapshot.jobCode}`;
  const summary =
    `No response has been recorded from ${snapshot.superintendentName} (${snapshot.superintendentEmail}) after ${snapshot.waitBusinessDays} business days.`;
  const schedule =
    `${stage} for ${snapshot.jobCode} (${snapshot.community}), ${lots}, is scheduled for ${workDate}.`;
  const request =
    "Please review the Jobsite status and decide whether to contact the Superintendent again, reschedule, place the work on hold, or record a response in ValtrimBilling.";
  const reference =
    `Escalation ${snapshot.escalationId}; no response recorded ${snapshot.noResponseSince}; internal recipients: ${recipients}.`;
  const footer =
    "ValtrimBilling remains the source of truth. This alert does not change the Production date or confirmation status.";
  const text = [
    "ValTrim scheduling needs attention.",
    "",
    summary,
    schedule,
    "",
    request,
    "",
    reference,
    "",
    footer,
  ].join("\n");
  const html = emailShell({
    maxWidth: 680,
    preheader:
      `No response from ${snapshot.superintendentName} for ${stage} on ${snapshot.jobCode}.`,
    content: `
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#b42318;">
        Scheduling attention required
      </p>
      <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#172033;">
        No Jobsite response received
      </h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
        No response has been recorded from
        <strong style="color:#172033;">${
      escapeHtml(snapshot.superintendentName)
    }</strong>
        (<a href="mailto:${
      escapeHtml(snapshot.superintendentEmail)
    }" style="color:#2563eb;text-decoration:none;">${
      escapeHtml(snapshot.superintendentEmail)
    }</a>)
        after <strong style="color:#b42318;">${snapshot.waitBusinessDays} business days</strong>.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
        <tr>
          <td style="padding:20px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#b42318;">
              Scheduled production date
            </p>
            <p style="margin:0;font-size:20px;font-weight:700;line-height:1.4;color:#991b1b;">
              ${escapeHtml(workDate)}
            </p>
          </td>
        </tr>
      </table>
      ${
      detailsTable([
        ["Job", snapshot.jobCode],
        ["Community", snapshot.community.trim() || "Not specified"],
        ["Lots", lotValue(snapshot.lotStartLabel, snapshot.lotEndLabel)],
        ["Work type", stage],
      ])
    }
      <div style="margin:0 0 24px;padding:14px 16px;background-color:#fff8f0;border-left:4px solid #b54708;border-radius:4px;">
        <p style="margin:0;font-size:13px;line-height:1.5;color:#7c2d12;">
          <strong>Review required.</strong> Contact the Jobsite Superintendent again, reschedule, place the work on hold, or record the response in ValtrimBilling.
        </p>
      </div>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#64748b;">
        <strong style="color:#475569;">Reference:</strong>
        Escalation ${
      escapeHtml(snapshot.escalationId)
    } · No response recorded ${
      escapeHtml(snapshot.noResponseSince)
    } · Internal recipients: ${escapeHtml(recipients)}
      </p>
      <hr style="margin:24px 0;border:0;border-top:1px solid #d5dce7;" />
      <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
        ValtrimBilling remains the source of truth. This alert does not change the Production date or confirmation status.
      </p>
    `,
  });

  return { subject, text, html };
}

function responseLotLabel(snapshot: BuilderFollowUpResponseEmailSnapshot) {
  if (!snapshot.lotStartLabel && !snapshot.lotEndLabel) {
    return "Lots not specified";
  }
  if (
    !snapshot.lotEndLabel || snapshot.lotStartLabel === snapshot.lotEndLabel
  ) {
    return `Lot ${snapshot.lotStartLabel || snapshot.lotEndLabel}`;
  }
  return `Lots ${snapshot.lotStartLabel}–${snapshot.lotEndLabel}`;
}

export function renderBuilderFollowUpResponseEmail(
  snapshot: BuilderFollowUpResponseEmailSnapshot,
): RenderedBuilderFollowUpEmail {
  const originalDate = formatWorkDate(snapshot.targetWorkDate);
  const finalDate = formatWorkDate(snapshot.finalWorkDate);
  const lots = responseLotLabel(snapshot);
  const reason = snapshot.reason?.trim() || "No readiness note was provided.";
  const isRescheduled = snapshot.responseAction === "NOT_READY";
  const stage = stageTypeLabel(snapshot.stageType);

  if (snapshot.notificationType === "INTERNAL_ALERT") {
    const subject =
      `Schedule changed by Jobsite: ${stage} • ${snapshot.jobCode}`;
    const summary =
      `${snapshot.superintendentName} (${snapshot.superintendentEmail}) selected Not ready and moved the official ${stage} Production date for ${snapshot.jobCode}.`;
    const change =
      `${originalDate} → ${finalDate}; ${snapshot.community}; ${lots}.`;
    const text = [
      "ValTrim scheduling update.",
      "",
      summary,
      change,
      "",
      `Jobsite note: ${reason}`,
      "",
      "The change is already recorded in ValtrimBilling; no approval is required.",
    ].join("\n");
    const html = emailShell({
      maxWidth: 680,
      preheader:
        `${stage} for ${snapshot.jobCode} moved from ${originalDate} to ${finalDate}.`,
      content: `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#b54708;">
          Scheduling update
        </p>
        <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#172033;">
          Production date changed
        </h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
          <strong style="color:#172033;">${
        escapeHtml(snapshot.superintendentName)
      }</strong>
          (<a href="mailto:${
        escapeHtml(snapshot.superintendentEmail)
      }" style="color:#2563eb;text-decoration:none;">${
        escapeHtml(snapshot.superintendentEmail)
      }</a>)
          selected <strong style="color:#b54708;">Not ready</strong>. As a result, the official
          <strong>${escapeHtml(stage)} Production</strong> date for Job
          <strong>${
        escapeHtml(snapshot.jobCode)
      }</strong> was updated immediately.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#fff8f0;border:1px solid #fed7aa;border-radius:8px;">
          <tr>
            <td style="padding:20px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#9a3412;">
                Previous date
              </p>
              <p style="margin:0 0 16px;font-size:16px;color:#64748b;text-decoration:line-through;">
                ${escapeHtml(originalDate)}
              </p>
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#9a3412;">
                New official date
              </p>
              <p style="margin:0;font-size:20px;font-weight:700;color:#9a3412;">
                ${escapeHtml(finalDate)}
              </p>
            </td>
          </tr>
        </table>
        ${
        detailsTable([
          ["Community", snapshot.community.trim() || "Not specified"],
          ["Lots", lotValue(snapshot.lotStartLabel, snapshot.lotEndLabel)],
          ["Jobsite note", reason],
        ])
      }
        <div style="padding:14px 16px;background-color:#ecfdf3;border-left:4px solid #16a34a;border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#166534;">
            <strong>No approval is required.</strong> This change has already been recorded in ValtrimBilling.
          </p>
        </div>
      `,
    });
    return { subject, text, html };
  }

  const subject = isRescheduled
    ? `Updated: ${stage} for ${snapshot.jobCode} moved to ${snapshot.finalWorkDate}`
    : `Confirmed: ${stage} for ${snapshot.jobCode} on ${snapshot.finalWorkDate}`;
  const greeting = `Hello ${snapshot.superintendentName},`;
  const summary = isRescheduled
    ? `Your response was received. The official ${stage} Production date for ${snapshot.jobCode} (${snapshot.community}), ${lots}, was changed from ${originalDate} to ${finalDate}.`
    : `Your response was received. ${stage} work for ${snapshot.jobCode} (${snapshot.community}), ${lots}, is confirmed for ${finalDate}.`;
  const note = isRescheduled ? `Your readiness note: ${reason}` : null;
  const footer =
    "ValtrimBilling is the source of truth for this Production schedule. Please contact ValTrim scheduling if another change is needed.";
  const text = [
    greeting,
    "",
    summary,
    ...(note ? ["", note] : []),
    "",
    footer,
  ].join("\n");
  const html = emailShell({
    preheader: isRescheduled
      ? `Your new ${stage} Production date is ${finalDate}.`
      : `${stage} for ${snapshot.jobCode} is confirmed for ${finalDate}.`,
    content: isRescheduled
      ? `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#b54708;">
          Schedule updated
        </p>
        <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#172033;">
          Your new date was recorded
        </h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
          Hello <strong style="color:#172033;">${
        escapeHtml(snapshot.superintendentName)
      }</strong>,
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
          Your response was received. The official
          <strong style="color:#172033;">${
        escapeHtml(stage)
      }</strong> Production date for Job
          <strong style="color:#172033;">${
        escapeHtml(snapshot.jobCode)
      }</strong> was updated.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#fff8f0;border:1px solid #fed7aa;border-radius:8px;">
          <tr>
            <td style="padding:20px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#9a3412;">Previous date</p>
              <p style="margin:0 0 16px;font-size:16px;color:#64748b;text-decoration:line-through;">${
        escapeHtml(originalDate)
      }</p>
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#9a3412;">New official date</p>
              <p style="margin:0;font-size:20px;font-weight:700;color:#9a3412;">${
        escapeHtml(finalDate)
      }</p>
            </td>
          </tr>
        </table>
        ${
        detailsTable([
          ["Job", snapshot.jobCode],
          ["Community", snapshot.community.trim() || "Not specified"],
          ["Lots", lotValue(snapshot.lotStartLabel, snapshot.lotEndLabel)],
          ["Work type", stage],
        ])
      }
        <div style="margin:0 0 24px;padding:14px 16px;background-color:#fff8f0;border-left:4px solid #b54708;border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#7c2d12;">
            <strong>Your readiness note:</strong> ${escapeHtml(reason)}
          </p>
        </div>
        <div style="padding:14px 16px;background-color:#f8fafc;border-left:4px solid #64748b;border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#475569;">
            ValtrimBilling is the source of truth for this Production schedule. If another change is needed, please contact ValTrim Scheduling.
          </p>
        </div>
      `
      : `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#15803d;">
          Schedule confirmed
        </p>
        <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#172033;">
          Your response was received
        </h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
          Hello <strong style="color:#172033;">${
        escapeHtml(snapshot.superintendentName)
      }</strong>,
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569;">
          Thank you for confirming the production schedule. The
          <strong style="color:#172033;">${
        escapeHtml(stage)
      }</strong> work for Job
          <strong style="color:#172033;">${
        escapeHtml(snapshot.jobCode)
      }</strong> is confirmed.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#ecfdf3;border:1px solid #bbf7d0;border-radius:8px;">
          <tr>
            <td style="padding:20px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#166534;">
                Confirmed production date
              </p>
              <p style="margin:0;font-size:20px;font-weight:700;line-height:1.4;color:#166534;">
                ${escapeHtml(finalDate)}
              </p>
            </td>
          </tr>
        </table>
        ${
        detailsTable([
          ["Job", snapshot.jobCode],
          ["Community", snapshot.community.trim() || "Not specified"],
          ["Lots", lotValue(snapshot.lotStartLabel, snapshot.lotEndLabel)],
          ["Work type", stage],
        ])
      }
        <div style="padding:14px 16px;background-color:#f8fafc;border-left:4px solid #64748b;border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#475569;">
            ValtrimBilling is the source of truth for this Production schedule. If another change is needed, please contact ValTrim Scheduling.
          </p>
        </div>
      `,
  });
  return { subject, text, html };
}

async function sendWithResend(
  options: {
    apiKey: string;
    from: string;
    replyTo: string;
    idempotencyKey: string;
    recipients: string[];
    rendered:
      | RenderedBuilderFollowUpEmail
      | RenderedBuilderFollowUpEscalationEmail;
  },
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey,
    },
    body: JSON.stringify({
      from: options.from,
      to: options.recipients,
      reply_to: options.replyTo,
      subject: options.rendered.subject,
      text: options.rendered.text,
      html: options.rendered.html,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
    name?: string;
  };

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.message
        ? `Resend rejected the email: ${payload.message}`
        : `Resend rejected the email with status ${response.status}.`,
    );
  }

  return payload.id;
}

export async function sendBuilderFollowUpWithResend(
  options: ResendOptions,
  fetcher: typeof fetch = fetch,
) {
  return sendWithResend({
    apiKey: options.apiKey,
    from: options.from,
    replyTo: options.replyTo,
    idempotencyKey: options.snapshot.idempotencyKey,
    recipients: [options.snapshot.recipientEmail],
    rendered: options.rendered,
  }, fetcher);
}

export async function sendBuilderFollowUpEscalationWithResend(
  options: EscalationResendOptions,
  fetcher: typeof fetch = fetch,
) {
  return sendWithResend({
    apiKey: options.apiKey,
    from: options.from,
    replyTo: options.replyTo,
    idempotencyKey: options.snapshot.idempotencyKey,
    recipients: options.snapshot.recipientEmails,
    rendered: options.rendered,
  }, fetcher);
}

export async function sendBuilderFollowUpResponseWithResend(
  options: ResponseResendOptions,
  fetcher: typeof fetch = fetch,
) {
  return sendWithResend({
    apiKey: options.apiKey,
    from: options.from,
    replyTo: options.replyTo,
    idempotencyKey: options.snapshot.idempotencyKey,
    recipients: options.snapshot.recipientEmails,
    rendered: options.rendered,
  }, fetcher);
}
