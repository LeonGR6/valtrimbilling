import type { PageRule } from "./releaseTypes.ts";

// The lines a page draws, read from pdf.js's operator list: what is left of a
// table once its text is taken away. A Payment Schedule has the borders of its
// cells there even where a cell has no "$" or any other text in it.
//
// A border is drawn one of two ways, and both are read:
//   - stroked: a path along the line (or a stroked rectangle, whose four sides are lines);
//   - filled: a rectangle as thin as a line, which is how word processors and
//     e-signature tools print borders.
// Anything else (fills, clips, curves, rotated drawing) is not a border.

// A rectangle thinner than this is a line.
const THIN = 1.6;
// Shorter pieces are marks, not borders.
const MIN_LENGTH = 6;
// A page with more lines than this is a drawing, not a table.
const MAX_RULES = 20000;
const TILT = 1e-6;

// pdf.js numbers its drawing operators; the caller hands over its own table so
// this file does not depend on the version.
export type OperatorTable = Record<string, number>;

export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

type Matrix = readonly [number, number, number, number, number, number];
type Point = readonly [number, number];

// pdf.js path data: a flat list of a command followed by its coordinates.
const MOVE = 0;
const LINE = 1;
const CLOSE = 4;

const STROKES = ["stroke", "closeStroke", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"];
const FILLS = ["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function isNumberList(value: unknown): value is ArrayLike<number> {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

/** The subpaths of one path as lists of points; null when it holds a curve. */
function subpaths(data: ArrayLike<number>) {
  const paths: Array<{ points: Point[]; closed: boolean }> = [];
  let current: { points: Point[]; closed: boolean } | null = null;

  for (let index = 0; index < data.length;) {
    const command = data[index];
    if (command === MOVE) {
      current = { points: [[data[index + 1], data[index + 2]]], closed: false };
      paths.push(current);
      index += 3;
    } else if (command === LINE) {
      current?.points.push([data[index + 1], data[index + 2]]);
      index += 3;
    } else if (command === CLOSE) {
      if (current) current.closed = true;
      index += 1;
    } else {
      // A curve is not a border, and an unknown command cannot be walked past.
      return null;
    }
  }
  return paths;
}

function asRule(a: Point, b: Point): PageRule | null {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const flat = y1 - y0 <= THIN && x1 - x0 >= MIN_LENGTH;
  const upright = x1 - x0 <= THIN && y1 - y0 >= MIN_LENGTH;
  return flat || upright ? { x0, y0, x1, y1 } : null;
}

/** The line a filled shape is, when the box around it is as thin as a line. */
function ruleOfShape(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return asRule(
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  );
}

/**
 * Every line the operators draw, in page space shifted by `origin` (the page's
 * lower left corner, the same shift the text runs get).
 */
export function rulesFromOperators(
  list: OperatorList,
  ops: OperatorTable,
  origin: readonly [number, number] = [0, 0],
): PageRule[] {
  const rules: PageRule[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];

  for (let index = 0; index < list.fnArray.length; index += 1) {
    const fn = list.fnArray[index];
    const args = list.argsArray[index];

    if (fn === ops.save || fn === ops.paintFormXObjectBegin || fn === ops.beginGroup) {
      saved.push(matrix);
      // A form and a group carry the matrix that places their content.
      const placement = fn === ops.paintFormXObjectBegin
        ? Array.isArray(args) ? args[0] : null
        : fn === ops.beginGroup
        ? (args as Array<{ matrix?: unknown }> | null)?.[0]?.matrix
        : null;
      if (isNumberList(placement) && placement.length === 6) {
        matrix = multiply(matrix, Array.from(placement) as unknown as Matrix);
      }
    } else if (
      fn === ops.restore || fn === ops.paintFormXObjectEnd || fn === ops.endGroup
    ) {
      matrix = saved.pop() ?? matrix;
    } else if (fn === ops.transform) {
      if (isNumberList(args) && args.length === 6) {
        matrix = multiply(matrix, Array.from(args) as unknown as Matrix);
      }
    } else if (fn === ops.constructPath) {
      // Drawing that is turned or sheared cannot be a table's border.
      if (Math.abs(matrix[1]) > TILT || Math.abs(matrix[2]) > TILT) continue;
      if (!Array.isArray(args) || typeof args[0] !== "number") continue;

      const paint = args[0];
      const stroked = STROKES.some((name) => ops[name] === paint);
      const filled = FILLS.some((name) => ops[name] === paint);
      if (!stroked && !filled) continue;

      const data = Array.isArray(args[1]) ? args[1][0] : null;
      if (!isNumberList(data)) continue;
      const paths = subpaths(data);
      if (!paths) continue;

      const place = ([x, y]: Point): Point => [
        matrix[0] * x + matrix[4] - origin[0],
        matrix[3] * y + matrix[5] - origin[1],
      ];

      for (const { points, closed } of paths) {
        const placed = points.map(place);
        // A border printed as a filled shape is a rectangle, or one with a notch cut
        // out of it; either way the box around it is as thin as the line.
        if (filled && placed.length >= 3) {
          const rule = ruleOfShape(placed);
          if (rule) rules.push(rule);
        }
        if (stroked) {
          const loop = closed ? [...placed, placed[0]] : placed;
          for (let side = 1; side < loop.length; side += 1) {
            const rule = asRule(loop[side - 1], loop[side]);
            if (rule) rules.push(rule);
          }
        }
        if (rules.length > MAX_RULES) return [];
      }
    }
  }
  return rules;
}
