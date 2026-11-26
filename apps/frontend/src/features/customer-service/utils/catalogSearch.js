import { normalizeAlias } from '../data/customerServiceJobCatalog.js'

// The Builder and Project / Job fields of a request are searched as the coordinator types
// (decided 26 Nov 2026), so a long catalog never becomes a long list. Each option is
// { value, label, aliases }: the label carries the code and the name, and the aliases the
// other known names (for Jobs, the names saved from emails). The comparison is the one the
// email import uses: case, accents and punctuation do not matter.
// Options where a word starts with what was typed come first; the catalog order is kept.
export function searchCatalogOptions(options, input) {
  const query = normalizeAlias(input)
  if (!query) return options
  const rank = (option) => {
    const names = [option.label, ...(option.aliases ?? [])].map(normalizeAlias)
    if (names.some((name) => name.startsWith(query) || name.includes(` ${query}`))) return 0
    return names.some((name) => name.includes(query)) ? 1 : -1
  }
  return options
    .map((option, index) => ({ option, index, rank: rank(option) }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.option)
}
