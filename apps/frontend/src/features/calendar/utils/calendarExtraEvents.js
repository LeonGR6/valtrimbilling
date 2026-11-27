// The extra events of a Production activity (Shutter, install only, baseboard install,
// lock up, weatherstripping): events of their own that hang from a stage and can be taken away
// without touching the rest of the activity. EXT, DM and HW are not: they go together, and only
// deleting the whole activity takes them away.

const EXTRA_EVENTS = {
  // The Shutter hangs from DM (its "Shutter" option); it is a stage of its own, not a variant.
  shutter: {
    label: 'Shutter',
    parentStage: 'DM',
    fields: () => ({
      flag: 'dmShutters',
      date: 'shutterDate',
      owner: 'shutterDateOwner',
      note: 'shutterDateNote',
      confirmed: 'shutterConfirmed',
    }),
  },
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
        confirmed: `${key}InstallConfirmed`,
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
      confirmed: 'dmBaseboardInstallConfirmed',
    }),
  },
  'lock-up': {
    label: 'Lock up',
    fields: () => ({
      flag: 'hwLockUp',
      date: 'hwLockUpDate',
      owner: 'hwLockUpDateOwner',
      note: 'hwLockUpDateNote',
      confirmed: 'hwLockUpConfirmed',
    }),
  },
  weatherstripping: {
    label: 'Weatherstripping',
    fields: () => ({
      flag: 'hwWeatherstripping',
      date: 'hwWeatherstrippingDate',
      owner: 'hwWeatherstrippingDateOwner',
      note: 'hwWeatherstrippingDateNote',
      confirmed: 'hwWeatherstrippingConfirmed',
    }),
  },
}

export const EXTRA_EVENT_VARIANTS = Object.keys(EXTRA_EVENTS)

export function isExtraEventVariant(variant) {
  return Object.hasOwn(EXTRA_EVENTS, variant)
}

/**
 * Which extra event a Calendar event is ('shutter', 'install-only', …), from its `extendedProps`;
 * null for EXT, DM and HW themselves.
 */
export function extraEventKey(props) {
  if (props?.activityType === 'SHUTTER') return 'shutter'
  return props?.variant !== 'shutter' && isExtraEventVariant(props?.variant) ? props.variant : null
}

/** The stage whose event is shown once an extra event is taken away: DM for the Shutter, else its own. */
export function extraEventParentStage(props) {
  const key = extraEventKey(props)
  return (key && EXTRA_EVENTS[key].parentStage) || props?.activityType
}

/** "Shutter", "Install only", "Baseboard install", "Lock up" or "Weatherstripping"; null for any other. */
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
    [fields.confirmed]: false,
  }
}
