export interface SequenceSheetEmailOption {
  code: string;
  description: string;
}

export interface SequenceSheetEmailLot {
  lotNumber: string;
  planCode: string;
  reverse: boolean;
  options: SequenceSheetEmailOption[];
}

export interface SequenceSheetEmailSnapshot {
  phaseId: string;
  sequenceSheetName: string;
  jobCode: string;
  community: string;
  builderName: string;
  phaseCode: string;
  building: string;
  defaultRecipientName: string;
  defaultRecipientEmail: string;
  lots: SequenceSheetEmailLot[];
}

export interface RenderedSequenceSheetEmail {
  subject: string;
  text: string;
  html: string;
}

interface SequenceSheetResendOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  idempotencyKey: string;
  recipients: string[];
  rendered: RenderedSequenceSheetEmail;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function phaseLabel(value: string) {
  const normalized = value.trim().replace(/^PHASE[\s#:\-.]*/iu, "").replace(/^P(?=[A-Z0-9])/iu, "");
  return `Phase ${normalized}`;
}

function buildingLabel(value: string) {
  const normalized = value.trim().replace(/^BUILDING[\s#:\-.]*/iu, "").replace(/^B(?=[A-Z0-9])/iu, "");
  return `Building ${normalized}`;
}

function optionLabel(option: SequenceSheetEmailOption) {
  const code = option.code.trim();
  const description = option.description.trim();
  if (code && description) return `${code} · ${description}`;
  return code || description || "Option unavailable";
}

function optionHtml(option: SequenceSheetEmailOption) {
  return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:4px 8px;border:1px solid #cbd5e1;border-radius:999px;background-color:#ffffff;color:#334155;font-size:12px;line-height:1.35;">${
    escapeHtml(optionLabel(option))
  }</span>`;
}

function lotRowHtml(lot: SequenceSheetEmailLot, index: number) {
  const options = lot.options.length > 0
    ? lot.options.map(optionHtml).join("")
    : '<span style="color:#64748b;font-size:13px;">No options selected</span>';
  const reverse = lot.reverse
    ? '<span style="display:inline-block;padding:4px 9px;border-radius:999px;background-color:#2563eb;color:#ffffff;font-size:12px;font-weight:700;">Yes</span>'
    : '<span style="display:inline-block;padding:4px 9px;border:1px solid #cbd5e1;border-radius:999px;background-color:#ffffff;color:#475569;font-size:12px;font-weight:700;">No</span>';

  return `
    <tr style="background-color:${index % 2 === 0 ? "#ffffff" : "#f8fafc"};">
      <td style="width:64px;padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:14px;font-weight:700;vertical-align:top;">${escapeHtml(lot.lotNumber)}</td>
      <td style="width:100px;padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:14px;vertical-align:top;">${escapeHtml(lot.planCode || "Plan unavailable")}</td>
      <td align="center" style="width:82px;padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">${reverse}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:14px;vertical-align:top;">${options}</td>
    </tr>`;
}

export function renderSequenceSheetEmail(
  snapshot: SequenceSheetEmailSnapshot,
): RenderedSequenceSheetEmail {
  const phase = phaseLabel(snapshot.phaseCode);
  const building = buildingLabel(snapshot.building);
  const title = snapshot.sequenceSheetName.trim() || "Sequence Sheet";
  const subject = `${title} · Job #${snapshot.jobCode} · ${phase}`;
  const rows = snapshot.lots.map(lotRowHtml).join("");
  const textRows = snapshot.lots.map((lot) => [
    lot.lotNumber,
    lot.planCode || "Plan unavailable",
    lot.reverse ? "Yes" : "No",
    lot.options.length > 0
      ? lot.options.map(optionLabel).join(", ")
      : "No options selected",
  ].join("\t"));
  const text = [
    title,
    `Builder: ${snapshot.builderName}`,
    `Community: ${snapshot.community}`,
    `Job: #${snapshot.jobCode}`,
    `Phase: ${phase}`,
    `Building: ${building}`,
    "",
    "Lot\tPlan\tReverse\tOptions for selected plan",
    ...textRows,
  ].join("\n");

  const html = `
    <div style="margin:0;padding:28px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:820px;margin:0 auto;border-collapse:separate;">
        <tr>
          <td style="padding:24px 26px;background-color:#2563eb;border-radius:10px 10px 0 0;">
            <p style="margin:0 0 5px;color:#dbeafe;font-size:12px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">ValtrimBilling</p>
            <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">${escapeHtml(title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 26px;background-color:#ffffff;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:0 18px 10px 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Builder</td>
                <td style="padding:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">${escapeHtml(snapshot.builderName)}</td>
                <td style="padding:0 18px 10px 28px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Community</td>
                <td style="padding:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">${escapeHtml(snapshot.community)}</td>
              </tr>
              <tr>
                <td style="padding:0 18px 0 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Job</td>
                <td style="padding:0;color:#1e293b;font-size:14px;font-weight:700;">#${escapeHtml(snapshot.jobCode)}</td>
                <td style="padding:0 18px 0 28px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Phase / Building</td>
                <td style="padding:0;color:#1e293b;font-size:14px;font-weight:700;">${escapeHtml(phase)} · ${escapeHtml(building)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 26px 26px;background-color:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
              <thead>
                <tr style="background-color:#f1f5f9;">
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Lot</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Plan</th>
                  <th align="center" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Reverse</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Options for selected plan</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </td>
        </tr>
      </table>
    </div>`;

  return { subject, text, html };
}

export async function sendSequenceSheetWithResend(
  options: SequenceSheetResendOptions,
  fetcher: typeof fetch = fetch,
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
