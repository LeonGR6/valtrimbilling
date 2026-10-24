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

/** Whether a new Job can be created: its setup is known and the person confirmed that version. */
export function canCreateWithSetup(setup, confirmedVersionId) {
  return Boolean(setup) && String(confirmedVersionId) === String(setup.id)
}
