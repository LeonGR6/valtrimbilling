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

/** How many batches of ids are read at the same time. */
export const FILTER_CONCURRENCY = 6

// `mapper` over `items`, at most `limit` at a time, the results in the order of `items`. After a
// failure no further item is started.
async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let next = 0
  let failed = false

  const work = async () => {
    while (!failed && next < items.length) {
      const index = next
      next += 1
      try {
        results[index] = await mapper(items[index])
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work))
  return results
}

/**
 * Every row of a query that filters on a list of ids: the ids go in batches, a few at a time, each
 * batch read in full. The rows come back batch after batch in the order of `ids`, whatever the
 * order the batches finished in.
 */
export async function listAllRowsByIds(
  ids,
  queryFactory,
  onError,
  pageSize = PAGE_SIZE,
  concurrency = FILTER_CONCURRENCY,
) {
  const batches = await mapWithLimit(
    inBatches(ids),
    concurrency,
    (batch) => listAllRows(() => queryFactory(batch), onError, pageSize),
  )
  return batches.flat()
}
