// The Data API returns at most 1000 rows per request, however many match: a list that grows past it
// loses its last rows (the newest, when ordered by id) without any error. Lists that can grow read
// every page; a filter on a list of ids goes in batches so the request stays short.

export const PAGE_SIZE = 1000
export const FILTER_BATCH_SIZE = 200

/** The values in groups of at most `size`, for an `in` filter. */
export function inBatches(values, size = FILTER_BATCH_SIZE) {
  const batches = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

/**
 * Every row of a query, page by page. `queryFactory` returns a new query each time (a query cannot be
 * reused) and must be ordered by something unique, so the pages do not overlap; `onError` is called
 * with the error a page returns, and is expected to throw.
 */
export async function listAllRows(queryFactory, onError, pageSize = PAGE_SIZE) {
  const rows = []
  let start = 0

  while (true) {
    const { data, error } = await queryFactory().range(start, start + pageSize - 1)
    if (error) {
      onError(error)
      return rows
    }

    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
    start += pageSize
  }
}

/** Every row of a query that filters on a list of ids: one batch after another, each in full. */
export async function listAllRowsByIds(ids, queryFactory, onError, pageSize = PAGE_SIZE) {
  const rows = []
  for (const batch of inBatches(ids)) {
    rows.push(...await listAllRows(() => queryFactory(batch), onError, pageSize))
  }
  return rows
}
