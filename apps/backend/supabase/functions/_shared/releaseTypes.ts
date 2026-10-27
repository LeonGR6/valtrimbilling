// Shared vocabulary for Release template analysis. Pure types and constants:
// nothing here touches the network, Storage or a PDF parser.

export const RELEASE_TYPES = [
  "ConditionalWaiverAndReleaseOnProgressPayment",
  "ConditionalWaiverAndReleaseOnFinalPayment",
  "UnconditionalWaiverAndReleaseOnProgressPayment",
  "UnconditionalWaiverAndReleaseOnFinalPayment",
] as const;

export type ReleaseType = (typeof RELEASE_TYPES)[number];

// Must match private.release_template_variables() in the database.
export const RELEASE_VARIABLES = [
  "through_date",
  "check_amount",
  "signature_date",
  "waiver_release_dates",
  "unpaid_progress_amount",
  "disputed_claims_amount",
] as const;

export type ReleaseVariable = (typeof RELEASE_VARIABLES)[number];

// One piece of text as pdf.js reports it. Coordinates are PDF points in the
// page's unrotated user space, origin at the bottom-left of the visible box.
// `y` is the text baseline.
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// A fillable text field (AcroForm widget). `rect` is [x1, y1, x2, y2] in the
// same space as TextRun.
export interface Widget {
  name: string;
  rect: [number, number, number, number];
  value: string;
}

// A straight line the page draws, like the border of a table cell, as the box it
// covers: [x0, x1] by [y0, y1] in the same space as TextRun. A line is as thin as it
// is drawn, so one of the two sides is a line's width.
export interface PageRule {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageContent {
  page: number;
  width: number;
  height: number;
  // Clockwise rotation applied when the page is displayed: 0, 90, 180 or 270.
  rotation: number;
  runs: TextRun[];
  widgets: Widget[];
  // The lines drawn on the page. Only read for pages that need them (a table's
  // cells), so most pages leave it out.
  rules?: PageRule[];
}

// Rectangle on the page as it is displayed (after rotation), normalized to
// 0-1 with the origin at the top-left. This is the shape stored in the mapping.
export interface NormalizedRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
