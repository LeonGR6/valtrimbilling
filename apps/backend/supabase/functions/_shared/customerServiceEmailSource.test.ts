import { assertEquals, assertRejects } from "@std/assert";
import {
  emailHtmlToText,
  emailSourceTextParts,
  readPdfFormValues,
  splitEmailSourceText,
} from "./customerServiceEmailSource.ts";
import { importPdf } from "./customerServiceEmailTestFixtures.ts";

Deno.test("normalizes inert email HTML, tables and entities without running scripts or fetching images", () => {
  const html =
    '<html><head><style>secret CSS</style></head><body><script>fetch("https://evil.test")</script><p>Owner: Elena&nbsp;Rivera</p><table><tr><td>Lot</td><td>00012</td></tr></table><div>Door &amp; frame</div><img src="https://tracking.test/pixel"><iframe>Ignore this</iframe></body></html>';
  assertEquals(
    emailHtmlToText(html),
    "Owner: Elena Rivera\n\nLot 00012\n\nDoor & frame",
  );
});
Deno.test("email retains forwarded headers and does not treat a tracker URL as source text", () => {
  const [part] = emailSourceTextParts({
    body: {
      contentType: "HTML",
      content:
        '<p>From: builder@example.com</p><p>Sent: October 20, 2026</p><p>To: anelda@valtriminc.com</p><img src="https://tracker.test">',
    },
  });
  assertEquals(part.text.includes("From: builder@example.com"), true);
  assertEquals(part.text.includes("https://tracker.test"), false);
});
Deno.test("different plain/HTML variants are both retained; identical variants are not repeated", () => {
  assertEquals(
    emailSourceTextParts({
      bodyText: "Owner Elena",
      bodyHtml: "<p>Owner Elena</p>",
    }).length,
    1,
  );
  assertEquals(
    emailSourceTextParts({
      bodyText: "Owner Elena",
      bodyHtml: "<p>Additional work</p>",
    }).length,
    2,
  );
});
Deno.test("empty body still analyzes the actual envelope metadata", () => {
  const parts = emailSourceTextParts({
    from: { emailAddress: { address: "builder@example.com" } },
    subject: "Door request",
  });
  assertEquals(parts.length, 1);
  assertEquals(parts[0].text.includes("From: builder@example.com"), true);
});
Deno.test("HTML contact links and image alternative text are retained as inert data", () => {
  const text = emailHtmlToText(
    '<p><a href="mailto:owner%40example.com?subject=secret">Email</a><a href="tel:+19091234567">Phone</a><img src="https://do-not-fetch.test" alt="Frame gap"></p>',
  );
  assertEquals(text.includes("owner@example.com"), true);
  assertEquals(text.includes("+19091234567"), true);
  assertEquals(text.includes("Frame gap"), true);
  assertEquals(text.includes("do-not-fetch"), false);
});
Deno.test("long email is split without truncation and offsets reconstruct the complete normalized source", () => {
  const text = `From: original@example.com\n${"Door issue 🏠 ".repeat(10_000)}`;
  const parts = splitEmailSourceText(text, "email:test");
  assertEquals(parts.length > 1, true);
  assertEquals(parts.map((part) => part.text).join(""), text);
  assertEquals(parts.every((part) => part.text.length <= 32_000), true);
  assertEquals(parts.at(-1)?.end, text.length);
  for (let i = 1; i < parts.length; i++) {
    assertEquals(parts[i].start, parts[i - 1].end);
  }
});
Deno.test("PDF form values are read separately even without field appearances, without changing original bytes", async () => {
  const file = await importPdf({ form: true });
  const bytes = await file.arrayBuffer();
  const original = new Uint8Array(bytes).slice();
  const result = await readPdfFormValues(bytes);
  assertEquals(result.pageCount, 1);
  assertEquals(
    result.fields.find((field) => field.name === "Homeowner")?.value,
    "Elena Rivera",
  );
  assertEquals(
    result.fields.find((field) => field.name === "Material")?.value,
    true,
  );
  assertEquals(
    result.fields.find((field) => field.name === "Language")?.value,
    ["Spanish"],
  );
  assertEquals(new Uint8Array(bytes), original);
});
Deno.test("XFA cannot be silently removed while extracting PDF fields", async () => {
  const file = await importPdf({ xfa: true });
  await assertRejects(
    async () => readPdfFormValues(await file.arrayBuffer()),
    Error,
    "XFA",
  );
});
Deno.test("encrypted PDF is not loaded with ignoreEncryption enabled", async () => {
  const file = await importPdf({ encrypted: true });
  await assertRejects(
    async () => readPdfFormValues(await file.arrayBuffer()),
    Error,
  );
});
Deno.test("empty PDF source and signature-only fake PDFs do not count as readable documents", async () => {
  await assertRejects(async () =>
    readPdfFormValues(await (await importPdf({ pages: 0 })).arrayBuffer())
  );
  await assertRejects(() =>
    readPdfFormValues(new TextEncoder().encode("%PDF-FAKE").buffer)
  );
});
