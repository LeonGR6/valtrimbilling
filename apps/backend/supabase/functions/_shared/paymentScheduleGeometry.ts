import { normalizeRect } from "./releaseGeometry.ts";
import type { PageContent, TextRun } from "./releaseTypes.ts";
import type { ScheduleRect } from "./paymentScheduleTypes.ts";

// Where a highlight goes: the box of the text it covers, a little larger so the
// glyphs are not clipped. Text runs report the baseline as `y` and the font
// size as `height`, so the box reaches below the baseline for descenders and
// above it for the capitals.

export const PAD_X = 1.5;
export const PAD_Y = 1;
export const DESCENT = 0.25;
export const ASCENT = 0.85;

/** Normalized rectangle (top-left origin, displayed page) of a box in page points. */
export function boxRect(
  left: number,
  bottom: number,
  right: number,
  top: number,
  page: PageContent,
): ScheduleRect {
  const { x, y, w, h } = normalizeRect([left, bottom, right, top], page);
  return { x, y, w, h };
}

/** Normalized rectangle (top-left origin, displayed page) around the runs. */
export function runsRect(runs: TextRun[], page: PageContent): ScheduleRect {
  const left = Math.min(...runs.map((run) => run.x)) - PAD_X;
  const right = Math.max(...runs.map((run) => run.x + run.width)) + PAD_X;
  const bottom = Math.min(...runs.map((run) => run.y - run.height * DESCENT)) -
    PAD_Y;
  const top = Math.max(...runs.map((run) => run.y + run.height * ASCENT)) +
    PAD_Y;

  return boxRect(left, bottom, right, top, page);
}
