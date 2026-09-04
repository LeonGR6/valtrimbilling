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

export const initialBuilders = [
  {
    id: 1,
    code: 'CV',
    name: 'City Ventures',
    description: 'Residential builder focused on sustainable communities.',
    address: '444 Spear St, Suite 105\nSan Francisco, CA 94105',
    contactName: 'Emily Carter',
    contactEmail: 'emily.carter@cityventures.com',
    contactPhone: '+14155550128',
    isActive: true,
  },
  {
    id: 2,
    code: 'TRUMARK',
    name: 'Trumark Homes',
    description: 'Homebuilder serving communities throughout California.',
    address: '3001 Bishop Dr, Suite 100\nSan Ramon, CA 94583',
    contactName: 'Michael Reed',
    contactEmail: 'm.reed@trumarkhomes.com',
    contactPhone: '+19255550184',
    isActive: true,
  },
  {
    id: 3,
    code: 'BROOKFIELD',
    name: 'Brookfield Residential',
    description: '',
    address: '3200 Park Center Dr, Suite 1000\nCosta Mesa, CA 92626',
    contactName: 'Sarah Mitchell',
    contactEmail: 's.mitchell@brookfieldrp.com',
    contactPhone: '',
    isActive: true,
  },
  {
    id: 4,
    code: 'KB',
    name: 'KB Home',
    description: 'Homebuilder with communities across the United States.',
    address: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    isActive: true,
  },
].map(withDefaultBuilderDateConfiguration)

export const emptyBuilder = {
  code: '',
  name: '',
  description: '',
  address: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  isActive: true,
}
