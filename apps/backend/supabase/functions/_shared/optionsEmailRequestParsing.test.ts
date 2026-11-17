import { assertEquals, assertThrows } from "@std/assert";
import {
  recipientEmails,
  requestedChanges,
  subjectOverride,
} from "./optionsEmailRequestParsing.ts";

Deno.test("the changes the browser names are checked in shape and deduplicated", () => {
  assertEquals(
    requestedChanges([
      { lotId: 27, optionId: "3", createdOption: true },
      { lotId: "27", optionId: 3 },
      // A price sent by an older screen is ignored: the emails carry none.
      { lotId: "28", optionId: "4", price: "-14.5", priceNotApplicable: true },
    ]),
    [
      { lotId: "27", optionId: "3", createdOption: true },
      { lotId: "28", optionId: "4", createdOption: false },
    ],
  );

  assertThrows(() => requestedChanges([]), Error, "between 1 and 200");
  assertThrows(() => requestedChanges("x"), Error, "between 1 and 200");
  assertThrows(
    () => requestedChanges([{ lotId: "0", optionId: "1" }]),
    Error,
    "valid Lot",
  );
  assertThrows(
    () => requestedChanges([{ lotId: "1", optionId: "abc" }]),
    Error,
    "valid option",
  );
  assertThrows(
    () =>
      requestedChanges(
        Array.from(
          { length: 201 },
          (_, i) => ({ lotId: "1", optionId: String(i + 1) }),
        ),
      ),
    Error,
    "between 1 and 200",
  );
});

Deno.test("recipients are normalized, deduplicated and limited", () => {
  assertEquals(
    recipientEmails([
      " Pat@Valtriminc.com ",
      "pat@valtriminc.com",
      "jo@valtriminc.com",
    ]),
    ["pat@valtriminc.com", "jo@valtriminc.com"],
  );
  assertThrows(() => recipientEmails([]), Error, "valid recipient");
  assertThrows(() => recipientEmails(["nope"]), Error, "valid recipient");
  assertThrows(
    () => recipientEmails("pat@valtriminc.com"),
    Error,
    "at least one",
  );
  assertThrows(
    () =>
      recipientEmails(
        Array.from({ length: 11 }, (_, i) => `p${i}@example.com`),
      ),
    Error,
    "up to 10",
  );
});

Deno.test("the subject can be rewritten, on one line and not too long", () => {
  assertEquals(subjectOverride(undefined, "Default"), "Default");
  assertEquals(subjectOverride("  ", "Default"), "Default");
  assertEquals(subjectOverride(" Mine ", "Default"), "Mine");
  assertThrows(() => subjectOverride("a\nb", "Default"), Error, "single line");
  assertThrows(
    () => subjectOverride("x".repeat(201), "Default"),
    Error,
    "200 characters",
  );
});
