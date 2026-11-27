// Options are listed by code, A to Z, wherever they appear: in Plans & options, Pricing, the
// Sequence Sheet and the Packages. The comparison ignores case, so "bb110" sits with "BB110".
const codeCollator = new Intl.Collator('en', { sensitivity: 'base' })

export function compareOptionCodes(left, right) {
  return codeCollator.compare(String(left ?? '').trim(), String(right ?? '').trim())
}

/**
 * A copy of `options` ordered by code. Options with the same code keep the order they came in.
 * `codeOf` reads the code of an item that does not call it `code` (a package line has `optionCode`).
 */
export function sortOptionsByCode(options = [], codeOf = (option) => option.code) {
  return [...options].sort((left, right) => compareOptionCodes(codeOf(left), codeOf(right)))
}
