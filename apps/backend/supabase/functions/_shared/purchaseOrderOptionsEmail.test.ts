import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOptionsEmailDraft,
  buildOptionsEmailSnapshot,
  type OptionsEmailAddition,
  type OptionsEmailSource,
  optionsEmailSubject,
  priceLabel,
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
  price: 1126,
  priceNotApplicable: false,
  workOrderNo: "0820MDLH27-13325-19",
  referenceNo: "0004617828",
  createdInPlan: true,
  ...over,
});

const source = (
  over: Partial<OptionsEmailSource> = {},
): OptionsEmailSource => ({
  jobCode: "1326",
  community: "Heritage Walk",
  builderName: "The Olson Company",
  addedBy: "Andrés Pérez",
  addedOn: "Oct 21, 2026",
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

Deno.test("prices are formatted, with NA and unknown kept apart", () => {
  assertEquals(
    priceLabel({ price: 1126, priceNotApplicable: false }),
    "$1,126.00",
  );
  assertEquals(
    priceLabel({ price: -14, priceNotApplicable: false }),
    "-$14.00",
  );
  assertEquals(priceLabel({ price: 0, priceNotApplicable: true }), "NA");
  assertEquals(priceLabel({ price: null, priceNotApplicable: false }), "—");
});

Deno.test("the rendered email says what changed and escapes what it prints", () => {
  const rendered = renderOptionsEmail(buildOptionsEmailSnapshot(source({
    additions: [
      addition({ optionName: 'Door <script>alert("x")</script> & frame' }),
    ],
  })));

  assertStringIncludes(rendered.html, "Options added to the Sequence Sheet");
  assertStringIncludes(rendered.html, "1STR0024");
  assertStringIncludes(rendered.html, "$1,126.00");
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
