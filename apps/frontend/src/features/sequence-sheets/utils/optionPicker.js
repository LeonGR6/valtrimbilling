// Picking the Options of a Lot from a Plan that can have dozens of them: finding
// the ones wanted and selecting or clearing many at once. Pure; the screen is in
// LotOptionPicker.

/**
 * An Option with no price yet (a number or NA) cannot be added to a Phase: it
 * would have nothing to bill. One already on the Lot stays, so it can be removed.
 */
export function isOptionMissingPrice(option) {
  return 'price' in option && option.price == null
}

/** The Options whose code or description contains every word typed (any case). */
export function filterPickerOptions(options, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return options

  return options.filter((option) => {
    const text = `${option.code} ${option.description ?? ''}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/** What is shown: the search result, or only the selected ones of it. */
export function shownPickerOptions(options, { query = '', selectedOnly = false, selectedIds = [] } = {}) {
  const selected = new Set(selectedIds)
  const found = filterPickerOptions(options, query)
  return selectedOnly ? found.filter((option) => selected.has(option.id)) : found
}

/** The selection after ticking every shown Option that has a price, keeping what was already picked. */
export function selectShown(selectedIds, shown) {
  const next = new Set(selectedIds)
  shown.forEach((option) => {
    if (!isOptionMissingPrice(option)) next.add(option.id)
  })
  return [...next]
}

/** The selection after clearing only the shown Options: the hidden ones stay picked. */
export function clearShown(selectedIds, shown) {
  const hidden = new Set(shown.map((option) => option.id))
  return selectedIds.filter((id) => !hidden.has(id))
}

export function toggleOption(selectedIds, optionId, checked) {
  const without = selectedIds.filter((id) => id !== optionId)
  return checked ? [...without, optionId] : without
}
