import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildChangeOrderEmailDraft,
  buildChangeOrderEmailSnapshot,
  changeOrderEmailSubject,
  changeOrderEmailTitle,
  type ChangeOrderEmailLine,
  type ChangeOrderEmailSource,
  formatEmailDate,
  renderChangeOrderEmail,
} from "./changeOrderEventEmail.ts";

const line = (
  over: Partial<ChangeOrderEmailLine> = {},
): ChangeOrderEmailLine => ({
  lotNumber: "7",
  planCode: "A",
  phaseCode: "2",
  building: "2",
  scopeOfWork: "Change passage locks to electronic locks",
  event: "EXT",
  eventDate: "2026-11-20",
  ...over,
});

const source = (
  over: Partial<ChangeOrderEmailSource> = {},
): ChangeOrderEmailSource => ({
  number: "CO-0005",
  internalNumber: "E-2026-0047",
  status: "PENDING",
  requestedBy: "Carlos Ramirez",
  jobCode: "1295",
  community: "Indigo",
  builderName: "The Olson Company",
  sentBy: "Andrés Pérez",
  sentOn: "Nov 5, 2026",
  scheduling: { name: "Sam Scheduler", email: "Sam@Valtriminc.com" },
  lines: [line()],
  ...over,
});

Deno.test("the lots are grouped by event, Phase / Building and date, in the Calendar's order", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source({
    lines: [
      line({ lotNumber: "10", event: "DM", phaseCode: "1", building: "1" }),
      line({ lotNumber: "9", phaseCode: "2", building: "2" }),
      line({ lotNumber: "8", phaseCode: "2", building: "2" }),
      line({ lotNumber: "14", phaseCode: "2", building: "3" }),
      line({ lotNumber: "15", phaseCode: "2", building: "3", eventDate: "2026-11-24" }),
    ],
  }));

  assertEquals(
    snapshot.groups.map((group) => [
      group.event,
      group.place,
      group.eventDate,
      group.lots.map((lot) => lot.lotNumber),
    ]),
    [
      ["EXT", "Phase 2 · Building 2", "2026-11-20", ["8", "9"]],
      ["EXT", "Phase 2 · Building 3", "2026-11-20", ["14"]],
      ["EXT", "Phase 2 · Building 3", "2026-11-24", ["15"]],
      ["DM", "Phase 1 · Building 1", "2026-11-20", ["10"]],
    ],
  );
  assertEquals(snapshot.groups[0].eventName, "Exterior frames");
});

Deno.test("a Phase with a placeholder Building or no Building has no Building in its place", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source({
    lines: [
      line({ phaseCode: "MODELS", building: "." }),
      line({ lotNumber: "3", phaseCode: "P4", building: "" }),
    ],
  }));
  assertEquals(
    snapshot.groups.map((group) => group.place),
    ["Phase 4", "Phase MODELS"],
  );
});

Deno.test("a line with something that is not EXT, DM or HW is left out", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source({
    lines: [line({ event: "NONE" }), line({ lotNumber: "3", event: "HW" })],
  }));
  assertEquals(snapshot.groups.map((group) => group.event), ["HW"]);
});

Deno.test("the Scheduling contact is the default recipient, in lower case", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source());
  assertEquals(buildChangeOrderEmailDraft(snapshot).recipients, [
    { role: "Scheduling", name: "Sam Scheduler", email: "sam@valtriminc.com" },
  ]);
  assertEquals(snapshot.missingRoles, []);
});

Deno.test("with no Scheduling contact, or none with an email, nobody is preloaded and it says so", () => {
  for (const scheduling of [null, { name: "Sam", email: "  " }]) {
    const snapshot = buildChangeOrderEmailSnapshot(source({ scheduling }));
    assertEquals(buildChangeOrderEmailDraft(snapshot).recipients, []);
    assertEquals(snapshot.missingRoles, ["Scheduling"]);
  }
});

Deno.test("the subject names the Extra / CO, the Job and the event", () => {
  const one = buildChangeOrderEmailSnapshot(source());
  assertEquals(
    changeOrderEmailSubject(one),
    "Extra / Change Order CO-0005 · Job #1295 · charged with the EXT event",
  );

  const several = buildChangeOrderEmailSnapshot(source({
    lines: [line({ event: "HW" }), line({ lotNumber: "3", event: "EXT" })],
  }));
  assertEquals(
    changeOrderEmailSubject(several),
    "Extra / Change Order CO-0005 · Job #1295 · charged with the EXT and HW events",
  );
});

Deno.test("the email says where the work is and what it is, and carries no price", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source({
    lines: [
      line({ lotNumber: "7" }),
      line({ lotNumber: "8", scopeOfWork: "Add <b>two</b> outlets & a switch" }),
    ],
  }));
  const { html, text, subject } = renderChangeOrderEmail(snapshot);

  assertEquals(subject, changeOrderEmailSubject(snapshot));
  for (const output of [html, text]) {
    assertStringIncludes(output, "CO-0005");
    assertStringIncludes(output, "Indigo");
    assertStringIncludes(output, "Phase 2 · Building 2");
    assertStringIncludes(output, "Exterior frames");
    assertStringIncludes(output, "Fri, Nov 20, 2026");
    assertStringIncludes(output, "Lot 7");
    assertStringIncludes(output, "Carlos Ramirez");
  }
  assertStringIncludes(text, "2 lots have extra work");
  assertStringIncludes(html, "Add &lt;b&gt;two&lt;/b&gt; outlets &amp; a switch");
  assert(!html.includes("<b>two</b>"));
  assert(!/\$|price|amount/iu.test(text));
});

Deno.test("the heading names the Job and its Community, and only the Job when there is no Community", () => {
  const snapshot = buildChangeOrderEmailSnapshot(source());
  assertEquals(
    changeOrderEmailTitle(snapshot),
    `Extra / Change Order for #${snapshot.jobCode} · Indigo`,
  );

  const { html, text } = renderChangeOrderEmail(snapshot);
  assertStringIncludes(html, `<h1`);
  assertStringIncludes(html, `Extra / Change Order for #${snapshot.jobCode} · Indigo</h1>`);
  assertEquals(text.split("\n")[0], changeOrderEmailTitle(snapshot));
  assert(!/scheduled event/iu.test(html) && !/scheduled event/iu.test(text));

  const alone = buildChangeOrderEmailSnapshot(source({ community: "  " }));
  assertEquals(changeOrderEmailTitle(alone), `Extra / Change Order for #${alone.jobCode}`);
});

Deno.test("the Extra / CO is named by its number, with the internal number only when it is another one", () => {
  const own = renderChangeOrderEmail(buildChangeOrderEmailSnapshot(source()));
  assertStringIncludes(own.text, "Extra / Change Order: CO-0005 (E-2026-0047)\n");
  assertStringIncludes(own.html, "(E-2026-0047)");

  const same = renderChangeOrderEmail(
    buildChangeOrderEmailSnapshot(source({ internalNumber: "CO-0005" })),
  );
  assertStringIncludes(same.text, "Extra / Change Order: CO-0005\n");
  assert(!same.text.includes("CO-0005 (CO-0005)"));
  assert(!same.html.includes("(CO-0005)"));
});

Deno.test("one lot reads in the singular", () => {
  const { text } = renderChangeOrderEmail(buildChangeOrderEmailSnapshot(source()));
  assertStringIncludes(text, "1 lot has extra work that will be done and charged with its");
});

Deno.test("a date reads with its weekday, and a missing or odd one reads as nothing", () => {
  assertEquals(formatEmailDate("2026-11-20"), "Fri, Nov 20, 2026");
  assertEquals(formatEmailDate(null), "");
  assertEquals(formatEmailDate("11/20/2026"), "");
});

Deno.test("the status is written as the application writes it", () => {
  const { text } = renderChangeOrderEmail(buildChangeOrderEmailSnapshot(
    source({ status: "APPROVED" }),
  ));
  assertStringIncludes(text, "Status: Approved");
});
