// The email that sends a Draw Package PDF to a Builder whose setup says
// "submit by email". The PDF is attached; the recipient is always the address
// saved in the Builder's setup, never one typed in the request.

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_RECIPIENTS = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** The recipients as a clean list: trimmed, lowercase, no repeats, each a valid address. */
export function parseRecipients(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Enter at least one recipient email address.");

  const recipients = [...new Set(value.map((email) => String(email).trim().toLowerCase()))];
  if (recipients.length === 0 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    throw new Error("Enter valid recipient email addresses separated by commas.");
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`A Package email can have up to ${MAX_RECIPIENTS} recipients.`);
  }
  return recipients;
}

export interface PackageSubmissionContext {
  packageNumber: string;
  /** The serial invoice number (15001...), once the Package has an invoice. */
  invoiceNumber?: string | null;
  jobCode: string;
  community: string;
  builderName: string;
  /** The invoice net amount, when the Package has one. */
  netAmount: number | null;
}

export interface RenderedPackageSubmissionEmail {
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

// What the email calls the document: the invoice by its number, or the Package
// by its own number while it has no invoice yet.
function documentName(context: PackageSubmissionContext) {
  return context.invoiceNumber
    ? `Invoice ${context.invoiceNumber}`
    : `Draw Package ${context.packageNumber}`;
}

export function defaultSubmissionSubject(context: PackageSubmissionContext) {
  return `${documentName(context)} · Job #${context.jobCode} · ${context.community}`.trim();
}

export function defaultSubmissionMessage(context: PackageSubmissionContext) {
  const amount = context.netAmount == null
    ? ""
    : `\nInvoice amount: ${
      context.netAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    }`;
  return `Hello,\n\nPlease find attached ${documentName(context)} for ${context.community} ` +
    `(Job #${context.jobCode}).${amount}\n\nThank you.`;
}

/** The subject and message may be edited by the person; only their shape is checked. */
export function submissionSubject(value: unknown, fallback: string) {
  if (value == null || String(value).trim() === "") return fallback;
  const subject = String(value).trim();
  if (/[\r\n]/u.test(subject)) throw new Error("The subject must be a single line.");
  if (subject.length > 200) throw new Error("Use 200 characters or fewer in the subject.");
  return subject;
}

export function submissionMessage(value: unknown, fallback: string) {
  if (value == null || String(value).trim() === "") return fallback;
  const message = String(value).trim();
  if (message.length > 3000) throw new Error("Use 3000 characters or fewer in the message.");
  return message;
}

export function renderPackageSubmissionEmail(
  context: PackageSubmissionContext,
  subjectText?: unknown,
  messageText?: unknown,
): RenderedPackageSubmissionEmail {
  const subject = submissionSubject(subjectText, defaultSubmissionSubject(context));
  const message = submissionMessage(messageText, defaultSubmissionMessage(context));
  const paragraphs = message
    .split(/\n{2,}/u)
    .map((paragraph) =>
      `<p style="margin:0 0 14px;color:#1e293b;font-size:14px;line-height:1.55;">${
        escapeHtml(paragraph).replaceAll("\n", "<br>")
      }</p>`
    )
    .join("");

  return {
    subject,
    text: message,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;">${paragraphs}</div>`,
  };
}

/** The PDF sent by the browser as base64, checked and measured. */
export function decodePdfAttachment(value: unknown, fileName: unknown) {
  const name = String(fileName ?? "").trim();
  if (!/^[^/\\\r\n]{1,180}\.pdf$/iu.test(name)) {
    throw new Error("Use a PDF file name without folders.");
  }

  const base64 = String(value ?? "").trim();
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
    throw new Error("The Package PDF could not be read. Generate it again.");
  }

  const size = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (size < 1 || size > MAX_ATTACHMENT_BYTES) {
    throw new Error("The Package PDF must be 15 MB or smaller to be emailed.");
  }
  if (atob(base64.slice(0, 8)).slice(0, 5) !== "%PDF-") {
    throw new Error("The attachment is not a PDF.");
  }

  return { fileName: name, base64, size };
}

interface SubmissionResendOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  idempotencyKey: string;
  recipients: string[];
  rendered: RenderedPackageSubmissionEmail;
  attachment: { fileName: string; base64: string };
}

export async function sendPackageSubmissionWithResend(
  options: SubmissionResendOptions,
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
      attachments: [{
        filename: options.attachment.fileName,
        content: options.attachment.base64,
      }],
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
