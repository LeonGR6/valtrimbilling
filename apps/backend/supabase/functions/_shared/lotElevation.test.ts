import { assertEquals } from "@std/assert";
import {
  cleanElevation,
  elevationLabel,
  planHtmlWithElevation,
  planTextWithElevation,
} from "./lotElevation.ts";

Deno.test("an elevation is trimmed and upper case, and a Lot without one says nothing", () => {
  assertEquals(cleanElevation(" b "), "B");
  assertEquals(cleanElevation(null), "");
  assertEquals(elevationLabel("a"), "Elev. A");
  assertEquals(elevationLabel(""), "");
  assertEquals(elevationLabel(undefined), "");
});

Deno.test("the Plan reads the same as before when the Lot has no elevation", () => {
  assertEquals(planTextWithElevation("10A", null), "10A");
  assertEquals(planTextWithElevation("10", "c"), "10 (Elev. C)");
  const escape = (value: string) => value.replace(/</g, "&lt;");
  assertEquals(planHtmlWithElevation("10A", "", escape), "10A");
  assertEquals(
    planHtmlWithElevation("10", "<b", escape).includes("Elev. &lt;B"),
    true,
  );
});
