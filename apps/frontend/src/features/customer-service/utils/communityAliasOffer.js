import { normalizeAlias, resolveCustomerServiceBuilder } from '../data/customerServiceJobCatalog.js'

// Remembering the community an email named (decided 26 Nov 2026). When an email says
// "KB Rancho Madrina" and the coordinator links the request to Job "Rancho Madrina", the
// review offers to save that name so the next email links by itself. It is saved only when
// she checks the box, never for a generic name, never when another Job of the same Builder
// already answers to it, and only for the Builder the source named (or when it named none).

export const minimumCommunityAliasLength = 4
export const maximumCommunityAliasLength = 120

// Words that name a part of a community, or nothing, never the community itself.
const genericWords = new Set([
  'a', 'and', 'at', 'bldg', 'building', 'community', 'home', 'homes', 'job', 'lot', 'lots',
  'model', 'n', 'na', 'new', 'none', 'null', 'of', 'ph', 'phase', 'plan', 'plans', 'project',
  'site', 'tba', 'tbd', 'test', 'the', 'tract', 'unit', 'units', 'unknown',
])

// "Phase 4", "N/A", "Lot 12", a street address, a ZIP code or the Builder's own name
// would link unrelated emails to one Job, so they are never offered. `key` is normalized.
export function isGenericCommunityName(key, builderOption = null) {
  if (key.length < minimumCommunityAliasLength || !/[a-z]/u.test(key)) return true
  const words = key.split(' ')
  if (words.every((word) => genericWords.has(word) || /^\d+[a-z]?$/u.test(word))) return true
  // A street address starts with the house number ("1520 Rancho Madrina Way").
  if (words.length > 1 && /^\d+$/u.test(words[0])) return true
  if (words.some((word) => /^\d{5}$/u.test(word))) return true
  return (builderOption?.aliases ?? []).some((name) => normalizeAlias(name) === key)
}

// The source named no Builder, or the one the coordinator chose. A Builder the catalog does
// not recognize, or recognizes as two, cannot be confirmed, so it does not count.
// Ex.: CS-3572's email names KB Home, so its community is never offered for a Brookfield Job.
export function isSourceBuilder(sourceBuilderName, builderOption, builderOptions = []) {
  if (!normalizeAlias(sourceBuilderName)) return true
  const { match } = resolveCustomerServiceBuilder(sourceBuilderName, builderOptions)
  return Boolean(match) && String(match.builderId) === String(builderOption?.builderId)
}

// What the review offers once a Job is chosen for the community the email or PDF named:
// - null: nothing (no name or Job, another Builder's name, a name the Job already has, or a
//   generic name);
// - { status: 'OFFER', name, key }: the name can be remembered for this Job;
// - { status: 'TAKEN', name, otherJobs }: another Job of the Builder already has that name.
export function communityAliasOffer({ extractedName, sourceBuilderName = '', builderOption, builderOptions = [], job }) {
  const name = String(extractedName ?? '').trim().replace(/\s+/gu, ' ')
  const key = normalizeAlias(name)
  if (!key || !builderOption || !job || name.length > maximumCommunityAliasLength) return null
  if (!isSourceBuilder(sourceBuilderName, builderOption, builderOptions)) return null
  const answersTo = (candidate) => (candidate.aliases ?? []).some((alias) => normalizeAlias(alias) === key)
  if (answersTo(job) || isGenericCommunityName(key, builderOption)) return null
  const otherJobs = (builderOption.jobs ?? [])
    .filter((other) => String(other.id) !== String(job.id) && answersTo(other))
  return otherJobs.length ? { status: 'TAKEN', name, otherJobs } : { status: 'OFFER', name, key }
}

// The community and Builder the source named: the email import's combined values (the PDF
// wins) when the request came from an email, else the PDF or pasted text analyzed in New
// Request. Both come from the same source; the Builder falls back to the document issuer,
// as the import matches it.
export function extractedSourceProperty({ imported = null, extraction = null } = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const importedCommunity = text(imported?.communityName)
  if (importedCommunity) return { communityName: importedCommunity, builderName: text(imported?.builderName) }
  const data = extraction?.structuredData
  return {
    communityName: text(data?.property?.communityName),
    builderName: text(data?.property?.builderName) || text(data?.document?.issuerName),
  }
}
