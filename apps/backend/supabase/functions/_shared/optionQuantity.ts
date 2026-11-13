// An Option can be on a Lot more than once: one unit for each place it goes (1st floor, 2nd
// floor, ...). The Lot keeps one row per Option with a `quantity` and the `locations`; the emails
// say them next to the Option: "×3 (1st floor, 2nd floor)". Nothing is said for one unit with no
// place, so the emails of Options that were never repeated read exactly as before.

export interface OptionUnits {
  quantity?: number;
  locations?: string[];
}

/** The quantity and places of a `lot_options` row; one unit and no place when the row has none. */
export function optionUnitsOf(row: Record<string, unknown> | null | undefined): Required<OptionUnits> {
  const quantity = Math.trunc(Number(row?.quantity));
  const locations = (Array.isArray(row?.locations) ? row.locations : [])
    .map((place) => String(place ?? "").trim())
    .filter(Boolean);
  return {
    quantity: Number.isFinite(quantity) && quantity >= 1 ? quantity : Math.max(1, locations.length),
    locations,
  };
}

/**
 * What a loader adds to an option of an email: the quantity and places of its `lot_options` row,
 * or nothing for one unit with no place (so an option that was never repeated is unchanged).
 */
export function optionUnitsFields(row: Record<string, unknown> | null | undefined): OptionUnits {
  if (!row) return {};
  const units = optionUnitsOf(row);
  return optionUnitsLabel(units) ? units : {};
}

/** "×3 (1st floor, 2nd floor)", "(Garage)" or "×2"; empty for one unit with no place. */
export function optionUnitsLabel(units: OptionUnits): string {
  const quantity = Math.trunc(Number(units.quantity ?? 1));
  const locations = (units.locations ?? []).map((place) => place.trim()).filter(Boolean);
  return [
    quantity > 1 ? `×${quantity}` : "",
    locations.length > 0 ? `(${locations.join(", ")})` : "",
  ].filter(Boolean).join(" ");
}
