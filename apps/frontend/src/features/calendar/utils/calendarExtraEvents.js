// The extra events of a Production activity (install only, baseboard install,
// lock up): events of their own that hang from a stage and can be taken away
// without touching the rest of the activity.

const EXTRA_EVENTS = {
  'install-only': {
    label: 'Install only',
    // EXT and DM each have their own: ext… / dm… fields in the form.
    fields: (stage) => {
      const key = String(stage).toLowerCase()
      return {
        flag: `${key}InstallOnly`,
        date: `${key}InstallDate`,
        owner: `${key}InstallDateOwner`,
        note: `${key}InstallDateNote`,
      }
    },
  },
  'baseboard-install': {
    label: 'Baseboard install',
    fields: () => ({
      flag: 'dmBaseboardInstall',
      date: 'dmBaseboardInstallDate',
      owner: 'dmBaseboardInstallDateOwner',
      note: 'dmBaseboardInstallDateNote',
    }),
  },
  'lock-up': {
    label: 'Lock up',
    fields: () => ({
      flag: 'hwLockUp',
      date: 'hwLockUpDate',
      owner: 'hwLockUpDateOwner',
      note: 'hwLockUpDateNote',
    }),
  },
}

export const EXTRA_EVENT_VARIANTS = Object.keys(EXTRA_EVENTS)

export function isExtraEventVariant(variant) {
  return Object.hasOwn(EXTRA_EVENTS, variant)
}

/** "Install only", "Baseboard install" or "Lock up"; null for any other event. */
export function extraEventLabel(variant) {
  return isExtraEventVariant(variant) ? EXTRA_EVENTS[variant].label : null
}

/**
 * The form values with one extra event switched off, as unchecking it in the
 * form does: its date, owner and note are cleared and nothing else changes.
 * Returns the values untouched for an event that is not an extra one.
 */
export function removeExtraEventFromDraft(draft, variant, stage) {
  if (!isExtraEventVariant(variant)) return draft

  const fields = EXTRA_EVENTS[variant].fields(stage)
  return {
    ...draft,
    [fields.flag]: false,
    [fields.date]: '',
    [fields.owner]: '',
    [fields.note]: '',
  }
}
