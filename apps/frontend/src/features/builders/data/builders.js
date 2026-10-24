export const defaultBuilderDateConfiguration = Object.freeze({
  extToDmWeeks: 4,
  shutterBeforeDmWeeks: 1,
  dmToHwWeeks: 1,
})

function normalizeWeekSpacing(value, fallback) {
  const weeks = Number(value)
  return Number.isInteger(weeks) && weeks >= 0 && weeks <= 52 ? weeks : fallback
}

function normalizeShutterWeekSpacing(value) {
  const weeks = Number(value)
  return Number.isInteger(weeks) && weeks >= 1 && weeks <= 52
    ? weeks
    : defaultBuilderDateConfiguration.shutterBeforeDmWeeks
}

export function normalizeBuilderDateConfiguration(configuration = {}) {
  return {
    extToDmWeeks: normalizeWeekSpacing(
      configuration.extToDmWeeks,
      defaultBuilderDateConfiguration.extToDmWeeks,
    ),
    shutterBeforeDmWeeks: normalizeShutterWeekSpacing(configuration.shutterBeforeDmWeeks),
    dmToHwWeeks: normalizeWeekSpacing(
      configuration.dmToHwWeeks,
      defaultBuilderDateConfiguration.dmToHwWeeks,
    ),
  }
}

export function getBuilderDateConfiguration(builder) {
  return normalizeBuilderDateConfiguration(builder?.calendarDateConfiguration)
}

export function withDefaultBuilderDateConfiguration(builder) {
  return {
    ...builder,
    calendarDateConfiguration: getBuilderDateConfiguration(builder),
  }
}

export function toBuilderDateConfigurationRpc(builderId, configuration) {
  const normalized = normalizeBuilderDateConfiguration(configuration)
  return {
    p_builder_id: Number(builderId),
    p_ext_to_dm_weeks: normalized.extToDmWeeks,
    p_shutter_before_dm_weeks: normalized.shutterBeforeDmWeeks,
    p_dm_to_hw_weeks: normalized.dmToHwWeeks,
  }
}

export const emptyBuilder = {
  code: '',
  name: '',
  description: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'US',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  isActive: true,
  // Other contacts added while the builder is created.
  contacts: [],
}

export const builderCountries = Object.freeze([
  { value: 'US', label: 'United States' },
  { value: 'MX', label: 'Mexico' },
])

/** The address as lines of text: the street lines, then "City, ST 12345". */
export function formatBuilderAddress(builder) {
  const region = [builder?.state, builder?.zipCode].filter(Boolean).join(' ')
  const place = [builder?.city, region].filter(Boolean).join(', ')
  return [builder?.addressLine1, builder?.addressLine2, place].filter(Boolean).join('\n')
}
