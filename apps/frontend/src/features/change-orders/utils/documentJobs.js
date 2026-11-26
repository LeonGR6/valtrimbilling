// The Documents tab of Extras / Change Orders: the Jobs that have at least one Extra / CO, each with its own.

const byCode = (left, right) => String(left.jobCode).localeCompare(String(right.jobCode), 'en', {
  numeric: true,
  sensitivity: 'base',
})

/**
 * One entry per Job that has Extras / COs or Purchase Order PDFs, ordered by Job number; inside, its
 * Extras / COs newest first (the order the list already comes in) and its PDFs. A Job with PDFs and no
 * Extra / CO yet takes its number, Community and Builder from `jobs`.
 */
export function groupChangeOrdersByJob(orders = [], { poFilesByJob = {}, jobs: catalog = [] } = {}) {
  const jobs = new Map()
  for (const order of orders) {
    const key = String(order.jobId)
    if (!jobs.has(key)) {
      jobs.set(key, {
        jobId: order.jobId,
        jobCode: order.jobCode,
        community: order.community,
        builderId: order.builderId,
        builderName: order.builderName,
        orders: [],
        poFiles: [],
      })
    }
    jobs.get(key).orders.push(order)
  }
  for (const [key, files] of Object.entries(poFilesByJob)) {
    if (!jobs.has(key)) {
      const job = catalog.find((candidate) => String(candidate.id) === key)
      if (!job) continue
      jobs.set(key, {
        jobId: job.id,
        jobCode: job.code,
        community: job.community ?? '',
        builderId: job.builderId,
        builderName: job.builder ?? '',
        orders: [],
        poFiles: [],
      })
    }
    jobs.get(key).poFiles = files
  }
  return [...jobs.values()].sort(byCode)
}

/** Builders of the grouped Jobs, by name, for the Builder filter. */
export function documentJobBuilderOptions(jobs = []) {
  return [...new Map(jobs.map((job) => [String(job.builderId), { id: String(job.builderId), name: job.builderName }]))
    .values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
}

/**
 * Jobs matching the Builder and the words typed: Job number, Builder, Community, or the number / PO / CO #
 * of one of its Extras / COs.
 */
export function filterDocumentJobs(jobs = [], { search = '', builderId = 'ALL' } = {}) {
  const words = String(search).trim().toLowerCase()
  return jobs.filter((job) => {
    if (builderId !== 'ALL' && String(job.builderId) !== String(builderId)) return false
    if (!words) return true
    return [
      job.jobCode,
      job.builderName,
      job.community,
      ...job.orders.flatMap((order) => [order.number, order.poCoNumber, order.internalNumber]),
      ...(job.poFiles ?? []).map((file) => file.name),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(words))
  })
}
