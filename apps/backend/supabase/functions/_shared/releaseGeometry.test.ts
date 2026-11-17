import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { normalizeRect, normalizeRotation } from "./releaseGeometry.ts";

const letter = { page: 1, width: 612, height: 792, rotation: 0 };

function assertRect(
  actual: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
) {
  assertAlmostEquals(actual.x, expected.x, 1e-4);
  assertAlmostEquals(actual.y, expected.y, 1e-4);
  assertAlmostEquals(actual.w, expected.w, 1e-4);
  assertAlmostEquals(actual.h, expected.h, 1e-4);
}

Deno.test("an unrotated PDF rectangle flips to a top-left origin", () => {
  const rect = normalizeRect([139, 505, 330, 520], letter);
  assertEquals(rect.page, 1);
  assertRect(rect, {
    x: 139 / 612,
    y: (792 - 520) / 792,
    w: (330 - 139) / 612,
    h: 15 / 792,
  });
});

Deno.test("reversed corners give the same rectangle", () => {
  assertEquals(
    normalizeRect([330, 520, 139, 505], letter),
    normalizeRect([139, 505, 330, 520], letter),
  );
});

Deno.test("a rectangle in the bottom-left corner sits at y near 1", () => {
  const rect = normalizeRect([0, 0, 61.2, 79.2], letter);
  assertRect(rect, { x: 0, y: 0.9, w: 0.1, h: 0.1 });
});

Deno.test("rotation 90 maps the displayed page clockwise", () => {
  // The unrotated bottom-left corner ends up at the displayed top-left.
  const rect = normalizeRect([0, 0, 79.2, 61.2], { ...letter, rotation: 90 });
  assertRect(rect, { x: 0, y: 0, w: 61.2 / 792, h: 79.2 / 612 });
});

Deno.test("rotation 180 mirrors both axes", () => {
  const rect = normalizeRect([0, 0, 61.2, 79.2], { ...letter, rotation: 180 });
  assertRect(rect, { x: 0.9, y: 0, w: 0.1, h: 0.1 });
});

Deno.test("rotation 270 maps the displayed page counter-clockwise", () => {
  // The unrotated top-right corner ends up at the displayed top-left.
  const rect = normalizeRect([612 - 79.2, 792 - 61.2, 612, 792], {
    ...letter,
    rotation: 270,
  });
  assertRect(rect, { x: 0, y: 0, w: 61.2 / 792, h: 79.2 / 612 });
});

Deno.test("rotation is normalized to a multiple of 90", () => {
  assertEquals(normalizeRotation(0), 0);
  assertEquals(normalizeRotation(450), 90);
  assertEquals(normalizeRotation(-90), 270);
  assertEquals(normalizeRotation(540), 180);
});

Deno.test("values stay inside 0-1 and never exceed the page edge", () => {
  const rect = normalizeRect([-5, -5, 700, 900], letter);
  assert(rect.x >= 0 && rect.y >= 0);
  assert(rect.x + rect.w <= 1 && rect.y + rect.h <= 1);
});

Deno.test("rounding does not push a rectangle past the right edge", () => {
  const rect = normalizeRect([300.123456, 100, 612, 120], letter);
  assert(rect.x + rect.w <= 1);
});

Deno.test("a page without a size is rejected", () => {
  assertThrows(
    () => normalizeRect([0, 0, 1, 1], { ...letter, width: 0 }),
    Error,
    "Page size must be positive.",
  );
});
