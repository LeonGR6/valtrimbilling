import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import {
  type SequenceSheetEmailSnapshot,
  renderSequenceSheetEmail,
  sendSequenceSheetWithResend,
} from "./sequenceSheetEmail.ts";

const snapshot: SequenceSheetEmailSnapshot = {
  phaseId: "501",
  sequenceSheetName: "Options Sequence Sheet",
  jobCode: "1307",
  community: "River <Walk>",
  builderName: "Acme & Sons",
  phaseCode: "2",
  building: "15",
  defaultRecipientName: "Jamie Superintendent",
  defaultRecipientEmail: "jamie@example.com",
  lots: [
    {
      lotNumber: "9",
      planCode: "2A",
      reverse: false,
      options: [],
    },
    {
      lotNumber: "10",
      planCode: "2B",
      reverse: true,
      options: [
        { code: "OPT-1", description: "Flex <Room>" },
        { code: "OPT-2", description: "Patio" },
      ],
    },
  ],
};

Deno.test("renders the Sequence Sheet as the four requested HTML columns", () => {
  const rendered = renderSequenceSheetEmail(snapshot);

  assertEquals(
    rendered.subject,
    "Options Sequence Sheet · Job #1307 · Phase 2",
  );
  assertMatch(rendered.html, />Lot</u);
  assertMatch(rendered.html, />Plan</u);
  assertMatch(rendered.html, />Reverse</u);
  assertMatch(rendered.html, />Options for selected plan</u);
  assertMatch(rendered.html, /Acme &amp; Sons/u);
  assertMatch(rendered.html, /River &lt;Walk&gt;/u);
  assertMatch(rendered.html, /Flex &lt;Room&gt;/u);
  assertMatch(rendered.html, /No options selected/u);
  assertNotMatch(rendered.html, /<a\s/iu);
  assertNotMatch(rendered.html, /\.pdf/iu);
});

Deno.test("sends only the HTML table email without attachments", async () => {
  const requests: Request[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Promise.resolve(Response.json({ id: "sequence-sheet-email-id" }));
  }) as typeof fetch;
  const rendered = renderSequenceSheetEmail(snapshot);

  const providerId = await sendSequenceSheetWithResend({
    apiKey: "test-key",
    from: "ValTrim <billing@example.com>",
    replyTo: "billing@example.com",
    idempotencyKey: "sequence-sheet-501-request-1",
    recipients: ["jamie@example.com"],
    rendered,
  }, fetcher);

  assertEquals(providerId, "sequence-sheet-email-id");
  assertEquals(requests.length, 1);
  assertEquals(
    requests[0].headers.get("Idempotency-Key"),
    "sequence-sheet-501-request-1",
  );
  const body = await requests[0].json();
  assertEquals(body.to, ["jamie@example.com"]);
  assertEquals(body.attachments, undefined);
  assertEquals(body.html, rendered.html);
});
