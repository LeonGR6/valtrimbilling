// Customer Service keeps requests in memory, but its Builder -> Job ->
// coordinates catalog comes from the existing Supabase-backed providers.

const builderAliasesByCode = Object.freeze({
  BR: ['Brookfield', 'Brookfield Residential'],
  CV: ['City Ventures'],
  KBH: ['KB', 'KB Home', 'KB Homes'],
  MH: ['Melia', 'Melia Homes'],
  TOC: ['Olson Homes', 'The Olson Company'],
  TPIE: [
    'Tri Pointe',
    'Tri Pointe Homes',
    'Tri Pointe Homes Inland Empire',
    'TriPointeHomes',
  ],
})

function normalizeAlias(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/giu, ' ')
    .trim()
    .toLowerCase()
}

function uniqueAliases(primary, aliases = []) {
  const values = [primary, ...aliases].filter(Boolean)
  return [...new Map(values.map((value) => [normalizeAlias(value), value])).values()]
}

function matchingOptions(value, options) {
  const normalized = normalizeAlias(value)
  if (!normalized) return []
  return options.filter((option) => (
    uniqueAliases(option.name ?? option.value, option.aliases)
      .some((alias) => normalizeAlias(alias) === normalized)
  ))
}

function finiteCoordinate(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildCustomerServiceBuilderOptions(builders = [], jobs = []) {
  const activeJobs = jobs.filter((job) => job.isActive !== false)

  return builders
    .filter((builder) => builder.isActive !== false)
    .map((builder) => {
      const builderId = String(builder.id)
      const builderJobs = activeJobs
        .filter((job) => String(job.builderId) === builderId)
        .map((job) => {
          const latitude = finiteCoordinate(job.communityLatitude)
          const longitude = finiteCoordinate(job.communityLongitude)
          return {
            id: String(job.id),
            builderId,
            code: job.code,
            name: job.community,
            value: job.community,
            label: `${job.code} · ${job.community}`,
            aliases: uniqueAliases(job.community, [job.code, ...(job.aliases ?? [])]),
            coordinates: latitude !== null && longitude !== null
              ? { latitude, longitude }
              : null,
          }
        })
        .sort((left, right) => left.label.localeCompare(right.label))

      return {
        builderId,
        value: builder.name,
        label: builder.code ? `${builder.code} · ${builder.name}` : builder.name,
        aliases: uniqueAliases(builder.name, [
          builder.code,
          ...(builderAliasesByCode[builder.code] ?? []),
          ...(builder.aliases ?? []),
        ]),
        jobs: builderJobs,
        communities: builderJobs.map((job) => job.name),
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function resolveCustomerServiceBuilder(value, options = []) {
  const matches = matchingOptions(value, options.map((option) => ({
    ...option,
    name: option.value,
  })))
  return {
    status: !normalizeAlias(value) ? 'EMPTY' : matches.length === 1 ? 'MATCHED' : matches.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
    match: matches.length === 1 ? matches[0] : null,
    matches,
  }
}

export function resolveCustomerServiceJob(
  value,
  builderOption = null,
  options = [],
) {
  const candidates = builderOption
    ? (builderOption.jobs ?? builderOption.communities?.map((name) => ({ value: name, name })) ?? [])
    : options.flatMap((option) => (
      option.jobs ?? option.communities?.map((name) => ({ value: name, name, builderId: option.builderId })) ?? []
    ))
  const matches = matchingOptions(value, candidates.map((option) => ({
    ...option,
    name: option.name ?? option.value,
  })))
  return {
    status: !normalizeAlias(value) ? 'EMPTY' : matches.length === 1 ? 'MATCHED' : matches.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
    match: matches.length === 1 ? matches[0] : null,
    matches,
  }
}

export function customerServiceJobCoordinatesValue(job) {
  const latitude = finiteCoordinate(
    job?.coordinates?.latitude ?? job?.communityLatitude,
  )
  const longitude = finiteCoordinate(
    job?.coordinates?.longitude ?? job?.communityLongitude,
  )
  return latitude !== null && longitude !== null
    ? `${latitude}, ${longitude}`
    : ''
}

export function findCustomerServiceJob(
  { builderName, community, jobId } = {},
  options = [],
) {
  const builder = resolveCustomerServiceBuilder(builderName, options).match
  const builderJobs = builder?.jobs ?? []
  if (jobId) {
    const byId = builderJobs.find((job) => String(job.id) === String(jobId))
    if (byId) return byId
  }
  return resolveCustomerServiceJob(community, builder, options).match
}
