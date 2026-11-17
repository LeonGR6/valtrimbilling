// The elevation of a Lot (A, B, C, ...) is its own attribute, apart from the Plan. It only tells Lots apart, so an
// email says it next to the Plan, and only for a Lot that has one.

/** The elevation as it is saved: trimmed and upper case; "" when the Lot has none. */
export function cleanElevation(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** "Elev. A", or "" when there is none. */
export function elevationLabel(elevation: unknown): string {
  const clean = cleanElevation(elevation);
  return clean ? `Elev. ${clean}` : "";
}

/** The Plan of a Lot for plain text: "10" or "10 (Elev. A)". */
export function planTextWithElevation(planCode: string, elevation: unknown): string {
  const label = elevationLabel(elevation);
  return label ? `${planCode} (${label})` : planCode;
}

/** The Plan cell of an email row: the Plan, and the elevation under it only when the Lot has one. */
export function planHtmlWithElevation(
  planHtml: string,
  elevation: unknown,
  escape: (value: string) => string,
): string {
  const label = elevationLabel(elevation);
  return label
    ? `${planHtml}<br><span style="color:#64748b;font-size:12px;font-weight:700;">${escape(label)}</span>`
    : planHtml;
}
