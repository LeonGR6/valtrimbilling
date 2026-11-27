import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOptionsEmailDraft,
  buildOptionsEmailSnapshot,
  type OptionsEmailAddition,
  type OptionsEmailSource,
  optionsEmailSubject,
  renderOptionsEmail,
} from "./purchaseOrderOptionsEmail.ts";

const addition = (
  over: Partial<OptionsEmailAddition> = {},
): OptionsEmailAddition => ({
  lotId: "27",
  lotNumber: "27",
  phaseCode: "MODELS",
  building: ".",
  planCode: "4B",
  optionCode: "1STR0024",
  optionName: "Office with Exterior French Door First Floor",
  optionDescription: "",
  workOrderNo: "0820MDLH27-13325-19",
  referenceNo: "0004617828",
  createdInPlan: true,
  ...over,
});

const source = (
  over: Partial<OptionsEmailSource> = {},
): OptionsEmailSource => ({
  kind: "added",
  jobCode: "1326",
  community: "Heritage Walk",
  builderName: "The Olson Company",
  changedBy: "Andrés Pérez",
  changedOn: "Oct 21, 2026",
  purchasing: { name: "Pat Purchasing", email: "Pat@Valtriminc.com" },
  jobCoordinator: { name: "Jo Coordinator", email: "jo@valtriminc.com" },
  additions: [addition()],
  ...over,
});

Deno.test("the email is addressed to Purchasing and the Job Coordinator", () => {
  const snapshot = buildOptionsEmailSnapshot(source());
  const draft = buildOptionsEmailDraft(snapshot);

  assertEquals(
    draft.recipients.map(({ role, email }) => [role, email]),
    [["Purchasing", "pat@valtriminc.com"], [
      "Job Coordinator",
      "jo@valtriminc.com",
    ]],
  );
  assertEquals(snapshot.missingRoles, []);
  assertEquals(
    draft.subject,
    "Options added to the Sequence Sheet · Job #1326 · Lot 27",
  );
});

Deno.test("a role without an email on file is not a recipient and is reported", () => {
  const snapshot = buildOptionsEmailSnapshot(source({
    purchasing: { name: "Pat", email: "  " },
    jobCoordinator: null,
  }));

  assertEquals(buildOptionsEmailDraft(snapshot).recipients, []);
  assertEquals(snapshot.missingRoles, ["Purchasing", "Job Coordinator"]);
});

Deno.test("options are grouped by Lot in numeric order, with their Phase", () => {
  const snapshot = buildOptionsEmailSnapshot(source({
    additions: [
      addition({
        lotId: "28",
        lotNumber: "28",
        planCode: "2A",
        optionCode: "2WRD0009",
      }),
      addition({
        lotId: "9",
        lotNumber: "9",
        phaseCode: "Phase 1",
        building: "B2",
        optionCode: "5XXX",
      }),
      addition({ optionCode: "2FIN5006" }),
      addition({ optionCode: "1STR0024" }),
    ],
  }));

  assertEquals(snapshot.lots.map((lot) => lot.lotNumber), ["9", "27", "28"]);
  assertEquals(snapshot.lots[0].scope, "Phase 1 · Building 2");
  // "." is a placeholder, not a building.
  assertEquals(snapshot.lots[1].scope, "Phase MODELS");
  assertEquals(snapshot.lots[1].options.map((option) => option.code), [
    "1STR0024",
    "2FIN5006",
  ]);
  assertEquals(
    optionsEmailSubject(snapshot),
    "Options added to the Sequence Sheet · Job #1326 · 3 Lots",
  );
});

Deno.test("the description falls back to the name, and the source names the work order", () => {
  const [lot] = buildOptionsEmailSnapshot(source({
    additions: [
      addition(),
      addition({
        optionCode: "2FIN5006",
        optionDescription: "Add Half Size Shelf",
        workOrderNo: null,
      }),
    ],
  })).lots;

  assertEquals(
    lot.options[0].description,
    "Office with Exterior French Door First Floor",
  );
  assertEquals(
    lot.options[0].source,
    "Purchase Order · work order 0820MDLH27-13325-19 · ref 0004617828",
  );
  assertEquals(lot.options[1].description, "Add Half Size Shelf");
  assertEquals(lot.options[1].source, "Purchase Order");
});

Deno.test("the rendered email says what changed and escapes what it prints", () => {
  const rendered = renderOptionsEmail(buildOptionsEmailSnapshot(source({
    additions: [
      addition({ optionName: 'Door <script>alert("x")</script> & frame' }),
    ],
  })));

  assertStringIncludes(rendered.html, "Options added to the Sequence Sheet");
  assertStringIncludes(rendered.html, "1STR0024");
  // No price anywhere: neither a column nor an amount.
  assert(!rendered.html.includes("Price"));
  assert(!rendered.html.includes("$"));
  assertStringIncludes(rendered.html, "New option");
  assertStringIncludes(rendered.html, "Added by Andrés Pérez on Oct 21, 2026.");
  // The text between the tags is escaped.
  assert(!rendered.html.includes("<script>"));
  assertStringIncludes(rendered.html, "&lt;script&gt;");

  assertStringIncludes(rendered.text, "Lot 27\tPhase MODELS\tPlan 4B");
  assertStringIncludes(
    rendered.text,
    "1 option was printed in the Purchase Order",
  );
  assertEquals(
    rendered.subject,
    "Options added to the Sequence Sheet · Job #1326 · Lot 27",
  );
});

Deno.test("the intro and the badge follow the number of options", () => {
  const snapshot = buildOptionsEmailSnapshot(source({
    additions: [
      addition({ createdInPlan: false }),
      addition({ optionCode: "2FIN5006", createdInPlan: false }),
    ],
  }));
  const rendered = renderOptionsEmail(snapshot);

  assertStringIncludes(
    rendered.text,
    "2 options were printed in the Purchase Order",
  );
  assertStringIncludes(rendered.text, "They have been added.");
  assert(!rendered.html.includes("New option"));
});

Deno.test("a removed-options email says what was removed, with no Purchase Order", () => {
  const snapshot = buildOptionsEmailSnapshot(source({
    kind: "removed",
    additions: [
      addition({ createdInPlan: false, optionCode: "2CAB3033" }),
      addition({
        lotId: "28",
        lotNumber: "28",
        planCode: "2A",
        optionCode: "2WRD0009",
      }),
    ],
  }));
  const draft = buildOptionsEmailDraft(snapshot);
  const rendered = renderOptionsEmail(snapshot);

  assertEquals(draft.recipients.map(({ role }) => role), [
    "Purchasing",
    "Job Coordinator",
  ]);
  assertEquals(
    draft.subject,
    "Options removed from the Sequence Sheet · Job #1326 · 2 Lots",
  );
  assertEquals(draft.label, "Options removed from the Sequence Sheet");

  assertStringIncludes(
    rendered.html,
    "Options removed from the Sequence Sheet",
  );
  assertStringIncludes(rendered.html, "Options removed</th>");
  assertStringIncludes(
    rendered.html,
    "Removed by Andrés Pérez on Oct 21, 2026.",
  );
  assert(!rendered.html.includes("Price"));
  assert(!rendered.html.includes("$"));
  assert(!rendered.html.includes("Purchase Order ·"));
  assert(!rendered.html.includes("New option"));
  assert(!rendered.html.includes("Added by"));

  assertStringIncludes(
    rendered.text,
    "2 options were removed from the Sequence Sheet of this Job.",
  );
  assertStringIncludes(rendered.text, "the order may need to change.");
  assertStringIncludes(rendered.text, "Lot\tScope\tPlan\tOption\n");
  // No Purchase Order column in the text either.
  assert(!rendered.text.includes("Purchase Order"));
});

Deno.test("a single removed option reads in the singular", () => {
  const rendered = renderOptionsEmail(buildOptionsEmailSnapshot(source({
    kind: "removed",
    additions: [addition({ createdInPlan: false })],
  })));

  assertStringIncludes(
    rendered.text,
    "1 option was removed from the Sequence Sheet of this Job. If it was already ordered",
  );
});

Deno.test("an option added by editing a Phase does not point to a Purchase Order", () => {
  const snapshot = buildOptionsEmailSnapshot(source({
    kind: "added_manually",
    additions: [
      // Even when the option also appears in a Purchase Order, this change is not from one.
      addition({ createdInPlan: true }),
      addition({ optionCode: "2FIN5006", workOrderNo: null }),
    ],
  }));
  const rendered = renderOptionsEmail(snapshot);
  const draft = buildOptionsEmailDraft(snapshot);

  assertEquals(
    draft.subject,
    "Options added to the Sequence Sheet · Job #1326 · Lot 27",
  );
  assertEquals(draft.label, "Options added to the Sequence Sheet");
  assertEquals(draft.recipients.map(({ role }) => role), [
    "Purchasing",
    "Job Coordinator",
  ]);

  assertStringIncludes(rendered.html, "Options added</th>");
  assertStringIncludes(rendered.html, "Added by Andrés Pérez on Oct 21, 2026.");
  assert(!rendered.html.includes("Purchase Order"));
  assert(!rendered.html.includes("New option"));

  assertStringIncludes(
    rendered.text,
    "2 options were added to the Sequence Sheet of this Job.",
  );
  assert(!rendered.text.includes("printed in the Purchase Order"));
  assertStringIncludes(rendered.text, "Lot\tScope\tPlan\tOption\n");
  assert(!rendered.text.includes("Purchase Order"));
});

Deno.test("a single option added by editing reads in the singular", () => {
  const rendered = renderOptionsEmail(buildOptionsEmailSnapshot(source({
    kind: "added_manually",
    additions: [addition()],
  })));

  assertStringIncludes(
    rendered.text,
    "1 option was added to the Sequence Sheet of this Job.",
  );
});

Deno.test("the banner is green when options were added and red when they were removed", () => {
  const banner = (kind: OptionsEmailSource["kind"]) =>
    renderOptionsEmail(buildOptionsEmailSnapshot(source({ kind }))).html;

  for (const kind of ["added", "added_manually"] as const) {
    const html = banner(kind);
    assertStringIncludes(
      html,
      "background-color:#16a34a;border-radius:10px 10px 0 0",
    );
    assertStringIncludes(html, "color:#dcfce7;");
    assert(!html.includes("#2563eb"));
    assert(!html.includes("#dc2626"));
  }

  const removed = banner("removed");
  assertStringIncludes(
    removed,
    "background-color:#dc2626;border-radius:10px 10px 0 0",
  );
  assertStringIncludes(removed, "color:#fee2e2;");
  assert(!removed.includes("#2563eb"));
  assert(!removed.includes("#16a34a;border-radius"));
});

Deno.test("the table has a Lot, a Plan and the options, and nothing else", () => {
  const html = renderOptionsEmail(buildOptionsEmailSnapshot(source())).html;
  const headers = [...html.matchAll(/<th [^>]*>([^<]*)<\/th>/gu)].map((match) =>
    match[1]
  );

  assertEquals(headers, ["Lot", "Plan", "Options added"]);
});
