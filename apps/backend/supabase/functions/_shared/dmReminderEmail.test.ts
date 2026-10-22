import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildDmReminderDraft,
  type DmReminderEvent,
  dmReminderSubject,
  formatEventDate,
  isIsoDate,
  nextDay,
  renderDmReminderEmail,
  reminderMode,
  resolveDelivery,
  testRecipients,
  todayInLosAngeles,
} from "./dmReminderEmail.ts";

const event = (overrides: Partial<DmReminderEvent> = {}): DmReminderEvent => ({
  scheduleId: "13",
  eventDate: "2026-10-23",
  jobId: "1",
  jobCode: "1319",
  community: "EL MONTE",
  builderName: "KB Home",
  phaseCode: "1",
  building: "2",
  lots: [
    {
      lotNumber: "2",
      planCode: "4B",
      reverse: true,
      options: [
        { code: "C-205", description: "Upgraded base" },
        { code: "C-101", description: "Crown <molding> & trim" },
      ],
    },
    { lotNumber: "10", planCode: "2A", reverse: false, options: [] },
  ],
  supervisor: { role: "Supervisor", name: "Hilario", email: "hilario@valtriminc.com" },
  projectManager: { role: "Project Manager", name: "Pat", email: "pat@valtriminc.com" },
  missingRoles: [],
  sentAt: null,
  ...overrides,
});

Deno.test("only TEST and LIVE change the mode: anything else is PREVIEW", () => {
  assertEquals(reminderMode(undefined), "PREVIEW");
  assertEquals(reminderMode(""), "PREVIEW");
  assertEquals(reminderMode("live"), "LIVE");
  assertEquals(reminderMode(" Test "), "TEST");
  assertEquals(reminderMode("LIVE!"), "PREVIEW");
  assertEquals(reminderMode("yes"), "PREVIEW");
});

Deno.test("the test addresses come from a list, without repeats or bad addresses", () => {
  assertEquals(testRecipients(undefined), []);
  assertEquals(
    testRecipients("Me@valtriminc.com, me@valtriminc.com; you@x.com nope"),
    ["me@valtriminc.com", "you@x.com"],
  );
});

Deno.test("dates: today in California, the next day and a readable date", () => {
  // 03:00 UTC on Oct 23 is still the evening of Oct 22 in California.
  assertEquals(todayInLosAngeles(new Date("2026-10-23T03:00:00Z")), "2026-10-22");
  assertEquals(todayInLosAngeles(new Date("2026-10-23T20:00:00Z")), "2026-10-23");
  assertEquals(nextDay("2026-10-22"), "2026-10-23");
  assertEquals(nextDay("2026-10-31"), "2026-11-01");
  assertEquals(nextDay("2026-12-31"), "2027-01-01");
  assertEquals(formatEventDate("2026-10-23"), "Fri, Oct 23, 2026");
  assert(isIsoDate("2026-10-23"));
  assert(!isIsoDate("2026-02-31"));
  assert(!isIsoDate("23/10/2026"));
  assert(!isIsoDate(undefined));
});

Deno.test("the subject names the day, the Job, the Phase and the lots", () => {
  assertEquals(
    dmReminderSubject(event()),
    "DM Fri, Oct 23, 2026 · Job #1319 · Phase 1 · Building 2 · 2 Lots",
  );
  assertEquals(
    dmReminderSubject(event({ building: ".", lots: [event().lots[0]] })),
    "DM Fri, Oct 23, 2026 · Job #1319 · Phase 1 · Lot 2",
  );
});

Deno.test("the draft is addressed to the Supervisor and the Project Manager that have an email", () => {
  assertEquals(
    buildDmReminderDraft(event()).recipients.map(({ email }) => email),
    ["hilario@valtriminc.com", "pat@valtriminc.com"],
  );
  assertEquals(
    buildDmReminderDraft(event({ projectManager: null })).recipients.map(({ role }) => role),
    ["Supervisor"],
  );
  assertEquals(buildDmReminderDraft(event({ supervisor: null, projectManager: null })).recipients, []);
});

Deno.test("who receives it depends on the mode, and PREVIEW sends nobody", () => {
  const chosen = ["hilario@valtriminc.com"];
  const test = ["me@valtriminc.com"];

  assertEquals(resolveDelivery("PREVIEW", chosen, test), { to: [], testNote: null });
  assertEquals(resolveDelivery("LIVE", chosen, test), { to: chosen, testNote: null });
  assertEquals(resolveDelivery("TEST", chosen, test), {
    to: test,
    testNote: { intended: chosen, sentTo: test },
  });
  // Test mode with no test addresses has nobody to send to, never the real ones.
  assertEquals(resolveDelivery("TEST", chosen, []).to, []);
});

Deno.test("the email lists each lot with its Plan, Reverse and options, and no prices", () => {
  const rendered = renderDmReminderEmail(event());

  assertEquals(rendered.subject, dmReminderSubject(event()));
  assertStringIncludes(rendered.html, "DM scheduled for Fri, Oct 23, 2026");
  assertStringIncludes(rendered.html, "KB Home");
  assertStringIncludes(rendered.html, "#1319");
  assertStringIncludes(rendered.html, "Phase 1 · Building 2");
  assertStringIncludes(rendered.html, "C-205 · Upgraded base");
  // What the Sequence Sheet says is escaped.
  assertStringIncludes(rendered.html, "C-101 · Crown &lt;molding&gt; &amp; trim");
  assertStringIncludes(rendered.html, "No options selected");
  assertStringIncludes(rendered.text, "Lot 2\tPlan 4B\tReverse: Yes\tC-205 · Upgraded base; C-101 · Crown <molding> & trim");
  assertStringIncludes(rendered.text, "Lot 10\tPlan 2A\tReverse: No\tNo options selected");
  assert(!/\$|price/iu.test(rendered.html));
  assert(!/\$|price/iu.test(rendered.text));
  assert(!rendered.html.includes("Test email"));
});

Deno.test("a test email says it is a test and who it would have gone to", () => {
  const rendered = renderDmReminderEmail(event(), {
    testNote: { intended: ["hilario@valtriminc.com", "pat@valtriminc.com"], sentTo: ["me@valtriminc.com"] },
  });

  assert(rendered.subject.startsWith("[TEST] DM "));
  assertStringIncludes(rendered.html, "Test email.");
  assertStringIncludes(rendered.html, "hilario@valtriminc.com, pat@valtriminc.com");
  assertStringIncludes(rendered.text, "TEST EMAIL. It would have gone to: hilario@valtriminc.com, pat@valtriminc.com.");
});
