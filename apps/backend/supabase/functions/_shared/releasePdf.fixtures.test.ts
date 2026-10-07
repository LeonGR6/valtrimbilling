import { assert, assertEquals } from "@std/assert";
import { classifyReleaseType } from "./releaseClassifier.ts";
import { buildLines, detectReleaseFields } from "./releaseFields.ts";
import { readReleasePdf } from "./releasePdf.ts";

// Runs the real pipeline against the sample PDFs in fixtures/private/releases
// (ignored by git: they are real documents). The tests skip themselves when the
// folder is not there, so a fresh clone and CI stay green. Run with:
//   npm run functions:test --workspace=@valtrimbilling/backend

const FIXTURES = new URL(
  "../../../../../fixtures/private/releases/",
  import.meta.url,
);

function available(name: string) {
  try {
    return Deno.statSync(new URL(name, FIXTURES)).isFile;
  } catch {
    return false;
  }
}

async function analyze(name: string) {
  const bytes = await Deno.readFile(new URL(name, FIXTURES));
  const content = await readReleasePdf(bytes);
  const firstPageLines = buildLines(content.pages[0].runs).map(({ text }) =>
    text
  );
  return {
    content,
    classification: classifyReleaseType({ firstPageLines, fileName: name }),
    fields: detectReleaseFields(content.pages),
  };
}

function fieldNames(
  fields: ReturnType<typeof detectReleaseFields>,
  variable: "through_date" | "check_amount" | "signature_date",
) {
  return fields.suggestions
    .filter((suggestion) => suggestion.variable === variable)
    .map((suggestion) => suggestion.fieldName);
}

const cases = [
  {
    file: "conditional-progress.pdf",
    type: "ConditionalWaiverAndReleaseOnProgressPayment",
    through: ["through date"],
    amount: ["amount"],
    signature: ["date"],
  },
  {
    file: "conditional-final.pdf",
    type: "ConditionalWaiverAndReleaseOnFinalPayment",
    through: [],
    amount: ["amount"],
    signature: ["date"],
  },
  {
    file: "unconditional-progress.pdf",
    type: "UnconditionalWaiverAndReleaseOnProgressPayment",
    through: ["through date"],
    amount: ["amount"],
    signature: ["date"],
  },
  {
    file: "unconditional-final.pdf",
    type: "UnconditionalWaiverAndReleaseOnFinalPayment",
    through: [],
    amount: [],
    signature: ["date"],
  },
];

for (const expected of cases) {
  Deno.test({
    name: `fixture ${expected.file}: type and fields`,
    ignore: !available(expected.file),
    permissions: { read: true },
    async fn() {
      const { content, classification, fields } = await analyze(expected.file);

      assertEquals(content.pageCount, 1);
      assert(content.textLength > 200, "the text layer is readable without OCR");
      assertEquals(classification.releaseType, expected.type);
      assertEquals(classification.method, "title_rules");
      assertEquals(classification.needsTiebreak, false);
      assertEquals(fieldNames(fields, "through_date"), expected.through);
      assertEquals(fieldNames(fields, "check_amount"), expected.amount);
      assertEquals(fieldNames(fields, "signature_date"), expected.signature);
      for (const suggestion of fields.suggestions) {
        assertEquals(suggestion.state, "blank");
        assert(suggestion.rect !== null);
        assert(suggestion.rect.x >= 0 && suggestion.rect.x + suggestion.rect.w <= 1);
        assert(suggestion.rect.y >= 0 && suggestion.rect.y + suggestion.rect.h <= 1);
      }
    },
  });
}

Deno.test({
  name: "fixture prefilled-conditional-progress.pdf: flat document with filled labels",
  ignore: !available("prefilled-conditional-progress.pdf"),
  permissions: { read: true },
  async fn() {
    const { classification, fields } = await analyze(
      "prefilled-conditional-progress.pdf",
    );

    assertEquals(
      classification.releaseType,
      "ConditionalWaiverAndReleaseOnProgressPayment",
    );
    assertEquals(fields.hasWidgets, false);
    for (
      const variable of ["through_date", "check_amount", "signature_date"] as const
    ) {
      const [suggestion, ...rest] = fields.suggestions.filter((candidate) =>
        candidate.variable === variable
      );
      assertEquals(rest, []);
      assertEquals(suggestion.state, "blank");
      assertEquals(suggestion.source, "text_layer");
      assert(suggestion.rect !== null);
    }
  },
});
