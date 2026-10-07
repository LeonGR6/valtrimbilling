import { normalizeRect } from "./releaseGeometry.ts";
import type {
  NormalizedRect,
  PageContent,
  ReleaseVariable,
  TextRun,
  Widget,
} from "./releaseTypes.ts";
import { RELEASE_VARIABLES } from "./releaseTypes.ts";

// Detects where the Release variables go. The PRINTED LABEL is the signal, not
// the AcroForm field name: in these forms the field named "amount" is the
// check amount in one type and the disputed-claims amount in another.
//
// A suggestion is "blank" when nothing follows its label and "filled" when the
// document already carries a value there (a Release that was partially filled
// before upload). Only blank ones are meant to be placed.

export type FieldSource = "acroform" | "text_layer" | "ocr";
export type FieldState = "blank" | "filled";

export interface FieldSuggestion {
  variable: ReleaseVariable;
  // Label as printed in the document (short, public form wording).
  label: string;
  confidence: number;
  source: FieldSource;
  state: FieldState;
  // Null when the value is already filled in and there is nothing to place.
  rect: NormalizedRect | null;
  // AcroForm field that matched, when there is one. A hint only.
  fieldName: string | null;
  reason: string;
}

export interface DetectedFields {
  suggestions: FieldSuggestion[];
  // Catalog variables that this document does not contain.
  missing: ReleaseVariable[];
  hasWidgets: boolean;
}

export interface TextLine {
  text: string;
  x0: number;
  x1: number;
  y: number;
  height: number;
}

interface LabelSpec {
  pattern: RegExp;
  reason: string;
}

// Label printed at the start of a line, with the value on the same line.
const INLINE_LABELS: Record<ReleaseVariable, LabelSpec[]> = {
  through_date: [
    { pattern: /^through\s+date\s*:/iu, reason: "Through Date label" },
  ],
  check_amount: [
    { pattern: /^amount\s+of\s+check\s*:/iu, reason: "Amount of Check label" },
  ],
};

// Sentence that introduces the value on the line BELOW it, as in the
// unconditional progress form ("...received the following progress payment:").
const SENTENCE_LABELS: Partial<Record<ReleaseVariable, LabelSpec[]>> = {
  check_amount: [
    {
      pattern: /\breceived\s+the\s+following\s+(?:progress\s+)?payment\s*:?\s*$/iu,
      reason: "payment sentence above the amount line",
    },
  ],
};

const SAME_LINE_TOLERANCE = 2.5;
const DEFAULT_VALUE_WIDTH = 190;
const RIGHT_MARGIN = 54;
const MIN_VALUE_HEIGHT = 14;
const WIDGET_BAND = 3;
const WIDGET_MAX_GAP = 80;
const SENTENCE_MAX_DISTANCE = 45;
const BLANK_VALUE_LINE = /^\$?[\s_]{3,}$/u;

export function buildLines(runs: TextRun[]): TextLine[] {
  const groups: Array<{ y: number; runs: TextRun[] }> = [];
  const ordered = runs
    .filter((run) => run.text.trim() !== "")
    .sort((left, right) => right.y - left.y || left.x - right.x);

  for (const run of ordered) {
    const group = groups.find((candidate) =>
      Math.abs(candidate.y - run.y) <= SAME_LINE_TOLERANCE
    );
    if (group) group.runs.push(run);
    else groups.push({ y: run.y, runs: [run] });
  }

  return groups.map((group) => {
    const sorted = [...group.runs].sort((left, right) => left.x - right.x);
    let text = "";
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const run of sorted) {
      const needsSpace = text !== "" && run.x - previousEnd > 1 &&
        !text.endsWith(" ") && !run.text.startsWith(" ");
      text += `${needsSpace ? " " : ""}${run.text}`;
      previousEnd = Math.max(previousEnd, run.x + run.width);
    }
    return {
      text: text.replace(/\s+/gu, " ").trim(),
      x0: sorted[0].x,
      x1: Math.max(...sorted.map((run) => run.x + run.width)),
      y: group.y,
      height: Math.max(...sorted.map((run) => run.height)),
    };
  }).sort((left, right) => right.y - left.y);
}

function valueBox(
  line: TextLine,
  x: number,
  xEnd: number,
): [number, number, number, number] {
  const bottom = line.y - 3;
  return [x, bottom, xEnd, bottom + Math.max(MIN_VALUE_HEIGHT, line.height * 1.3)];
}

function widgetOnSameLine(line: TextLine, widgets: Widget[]) {
  return widgets
    .filter((widget) => {
      const [left, bottom, , top] = widget.rect;
      return line.y >= bottom - WIDGET_BAND && line.y <= top + WIDGET_BAND &&
        left >= line.x1 - 8 && left - line.x1 <= WIDGET_MAX_GAP;
    })
    .sort((a, b) => a.rect[0] - b.rect[0])[0] ?? null;
}

function widgetBelow(line: TextLine, widgets: Widget[]) {
  return widgets
    .filter((widget) => {
      const [left, , right, top] = widget.rect;
      return top <= line.y + 2 && line.y - top <= SENTENCE_MAX_DISTANCE &&
        right > line.x0 && left < line.x1;
    })
    .sort((a, b) => b.rect[3] - a.rect[3])[0] ?? null;
}

function suggestionFromWidget(
  variable: ReleaseVariable,
  label: string,
  widget: Widget,
  page: PageContent,
  confidence: number,
  reason: string,
): FieldSuggestion {
  const filled = widget.value.trim() !== "";
  return {
    variable,
    label,
    confidence: filled ? Math.min(confidence, 0.6) : confidence,
    source: "acroform",
    state: filled ? "filled" : "blank",
    rect: normalizeRect(widget.rect, page),
    fieldName: widget.name,
    reason,
  };
}

function inlineSuggestions(
  variable: ReleaseVariable,
  lines: TextLine[],
  page: PageContent,
): FieldSuggestion[] {
  const found: FieldSuggestion[] = [];
  for (const spec of INLINE_LABELS[variable]) {
    for (const line of lines) {
      const match = spec.pattern.exec(line.text);
      if (!match) continue;

      const label = match[0].trim();
      const remainder = line.text.slice(match[0].length).replace(/[$_\s.]/gu, "");
      const widget = remainder === ""
        ? widgetOnSameLine(line, page.widgets)
        : null;
      if (widget) {
        found.push(suggestionFromWidget(
          variable,
          label,
          widget,
          page,
          0.95,
          `${spec.reason} next to a form field`,
        ));
        continue;
      }

      if (remainder !== "") {
        found.push({
          variable,
          label,
          confidence: 0.6,
          source: "text_layer",
          state: "filled",
          rect: null,
          fieldName: null,
          reason: `${spec.reason}, already filled in the document`,
        });
        continue;
      }

      const x = line.x1 + 3;
      const xEnd = Math.min(x + DEFAULT_VALUE_WIDTH, page.width - RIGHT_MARGIN);
      found.push({
        variable,
        label,
        confidence: 0.85,
        source: "text_layer",
        state: "blank",
        rect: normalizeRect(valueBox(line, x, Math.max(xEnd, x + 40)), page),
        fieldName: null,
        reason: `${spec.reason}, blank area after it`,
      });
    }
  }
  return found;
}

function sentenceSuggestions(
  variable: ReleaseVariable,
  lines: TextLine[],
  page: PageContent,
): FieldSuggestion[] {
  const found: FieldSuggestion[] = [];
  for (const spec of SENTENCE_LABELS[variable] ?? []) {
    lines.forEach((line, index) => {
      const match = spec.pattern.exec(line.text);
      if (!match) return;

      const label = match[0].trim();
      const widget = widgetBelow(line, page.widgets);
      if (widget) {
        found.push(suggestionFromWidget(
          variable,
          label,
          widget,
          page,
          0.8,
          `${spec.reason} with a form field`,
        ));
        return;
      }

      const next = lines[index + 1];
      if (
        next && line.y - next.y <= SENTENCE_MAX_DISTANCE &&
        BLANK_VALUE_LINE.test(next.text)
      ) {
        found.push({
          variable,
          label,
          confidence: 0.7,
          source: "text_layer",
          state: "blank",
          rect: normalizeRect(valueBox(next, next.x0, next.x1), page),
          fieldName: null,
          reason: `${spec.reason}, blank line below it`,
        });
      }
    });
  }
  return found;
}

export function detectReleaseFields(pages: PageContent[]): DetectedFields {
  const suggestions: FieldSuggestion[] = [];

  for (const page of pages) {
    const lines = buildLines(page.runs);
    for (const variable of RELEASE_VARIABLES) {
      suggestions.push(
        ...inlineSuggestions(variable, lines, page),
        ...sentenceSuggestions(variable, lines, page),
      );
    }
  }

  suggestions.sort((left, right) => right.confidence - left.confidence);
  const present = new Set(suggestions.map(({ variable }) => variable));
  return {
    suggestions,
    missing: RELEASE_VARIABLES.filter((variable) => !present.has(variable)),
    hasWidgets: pages.some((page) => page.widgets.length > 0),
  };
}
