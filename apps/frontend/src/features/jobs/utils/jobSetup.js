// Which billing setup a Job is, or is about to be, under. Pure.
//
// A new Job takes the ACTIVE version of its Builder's setup at the moment it is saved. An existing
// Job keeps the version it was created with, even after the Builder's setup changes, unless its
// Builder changes (then it takes the new Builder's active version).

/**
 * `{ setup, source }` for what to show:
 *  - `builder`: the Builder's active version (a new Job, or a Job moved to another Builder),
 *  - `job`: the version the Job already has,
 *  - `none`: nothing to show (no active setup yet, or the version is not loaded).
 * `newerBuilderSetup` is the Builder's active version when it is newer than the Job's own.
 */
export function resolveJobSetup({ job, builderId, builderSetups = [], jobSetups = [] }) {
  const builderSetup = builderSetups.find(
    (setup) => String(setup.builderId) === String(builderId),
  ) ?? null

  const keepsOwnVersion = Boolean(job)
    && String(job.builderId) === String(builderId)
    && job.billingSetupVersionId != null
  if (keepsOwnVersion) {
    const own = jobSetups.find((setup) => String(setup.id) === String(job.billingSetupVersionId)) ?? null
    return {
      setup: own,
      source: own ? 'job' : 'none',
      newerBuilderSetup: own && builderSetup && builderSetup.id !== own.id ? builderSetup : null,
    }
  }

  return { setup: builderSetup, source: builderSetup ? 'builder' : 'none', newerBuilderSetup: null }
}

/**
 * What to tell the person when a Job has Options but its setup does not say in which Draw they are
 * billed: no Package would charge them. Null when there is nothing to warn about (no Options, no
 * setup to read, or the setup already names the Draw).
 */
export function describeMissingOptionsBilling({ setup, newerBuilderSetup = null, optionCount = 0 }) {
  if (!setup || !(optionCount > 0) || setup.optionsBillingDrawIndex != null) return null

  const lead = `The billing setup this Job uses (version ${setup.versionNumber}) does not say in which Draw the options are billed, so no Package will charge them.`
  if (newerBuilderSetup && newerBuilderSetup.optionsBillingDrawIndex != null) {
    return `${lead} The Builder's current setup (version ${newerBuilderSetup.versionNumber}) does: use Change setup on this Job to move it there.`
  }

  return `${lead} Choose the Draw that bills Options in the Builder's setup, then use Change setup on this Job to move it to the new version.`
}

/** Whether a new Job can be created: its setup is known and the person confirmed that version. */
export function canCreateWithSetup(setup, confirmedVersionId) {
  return Boolean(setup) && String(confirmedVersionId) === String(setup.id)
}
