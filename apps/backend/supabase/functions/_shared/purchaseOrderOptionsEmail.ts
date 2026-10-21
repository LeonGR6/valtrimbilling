// The email that tells Purchasing and the Job Coordinator which options a Purchase
// Order added to the Sequence Sheet. Pure: the Edge Function loads the data with the
// signed-in user's permissions and passes it in, so nothing here touches the network.
//
// The message is HTML with a plain-text twin, has no attachment and no link back to
// the application, like the Sequence Sheet email. Sending it goes through the same
// Resend helper (sendSequenceSheetWithResend), which only needs a rendered message.

export interface OptionsEmailRecipient {
  role: string;
  name: string;
  email: string;
}

export interface OptionsEmailOption {
  code: string;
  // What the Sequence Sheet shows: the option's description, else its name.
  description: string;
  price: number | null;
  priceNotApplicable: boolean;
  // The Purchase Order that printed it, e.g. "Work order 0813MDLH27-13325-19".
  source: string;
  // The option was created in the Plan by this import, not only selected for the Lot.
  createdInPlan: boolean;
}

export interface OptionsEmailLot {
  lotNumber: string;
  // "Phase MODELS", with the building when it has one.
  scope: string;
  planCode: string;
  options: OptionsEmailOption[];
}

export interface OptionsEmailSnapshot {
  jobCode: string;
  community: string;
  builderName: string;
  // Who added them (the signed-in user), and when.
  addedBy: string;
  addedOn: string;
  purchasing: OptionsEmailRecipient | null;
  jobCoordinator: OptionsEmailRecipient | null;
  // The roles that should receive it but have no email on file.
  missingRoles: string[];
  lots: OptionsEmailLot[];
}

export interface OptionsEmailDraft {
  key: string;
  label: string;
  subject: string;
  recipients: OptionsEmailRecipient[];
}

export interface RenderedOptionsEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function priceLabel(
  option: Pick<OptionsEmailOption, "price" | "priceNotApplicable">,
) {
  if (option.priceNotApplicable) return "NA";
  return option.price === null ? "—" : money.format(option.price);
}

function optionCount(snapshot: OptionsEmailSnapshot) {
  return snapshot.lots.reduce((total, lot) => total + lot.options.length, 0);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Lot 27", or "3 Lots" when the options went to several. */
function lotsLabel(snapshot: OptionsEmailSnapshot) {
  return snapshot.lots.length === 1
    ? `Lot ${snapshot.lots[0].lotNumber}`
    : plural(snapshot.lots.length, "Lot", "Lots");
}

export function optionsEmailSubject(snapshot: OptionsEmailSnapshot) {
  return `Options added to the Sequence Sheet · Job #${snapshot.jobCode} · ${
    lotsLabel(snapshot)
  }`;
}

function present(...recipients: (OptionsEmailRecipient | null)[]) {
  return recipients.filter(
    (recipient): recipient is OptionsEmailRecipient =>
      Boolean(recipient?.email),
  );
}

/** The email to review: Purchasing and the Job Coordinator, both only defaults. */
export function buildOptionsEmailDraft(
  snapshot: OptionsEmailSnapshot,
): OptionsEmailDraft {
  return {
    key: "purchase-order-options",
    label: "Options added from a Purchase Order",
    subject: optionsEmailSubject(snapshot),
    recipients: present(snapshot.purchasing, snapshot.jobCoordinator),
  };
}

const CELL =
  "padding:12px 14px;color:#1e293b;font-size:14px;vertical-align:top;";

// One table row per option, so each price sits next to its own option. The Lot and
// its Plan are written on the first row of the Lot only.
function lotRowsHtml(lot: OptionsEmailLot, index: number) {
  const background = index % 2 === 0 ? "#ffffff" : "#f8fafc";
  return lot.options.map((option, optionIndex) => {
    const last = optionIndex === lot.options.length - 1;
    const border = last ? "border-bottom:1px solid #e2e8f0;" : "";
    const first = optionIndex === 0;
    return `
    <tr style="background-color:${background};">
      <td style="width:150px;${CELL}${border}">${
      first
        ? `<div style="font-weight:700;">Lot ${
          escapeHtml(lot.lotNumber)
        }</div><div style="color:#64748b;font-size:12px;">${
          escapeHtml(lot.scope)
        }</div>`
        : ""
    }</td>
      <td style="width:90px;${CELL}${border}">${
      first ? escapeHtml(lot.planCode || "Plan unavailable") : ""
    }</td>
      <td style="${CELL}${border}">
        <span style="font-weight:700;">${escapeHtml(option.code)}</span>
        <span style="color:#334155;"> · ${escapeHtml(option.description)}</span>
        ${
      option.createdInPlan
        ? '<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background-color:#dcfce7;color:#166534;font-size:11px;font-weight:700;">New option</span>'
        : ""
    }
        <div style="color:#64748b;font-size:12px;">${
      escapeHtml(option.source)
    }</div>
      </td>
      <td align="right" style="width:110px;${CELL}${border}font-weight:700;white-space:nowrap;">${
      escapeHtml(priceLabel(option))
    }</td>
    </tr>`;
  }).join("");
}

export function renderOptionsEmail(
  snapshot: OptionsEmailSnapshot,
): RenderedOptionsEmail {
  const subject = optionsEmailSubject(snapshot);
  const total = optionCount(snapshot);
  const title = "Options added to the Sequence Sheet";
  const intro = `${
    plural(total, "option was", "options were")
  } printed in the Purchase Order of this Job and ${
    total === 1 ? "was" : "were"
  } not in the Sequence Sheet. ${
    total === 1 ? "It has" : "They have"
  } been added.`;

  const textRows = snapshot.lots.flatMap((lot) =>
    lot.options.map((option) =>
      [
        `Lot ${lot.lotNumber}`,
        lot.scope,
        `Plan ${lot.planCode || "unavailable"}`,
        `${option.code} · ${option.description}`,
        priceLabel(option),
        option.source,
      ].join("\t")
    )
  );
  const text = [
    title,
    `Builder: ${snapshot.builderName}`,
    `Community: ${snapshot.community}`,
    `Job: #${snapshot.jobCode}`,
    "",
    intro,
    "",
    "Lot\tScope\tPlan\tOption\tPrice\tPurchase Order",
    ...textRows,
    "",
    `Added by ${snapshot.addedBy} on ${snapshot.addedOn}.`,
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
                <td style="padding:0 18px 10px 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Builder</td>
                <td style="padding:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">${
    escapeHtml(snapshot.builderName)
  }</td>
                <td style="padding:0 18px 10px 28px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Community</td>
                <td style="padding:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">${
    escapeHtml(snapshot.community)
  }</td>
              </tr>
              <tr>
                <td style="padding:0 18px 0 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.4px;">Job</td>
                <td style="padding:0;color:#1e293b;font-size:14px;font-weight:700;">#${
    escapeHtml(snapshot.jobCode)
  }</td>
                <td></td>
                <td></td>
              </tr>
            </table>
            <p style="margin:18px 0 6px;color:#334155;font-size:14px;line-height:1.5;">${
    escapeHtml(intro)
  }</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 26px 20px;background-color:#ffffff;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;overflow:hidden;">
              <thead>
                <tr style="background-color:#f1f5f9;">
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Lot</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Plan</th>
                  <th align="left" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Options added</th>
                  <th align="right" style="padding:11px 14px;border-bottom:1px solid #cbd5e1;color:#475569;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.35px;">Price</th>
                </tr>
              </thead>
              <tbody>${
    snapshot.lots.map((lot, index) => lotRowsHtml(lot, index)).join("")
  }</tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 26px 22px;background-color:#ffffff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;">
            <p style="margin:0;color:#64748b;font-size:12px;">Added by ${
    escapeHtml(snapshot.addedBy)
  } on ${escapeHtml(snapshot.addedOn)}.</p>
          </td>
        </tr>
      </table>
    </div>`;

  return { subject, text, html };
}

// --- From loaded rows to the snapshot ------------------------------------------------

export interface OptionsEmailContact {
  name: string;
  email: string;
}

// One option selected for a Lot, as the Edge Function loads it.
export interface OptionsEmailAddition {
  lotId: string;
  lotNumber: string;
  phaseCode: string;
  building: string;
  planCode: string;
  optionCode: string;
  optionName: string;
  optionDescription: string;
  price: number | null;
  priceNotApplicable: boolean;
  workOrderNo: string | null;
  referenceNo: string | null;
  createdInPlan: boolean;
}

export interface OptionsEmailSource {
  jobCode: string;
  community: string;
  builderName: string;
  addedBy: string;
  addedOn: string;
  // Null when the Job has nobody in that role; an empty email means no email on file.
  purchasing: OptionsEmailContact | null;
  jobCoordinator: OptionsEmailContact | null;
  additions: OptionsEmailAddition[];
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

function recipientFor(role: string, contact: OptionsEmailContact | null) {
  const email = contact?.email.trim().toLowerCase() ?? "";
  return contact && email
    ? { role, name: contact.name, email } satisfies OptionsEmailRecipient
    : null;
}

/** Groups the additions by Lot and decides who should get the email. */
export function buildOptionsEmailSnapshot(
  source: OptionsEmailSource,
): OptionsEmailSnapshot {
  const lots = new Map<string, OptionsEmailLot>();
  for (const addition of source.additions) {
    const lot = lots.get(addition.lotId) ?? {
      lotNumber: addition.lotNumber,
      scope: [phaseLabel(addition.phaseCode), buildingLabel(addition.building)]
        .filter(Boolean)
        .join(" · "),
      planCode: addition.planCode,
      options: [],
    };
    lot.options.push({
      code: addition.optionCode,
      description: addition.optionDescription.trim() ||
        addition.optionName.trim() ||
        "Option unavailable",
      price: addition.price,
      priceNotApplicable: addition.priceNotApplicable,
      source: addition.workOrderNo
        ? `Purchase Order · work order ${addition.workOrderNo}${
          addition.referenceNo ? ` · ref ${addition.referenceNo}` : ""
        }`
        : "Purchase Order",
      createdInPlan: addition.createdInPlan,
    });
    lots.set(addition.lotId, lot);
  }

  const purchasing = recipientFor("Purchasing", source.purchasing);
  const jobCoordinator = recipientFor("Job Coordinator", source.jobCoordinator);

  return {
    jobCode: source.jobCode,
    community: source.community,
    builderName: source.builderName,
    addedBy: source.addedBy,
    addedOn: source.addedOn,
    purchasing,
    jobCoordinator,
    missingRoles: [
      ...(purchasing ? [] : ["Purchasing"]),
      ...(jobCoordinator ? [] : ["Job Coordinator"]),
    ],
    lots: [...lots.values()]
      .map((lot) => ({
        ...lot,
        options: [...lot.options].sort((a, b) => a.code.localeCompare(b.code)),
      }))
      .sort((a, b) =>
        a.lotNumber.localeCompare(b.lotNumber, "en", { numeric: true })
      ),
  };
}
