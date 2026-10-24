import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import {
  buildSequenceSheetEmailDrafts,
  FIRST_RELEASE_FINISHES_SUBJECT,
  FIRST_RELEASE_SUBJECT,
  type SequenceSheetEmailRecipient,
  type SequenceSheetEmailSnapshot,
  renderSequenceSheetEmail,
  sendSequenceSheetWithResend,
} from "./sequenceSheetEmail.ts";

const coordinator: SequenceSheetEmailRecipient = {
  role: "Job Coordinator",
  name: "Jo",
  email: "jo@example.com",
};
const optionsCoordinator: SequenceSheetEmailRecipient = {
  role: "Options Coordinator",
  name: "Op",
  email: "options@example.com",
};
const purchasing: SequenceSheetEmailRecipient = {
  role: "Purchasing",
  name: "Pu",
  email: "purchasing@example.com",
};

const supervisor: SequenceSheetEmailRecipient = {
  role: "Supervisor",
  name: "Su",
  email: "supervisor@example.com",
};

const snapshot: SequenceSheetEmailSnapshot = {
  phaseId: "501",
  jobCode: "1307",
  community: "River <Walk>",
  builderName: "Acme & Sons",
  phaseCode: "2",
  building: "15",
  defaultRecipientName: "Jamie Superintendent",
  defaultRecipientEmail: "jamie@example.com",
  isFirstRelease: false,
  jobCoordinator: coordinator,
  optionsCoordinator: optionsCoordinator,
  purchasing: purchasing,
  supervisor: supervisor,
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
    "Sequence Sheet · Job #1307 · Phase 2",
  );
  assertNotMatch(rendered.html, /Options Sequence Sheet/u);
  assertNotMatch(rendered.text, /Options Sequence Sheet/u);
  assertMatch(rendered.html, />Sequence Sheet</u);
  assertMatch(rendered.html, />Lot \/ Utility</u);
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

Deno.test("the first Sequence Sheet of a Job produces two emails", () => {
  const drafts = buildSequenceSheetEmailDrafts(
    { ...snapshot, isFirstRelease: true },
    "Sequence Sheet · Job #1307 · Phase 2",
  );

  assertEquals(drafts.length, 2);
  assertEquals(drafts[0].subject, FIRST_RELEASE_SUBJECT);
  assertEquals(
    drafts[0].subject,
    "First Release of Project - Check Model Deco Plans & Options & Cased openings",
  );
  assertEquals(drafts[0].recipients, [coordinator, optionsCoordinator, supervisor]);
  assertEquals(drafts[1].subject, FIRST_RELEASE_FINISHES_SUBJECT);
  assertEquals(
    drafts[1].subject,
    'Drywall Size 1/2" or 5/8", 1 - Coat Stucco or 3-Coat Stucco',
  );
  assertEquals(drafts[1].recipients, [coordinator]);
});

Deno.test("later Sequence Sheets go to the Job Coordinator, Purchasing and Supervisor", () => {
  const drafts = buildSequenceSheetEmailDrafts(
    snapshot,
    "Sequence Sheet · Job #1307 · Phase 2",
  );

  assertEquals(drafts.length, 1);
  assertEquals(drafts[0].subject, "Sequence Sheet · Job #1307 · Phase 2");
  assertEquals(drafts[0].recipients, [coordinator, purchasing, supervisor]);
});

Deno.test("a contact without an email is left out of the recipients", () => {
  const drafts = buildSequenceSheetEmailDrafts(
    { ...snapshot, isFirstRelease: true, optionsCoordinator: null },
    "unused",
  );

  assertEquals(drafts[0].recipients, [coordinator, supervisor]);
});

Deno.test("every email still goes out when the Supervisor has no email", () => {
  const drafts = buildSequenceSheetEmailDrafts(
    { ...snapshot, supervisor: null },
    "unused",
  );

  assertEquals(drafts[0].recipients, [coordinator, purchasing]);
});

Deno.test("renders ordinary Lots and Utility Building rows in the same Phase", () => {
  const rendered = renderSequenceSheetEmail({
    ...snapshot,
    lots: [
      snapshot.lots[0],
      {
        lotNumber: "Clubhouse",
        planCode: "CLUB",
        reverse: false,
        options: [],
        isUtilityBuilding: true,
      },
    ],
  });

  assertMatch(rendered.html, />Lot \/ Utility</u);
  assertMatch(rendered.html, />9</u);
  assertMatch(rendered.html, /Clubhouse/u);
  assertMatch(rendered.html, />Plan</u);
  assertMatch(rendered.html, /CLUB/u);
  assertMatch(rendered.html, /Plan only/u);
  assertMatch(rendered.text, /Lot \/ Utility\tPlan/u);
  assertMatch(rendered.text, /Clubhouse\tCLUB/u);
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

Deno.test("a Phase without a Building has no Building line in the email", () => {
  const rendered = renderSequenceSheetEmail({ ...snapshot, building: "" });

  assertNotMatch(rendered.text, /Building:/u);
  assertNotMatch(rendered.html, /Phase \/ Building/u);
  assertNotMatch(rendered.html, /Phase 2 · </u);
  assertMatch(rendered.text, /Phase: Phase 2/u);
  assertMatch(rendered.html, />Phase 2</u);

  const withBuilding = renderSequenceSheetEmail(snapshot);
  assertMatch(withBuilding.text, /Building: Building 15/u);
  assertMatch(withBuilding.html, /Phase \/ Building/u);
});
