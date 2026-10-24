import { assertEquals, assertThrows } from "@std/assert";
import {
  decodePdfAttachment,
  defaultSubmissionSubject,
  MAX_ATTACHMENT_BYTES,
  parseRecipients,
  renderPackageSubmissionEmail,
  sendPackageSubmissionWithResend,
} from "./packageSubmissionEmail.ts";

const context = {
  packageNumber: "DP-00000004",
  jobCode: "1319",
  community: "El Monte",
  builderName: "G3 Urban Homes",
  netAmount: 53138.25,
};

const pdfBase64 = btoa("%PDF-1.4\n%test");

Deno.test("the default email names the Package, Job and amount", () => {
  const rendered = renderPackageSubmissionEmail(context);
  assertEquals(rendered.subject, "Draw Package DP-00000004 · Job #1319 · El Monte");
  assertEquals(rendered.text.includes("$53,138.25"), true);
  assertEquals(rendered.html.includes("DP-00000004"), true);
});

Deno.test("once the Package has an invoice, the email names the invoice by its number", () => {
  const rendered = renderPackageSubmissionEmail({ ...context, invoiceNumber: "15001" });
  assertEquals(rendered.subject, "Invoice 15001 · Job #1319 · El Monte");
  assertEquals(rendered.text.includes("attached Invoice 15001"), true);
  assertEquals(rendered.text.includes("DP-00000004"), false);
});

Deno.test("an edited subject and message replace the defaults and are escaped", () => {
  const rendered = renderPackageSubmissionEmail(context, " Custom ", "Hi <b>there</b>");
  assertEquals(rendered.subject, "Custom");
  assertEquals(rendered.html.includes("&lt;b&gt;"), true);
  assertThrows(() => renderPackageSubmissionEmail(context, "two\nlines"));
  assertEquals(defaultSubmissionSubject(context).length > 0, true);
});

Deno.test("the attachment must be a named PDF of a sane size", () => {
  assertEquals(decodePdfAttachment(pdfBase64, "DP-00000004.pdf").fileName, "DP-00000004.pdf");
  assertThrows(() => decodePdfAttachment(pdfBase64, "../secret.pdf"));
  assertThrows(() => decodePdfAttachment(pdfBase64, "notes.txt"));
  assertThrows(() => decodePdfAttachment(btoa("not a pdf at all"), "x.pdf"));
  assertThrows(() => decodePdfAttachment("", "x.pdf"));
  assertEquals(MAX_ATTACHMENT_BYTES, 15 * 1024 * 1024);
});

Deno.test("the PDF goes to Resend as an attachment with an idempotency key", async () => {
  let sent: { headers: HeadersInit | undefined; body: Record<string, unknown> } | null = null;
  const id = await sendPackageSubmissionWithResend({
    apiKey: "key",
    from: "billing@example.com",
    replyTo: "reply@example.com",
    idempotencyKey: "package-4-abc",
    recipients: ["ap@builder.com"],
    rendered: renderPackageSubmissionEmail(context),
    attachment: { fileName: "DP-00000004.pdf", base64: pdfBase64 },
  }, (_url, init) => {
    sent = { headers: init?.headers, body: JSON.parse(String(init?.body)) };
    return Promise.resolve(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
  });

  assertEquals(id, "msg_1");
  assertEquals((sent!.body.attachments as { filename: string }[])[0].filename, "DP-00000004.pdf");
  assertEquals(sent!.body.to, ["ap@builder.com"]);
});

Deno.test("recipients are cleaned, limited and checked", () => {
  assertEquals(
    parseRecipients([" AP@Builder.com ", "ap@builder.com", "cc@builder.com"]),
    ["ap@builder.com", "cc@builder.com"],
  );
  assertThrows(() => parseRecipients([]));
  assertThrows(() => parseRecipients(["not-an-email"]));
  assertThrows(() => parseRecipients("ap@builder.com"));
  assertThrows(() =>
    parseRecipients(Array.from({ length: 11 }, (_, index) => `a${index}@builder.com`))
  );
});

Deno.test("a Price Adjustment without an invoice number is named as one, and by invoice once it has it", () => {
  const adjustment = { ...context, packageNumber: "PA-00000301", packageType: "PRICE_ADJUSTMENT" };

  assertEquals(
    defaultSubmissionSubject(adjustment),
    "Price Adjustment PA-00000301 · Job #1319 · El Monte",
  );
  assertEquals(
    defaultSubmissionSubject({ ...adjustment, invoiceNumber: "15042" }),
    "Invoice 15042 · Job #1319 · El Monte",
  );
  // A Draw Package, and a record with no type, keep the original wording.
  assertEquals(defaultSubmissionSubject({ ...context, packageType: "DRAW" }).startsWith("Draw Package"), true);
  assertEquals(defaultSubmissionSubject(context).startsWith("Draw Package"), true);
});
