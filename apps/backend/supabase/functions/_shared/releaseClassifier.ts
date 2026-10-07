import { RELEASE_TYPES, type ReleaseType } from "./releaseTypes.ts";

// Deterministic Release type classification.
//
// Rules look at the TITLE block of the first page only. The body of these
// statutory forms mentions both "conditional" and "unconditional" (and both
// "progress" and "final"), so scanning the whole text would misclassify them.
// "unconditional" contains "conditional", so every test uses word boundaries:
// `\bconditional\b` does not match inside "unconditional" or "unconditionally".

export type ClassificationMethod =
  | "title_rules"
  | "wide_rules"
  | "llm"
  | "filename"
  | "none";

export interface ReleaseClassification {
  releaseType: ReleaseType | null;
  confidence: number;
  method: ClassificationMethod;
  // Short public form title that justified the decision. Never body text.
  evidence: string;
  candidates: Array<{ releaseType: ReleaseType; score: number }>;
  // True when a caller should ask the LLM tie-breaker or a person.
  needsTiebreak: boolean;
}

export interface ClassifyInput {
  // Text lines of page 1 in reading order (top to bottom).
  firstPageLines: string[];
  // Weak signal only: used when the text says nothing, never to overrule it.
  fileName?: string;
}

export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

const TITLE_SEARCH_LINES = 8;
const TITLE_MAX_LINES = 3;
const WIDE_LINE_COUNT = 12;
const DATE_ONLY_LINE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/u;
const WAIVER_PHRASE = /\bwaiver\s+and\s+release\b/iu;
const EVIDENCE_PHRASE =
  /\b(?:un)?conditional\s+waiver\s+and\s+release\s+on\s+(?:progress|final)\s+payment\b/iu;

type Kind = "conditional" | "unconditional";
type Payment = "progress" | "final";
type Decision<T> = { state: "decided"; value: T } | { state: "ambiguous" } | {
  state: "unknown";
};

function normalize(text: string) {
  return text.replace(/[ \s]+/gu, " ").trim();
}

function decide<T extends string>(
  first: { value: T; found: boolean },
  second: { value: T; found: boolean },
): Decision<T> {
  if (first.found && second.found) return { state: "ambiguous" };
  if (first.found) return { state: "decided", value: first.value };
  if (second.found) return { state: "decided", value: second.value };
  return { state: "unknown" };
}

function readKind(text: string): Decision<Kind> {
  return decide<Kind>(
    { value: "unconditional", found: /\bunconditional\b/iu.test(text) },
    { value: "conditional", found: /\bconditional\b/iu.test(text) },
  );
}

function readPayment(text: string): Decision<Payment> {
  return decide<Payment>(
    { value: "progress", found: /\bprogress\s+payment\b/iu.test(text) },
    { value: "final", found: /\bfinal\s+payment\b/iu.test(text) },
  );
}

function toReleaseType(kind: Kind, payment: Payment): ReleaseType {
  const kindName = kind === "conditional" ? "Conditional" : "Unconditional";
  const paymentName = payment === "progress" ? "Progress" : "Final";
  return `${kindName}WaiverAndReleaseOn${paymentName}Payment` as ReleaseType;
}

function dimensionScore<T>(decision: Decision<T>, value: T) {
  if (decision.state === "unknown") return 0.5;
  if (decision.state === "ambiguous") return 0.5;
  return decision.value === value ? 1 : 0;
}

function rankCandidates(kind: Decision<Kind>, payment: Decision<Payment>) {
  const kinds: Kind[] = ["conditional", "unconditional"];
  const payments: Payment[] = ["progress", "final"];
  const candidates: ReleaseClassification["candidates"] = [];
  for (const kindValue of kinds) {
    for (const paymentValue of payments) {
      const score = dimensionScore(kind, kindValue) *
        dimensionScore(payment, paymentValue);
      if (score > 0) {
        candidates.push({
          releaseType: toReleaseType(kindValue, paymentValue),
          score,
        });
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score);
}

function readFileNameHint(fileName: string | undefined) {
  const name = (fileName ?? "").toLowerCase().replace(/\.pdf$/u, "");
  const tokens = name.split(/[^a-z]+/u).filter(Boolean);
  const has = (word: string) => tokens.some((token) => token === word);
  const kind: Decision<Kind> = has("unconditional")
    ? { state: "decided", value: "unconditional" }
    : has("conditional")
    ? { state: "decided", value: "conditional" }
    : { state: "unknown" };
  const payment: Decision<Payment> = has("progress")
    ? { state: "decided", value: "progress" }
    : has("final")
    ? { state: "decided", value: "final" }
    : { state: "unknown" };
  return { kind, payment };
}

function evidenceFrom(text: string) {
  const phrase = EVIDENCE_PHRASE.exec(text)?.[0];
  return normalize(phrase ?? text).slice(0, 120);
}

function contentLines(lines: string[]) {
  return lines
    .map(normalize)
    .filter((line) => line !== "" && !DATE_ONLY_LINE.test(line));
}

function blockOf(lines: string[], count: number) {
  return contentLines(lines).slice(0, count).join(" ");
}

// The title is the first line that says "waiver", plus the following lines
// only while the title has not reached the word "payment" yet (a title split
// over two lines). The notice below it is deliberately left out: the notice of
// an unconditional form tells people to "use a conditional waiver" instead.
function titleOf(lines: string[]) {
  const content = contentLines(lines);
  const start = content
    .slice(0, TITLE_SEARCH_LINES)
    .findIndex((line) => /\bwaiver\b/iu.test(line));
  if (start === -1) return "";

  let title = content[start];
  for (
    let next = start + 1;
    next < content.length &&
    next < start + TITLE_MAX_LINES &&
    !/\bpayment\b/iu.test(title);
    next += 1
  ) {
    title = `${title} ${content[next]}`;
  }
  return title;
}

function resultFor(
  kind: Decision<Kind>,
  payment: Decision<Payment>,
  extra: Pick<ReleaseClassification, "confidence" | "method" | "evidence">,
): ReleaseClassification {
  const releaseType = kind.state === "decided" && payment.state === "decided"
    ? toReleaseType(kind.value, payment.value)
    : null;
  return {
    releaseType,
    confidence: releaseType ? extra.confidence : Math.min(extra.confidence, 0.4),
    method: extra.method,
    evidence: extra.evidence,
    candidates: rankCandidates(kind, payment),
    needsTiebreak: !releaseType ||
      extra.confidence < REVIEW_CONFIDENCE_THRESHOLD,
  };
}

export function classifyReleaseType(
  input: ClassifyInput,
): ReleaseClassification {
  const title = titleOf(input.firstPageLines);
  const titleKind = readKind(title);
  const titlePayment = readPayment(title);

  if (
    WAIVER_PHRASE.test(title) &&
    titleKind.state === "decided" &&
    titlePayment.state === "decided"
  ) {
    return resultFor(titleKind, titlePayment, {
      confidence: 0.98,
      method: "title_rules",
      evidence: evidenceFrom(title),
    });
  }

  // The title was cut, split oddly or not recognised: look a little further
  // down page 1, but trust it less.
  const wide = blockOf(input.firstPageLines, WIDE_LINE_COUNT);
  const wideKind = readKind(wide);
  const widePayment = readPayment(wide);
  if (
    WAIVER_PHRASE.test(wide) &&
    wideKind.state === "decided" &&
    widePayment.state === "decided"
  ) {
    return resultFor(wideKind, widePayment, {
      confidence: 0.6,
      method: "wide_rules",
      evidence: evidenceFrom(wide),
    });
  }

  const hint = readFileNameHint(input.fileName);
  if (hint.kind.state === "decided" && hint.payment.state === "decided") {
    return resultFor(hint.kind, hint.payment, {
      confidence: 0.35,
      method: "filename",
      evidence: "",
    });
  }

  // Keep whatever the title block did establish so the tie-breaker or the
  // reviewer starts from real candidates instead of all four types.
  const partialKind = titleKind.state !== "unknown" ? titleKind : wideKind;
  const partialPayment = titlePayment.state !== "unknown"
    ? titlePayment
    : widePayment;
  return resultFor(partialKind, partialPayment, {
    confidence: 0,
    method: "none",
    evidence: evidenceFrom(title),
  });
}

export function isReleaseType(value: unknown): value is ReleaseType {
  return typeof value === "string" &&
    (RELEASE_TYPES as readonly string[]).includes(value);
}
