import type { NormalizedRect } from "./releaseTypes.ts";

const COORDINATE_DECIMALS = 5;

function round(value: number) {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeRotation(rotation: number) {
  const turns = Math.round(rotation / 90);
  return (((turns % 4) + 4) % 4) * 90;
}

/**
 * Converts a rectangle in PDF user space (points, origin bottom-left of the
 * unrotated page) into the normalized top-left rectangle of the page as it is
 * displayed. Rotation is the page's clockwise display rotation.
 */
export function normalizeRect(
  rect: readonly [number, number, number, number],
  page: { page: number; width: number; height: number; rotation: number },
): NormalizedRect {
  const { width, height } = page;
  if (!(width > 0) || !(height > 0)) {
    throw new Error("Page size must be positive.");
  }

  const rotation = normalizeRotation(page.rotation);
  const [ax, ay, bx, by] = rect;
  const corners: Array<[number, number]> = [[ax, ay], [bx, by]];

  // Displayed coordinates measured from the top-left corner.
  const displayed = corners.map(([x, y]): [number, number] => {
    switch (rotation) {
      case 90:
        return [y, x];
      case 180:
        return [width - x, y];
      case 270:
        return [height - y, width - x];
      default:
        return [x, height - y];
    }
  });

  const displayWidth = rotation === 90 || rotation === 270 ? height : width;
  const displayHeight = rotation === 90 || rotation === 270 ? width : height;
  const left = Math.min(displayed[0][0], displayed[1][0]);
  const right = Math.max(displayed[0][0], displayed[1][0]);
  const top = Math.min(displayed[0][1], displayed[1][1]);
  const bottom = Math.max(displayed[0][1], displayed[1][1]);

  const x = round(clamp01(left / displayWidth));
  const y = round(clamp01(top / displayHeight));
  // Rounding must never push the rectangle past the page edge: the database
  // rejects x + w > 1.
  return {
    page: page.page,
    x,
    y,
    w: Math.min(round(clamp01(right / displayWidth) - x), round(1 - x)),
    h: Math.min(round(clamp01(bottom / displayHeight) - y), round(1 - y)),
  };
}
