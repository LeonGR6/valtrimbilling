// The Builder and Job filters of the suggestion cards above the Packages table (Missed cutoffs, Package
// Suggestions, Retention Suggestions). Every suggestion has a `job` with its code, Builder and community.

const compact = (value) => String(value ?? '').trim().toLowerCase()

/** The Builders the suggestions are for, once each and in order. */
export function suggestionBuilders(suggestions = []) {
  return [...new Set(
    suggestions.map(({ job }) => String(job?.builder ?? '').trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
}

/** What a Job text matches: its code ("1307" or "#1307") or its community. */
function jobMatches(job, text) {
  const wanted = compact(text).replace(/^#/u, '')
  if (!wanted) return true
  return compact(job?.code).includes(wanted) || compact(job?.community).includes(wanted)
}

/**
 * The suggestions of one Builder (empty = every Builder) whose Job code or community has the text (empty =
 * every Job). A Builder that is not in the list any more filters nothing.
 */
export function filterSuggestions(suggestions = [], { builder = '', job = '' } = {}) {
  const chosenBuilder = compact(builder)
  const known = chosenBuilder
    && suggestions.some((suggestion) => compact(suggestion.job?.builder) === chosenBuilder)

  return suggestions.filter((suggestion) => (
    (!known || compact(suggestion.job?.builder) === chosenBuilder)
    && jobMatches(suggestion.job, job)
  ))
}
