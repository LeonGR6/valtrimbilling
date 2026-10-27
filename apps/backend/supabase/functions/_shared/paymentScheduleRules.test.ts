import { assertEquals } from "@std/assert";
import { rulesFromOperators } from "./paymentScheduleRules.ts";
import type { OperatorTable } from "./paymentScheduleRules.ts";

// The lines of a page, read from drawing operators built by hand. The numbers are
// the table pdf.js hands over in a real run; here they are only distinct.
const OPS: OperatorTable = {
  save: 1,
  restore: 2,
  transform: 3,
  constructPath: 4,
  paintFormXObjectBegin: 5,
  paintFormXObjectEnd: 6,
  beginGroup: 7,
  endGroup: 8,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
};

const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const CLOSE = 4;

type Operator = [number, unknown];

function path(paint: string, ...commands: number[]): Operator {
  return [OPS.constructPath, [OPS[paint], [commands], null]];
}

function rectangle(paint: string, x0: number, y0: number, x1: number, y1: number) {
  return path(paint, MOVE, x0, y0, LINE, x1, y0, LINE, x1, y1, LINE, x0, y1, CLOSE);
}

function read(operators: Operator[], origin: [number, number] = [0, 0]) {
  return rulesFromOperators(
    {
      fnArray: operators.map(([fn]) => fn),
      argsArray: operators.map(([, args]) => args),
    },
    OPS,
    origin,
  );
}

Deno.test("a border printed as a thin filled rectangle is a line, upright or flat", () => {
  assertEquals(
    read([
      rectangle("eoFill", 173.83, 418.9, 174.31, 437.4),
      rectangle("fill", 41.06, 418.42, 173.83, 418.9),
    ]),
    [
      { x0: 173.83, y0: 418.9, x1: 174.31, y1: 437.4 },
      { x0: 41.06, y0: 418.42, x1: 173.83, y1: 418.9 },
    ],
  );
});

Deno.test("a border with a notch cut out of it is still the line around it", () => {
  const notched = path(
    "eoFill",
    MOVE, 309, 418.9,
    LINE, 309, 418.42,
    LINE, 264.34, 418.42,
    LINE, 264.34, 418.9,
    LINE, 266.75, 418.9,
    LINE, 266.75, 418.48,
    LINE, 275.34, 418.48,
    LINE, 275.34, 418.9,
    CLOSE,
  );
  assertEquals(read([notched]), [{ x0: 264.34, y0: 418.42, x1: 309, y1: 418.9 }]);
});

Deno.test("fills, clips and marks are not borders", () => {
  assertEquals(
    read([
      // The background of a cell.
      rectangle("eoFill", 41, 400, 174, 437),
      // A clip: a path that is not painted.
      rectangle("endPath", 0, 0, 612, 1008),
      // A thin piece too short to be a border.
      rectangle("fill", 100, 100, 100.4, 103),
      // A curve.
      path("stroke", MOVE, 10, 10, CURVE, 20, 10, 30, 20, 40, 20, 50, 30, 60, 30),
    ]),
    [],
  );
});

Deno.test("a stroked line, and the four sides of a stroked rectangle, are borders", () => {
  assertEquals(
    read([path("stroke", MOVE, 50, 300, LINE, 250, 300)]),
    [{ x0: 50, y0: 300, x1: 250, y1: 300 }],
  );

  const sides = read([rectangle("stroke", 50, 300, 250, 320)]);
  assertEquals(sides.length, 4);
  assertEquals(
    sides.filter((side) => side.y0 === side.y1).map((side) => [side.x0, side.x1, side.y0]).sort(),
    [[50, 250, 300], [50, 250, 320]],
  );
  assertEquals(
    sides.filter((side) => side.x0 === side.x1).map((side) => [side.x0, side.y0, side.y1]).sort(),
    [[250, 300, 320], [50, 300, 320]],
  );

  // A diagonal is not a border.
  assertEquals(read([path("stroke", MOVE, 0, 0, LINE, 100, 50)]), []);
});

Deno.test("a transform moves the lines drawn inside it and stops at the restore", () => {
  assertEquals(
    read([
      [OPS.save, null],
      [OPS.transform, [1, 0, 0, 1, 10, 20]],
      rectangle("fill", 100, 100, 100.5, 140),
      [OPS.restore, null],
      rectangle("fill", 100, 100, 100.5, 140),
    ]),
    [
      { x0: 110, y0: 120, x1: 110.5, y1: 160 },
      { x0: 100, y0: 100, x1: 100.5, y1: 140 },
    ],
  );

  // A scaled space scales the line and its length.
  assertEquals(
    read([
      [OPS.save, null],
      [OPS.transform, [2, 0, 0, 2, 0, 0]],
      rectangle("fill", 10, 10, 10.25, 30),
    ]),
    [{ x0: 20, y0: 20, x1: 20.5, y1: 60 }],
  );
});

Deno.test("a form is placed by its own matrix, and a turned space has no borders", () => {
  assertEquals(
    read([
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 5, 6], [0, 0, 100, 100]]],
      rectangle("fill", 10, 10, 10.5, 50),
      [OPS.paintFormXObjectEnd, null],
      rectangle("fill", 10, 10, 10.5, 50),
    ]),
    [
      { x0: 15, y0: 16, x1: 15.5, y1: 56 },
      { x0: 10, y0: 10, x1: 10.5, y1: 50 },
    ],
  );

  assertEquals(
    read([
      [OPS.save, null],
      [OPS.transform, [0, 1, -1, 0, 0, 0]],
      rectangle("fill", 10, 10, 10.5, 50),
    ]),
    [],
  );
});

Deno.test("lines are placed relative to the page origin, like the text", () => {
  assertEquals(
    read([rectangle("fill", 40, 100, 40.5, 140)], [10, 20]),
    [{ x0: 30, y0: 80, x1: 30.5, y1: 120 }],
  );
});
