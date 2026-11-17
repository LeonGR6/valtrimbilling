// What a person types to add Lots to a Phase: one Lot ("12", "12.1", "12A") or a range of whole
// Lots ("1-5", or "14-10" to go from the highest down). Each one becomes a chip as soon as Enter,
// Space, a comma or a semicolon ends it, and a chip stands for the Lots it expands to, in the order
// they were typed, so "5-1" adds 5, 4, 3, 2, 1.

export const MAX_PHASE_LOTS = 500

// The longest Lot number the database keeps.
const MAX_LOT_LENGTH = 30

const RANGE = /^(\d+)-(\d+)$/u
// A whole Lot, one with a decimal (12.1) or one with letters (12A). It has a number in it, so a word
// that is a typing mistake is not taken for a Lot, and no dash, which makes a range.
const SINGLE_LOT = /^(?=.*\d)[A-Za-z0-9]+(?:\.\d+)?$/u
const ZERO_LOT = /^0+(?:\.0+)?$/u
const DASHES = /\s*[-–—]\s*/gu
const SEPARATORS = /[\s,;]+/u

export const LOT_RANGE_HELP = 'Use a lot such as 12 or 12.1, or a range such as 1-5 or 14-10.'

/**
 * What is typed, with the spaces around a dash taken into the range ("1 - 5" is "1-5") and cut
 * after its last separator: `done` is what the separators have already ended, `rest` what is
 * still being typed. "1-" stays in `rest`, since a range that has no end yet is not finished.
 */
export function splitTypedLots(text) {
  const normalized = String(text ?? '').replace(DASHES, '-')
  const match = normalized.match(/^([\s\S]*[\s,;])([^\s,;]*)$/u)
  if (!match || match[1].trim() === '') return { done: '', rest: normalized.trimStart() }
  return { done: match[1], rest: match[2] }
}

/**
 * The Lots one chip stands for. "1-5" is 1 to 5, "5-1" is 5 down to 1, "12" and "12.1" are one Lot.
 * Returns { success, token, lotNumbers } or { success: false, error }.
 */
export function parseLotToken(value) {
  const token = String(value ?? '').replace(DASHES, '-').trim()
  if (!token) return { success: false, error: 'Enter a lot or a range.' }

  const range = token.match(RANGE)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { success: false, error: 'Use smaller whole lot numbers.' }
    }
    if (start < 1 || end < 1) {
      return { success: false, error: 'Lot numbers must be greater than zero.' }
    }

    const step = start <= end ? 1 : -1
    const count = Math.abs(end - start) + 1
    if (count > MAX_PHASE_LOTS) {
      return { success: false, error: `A phase can contain up to ${MAX_PHASE_LOTS} lots.` }
    }

    return {
      success: true,
      token: `${start}-${end}`,
      lotNumbers: Array.from({ length: count }, (_, index) => String(start + index * step)),
    }
  }

  if (SINGLE_LOT.test(token)) {
    if (token.length > MAX_LOT_LENGTH) {
      return { success: false, error: `A lot number can have up to ${MAX_LOT_LENGTH} characters.` }
    }
    if (ZERO_LOT.test(token)) {
      return { success: false, error: 'Lot numbers must be greater than zero.' }
    }
    const lotNumber = token.toUpperCase()
    return { success: true, token: lotNumber, lotNumbers: [lotNumber] }
  }

  return { success: false, error: `"${token}" is not a lot or a range. ${LOT_RANGE_HELP}` }
}

/** The Lots of every chip, chip after chip, in the order they were typed. */
export function lotNumbersOfRanges(ranges = []) {
  return ranges.flatMap(({ lotNumbers }) => lotNumbers)
}

/**
 * Adds what was typed or pasted (one chip or several, separated by spaces, commas or semicolons)
 * to the chips. A chip already there is not repeated; one that is not a lot or a range, that
 * repeats a Lot, or that does not fit in the Phase is reported instead of added.
 *
 * `existing` are the Lots the Phase already has (upper case) and `capacity` how many more it can take.
 */
export function addLotRanges(current, typed, { existing = new Set(), capacity = MAX_PHASE_LOTS } = {}) {
  const next = [...current]
  const lotOwner = new Map()
  next.forEach(({ token, lotNumbers }) => {
    lotNumbers.forEach((lot) => lotOwner.set(lot, token))
  })
  let total = lotNumbersOfRanges(next).length
  let error = ''

  const candidates = (Array.isArray(typed) ? typed : [typed])
    // Spaces around a dash belong to the range: "1 - 5" is one chip.
    .flatMap((text) => String(text ?? '').replace(DASHES, '-').split(SEPARATORS))
    .map((text) => text.trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    const parsed = parseLotToken(candidate)
    if (!parsed.success) {
      error = parsed.error
      continue
    }
    if (next.some(({ token }) => token === parsed.token)) continue

    const taken = parsed.lotNumbers.find((lot) => existing.has(lot))
    if (taken !== undefined) {
      error = `Lot ${taken} has already been added.`
      continue
    }
    const repeated = parsed.lotNumbers.find((lot) => lotOwner.has(lot))
    if (repeated !== undefined) {
      error = `Lot ${repeated} is already in ${lotOwner.get(repeated)}.`
      continue
    }
    if (total + parsed.lotNumbers.length > capacity) {
      error = capacity <= 0
        ? `A phase can contain up to ${MAX_PHASE_LOTS} lots.`
        : `The phase has room for ${capacity} more lots.`
      continue
    }

    next.push({ token: parsed.token, lotNumbers: parsed.lotNumbers })
    parsed.lotNumbers.forEach((lot) => lotOwner.set(lot, parsed.token))
    total += parsed.lotNumbers.length
  }

  return { ranges: next, error }
}

/**
 * Everything typed in one go ("9-14, 20-25", "14-10 12 12.1") as the Lots it stands for, or the first
 * thing wrong with it. The box adds chip by chip; this is for a whole text at once.
 */
export function parseLotRange(value, maxLots = MAX_PHASE_LOTS) {
  if (String(value ?? '').trim() === '') {
    return { success: false, error: 'Enter one or more lot ranges.' }
  }

  const { ranges, error } = addLotRanges([], value, { capacity: maxLots })
  if (error) return { success: false, error }
  return { success: true, lotNumbers: lotNumbersOfRanges(ranges) }
}

export function removeLotRange(current, token) {
  return current.filter((range) => range.token !== token)
}
