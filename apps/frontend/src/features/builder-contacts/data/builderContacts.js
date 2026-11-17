// Builder-side contacts: everyone here works for the builder and never signs in
// to the app. The Jobsite Superintendent and the AP Contact are fixed types;
// any other contact carries a type the team typed ("Coordinator", "Land
// Manager"), saved so it can be picked again. Valtrim's own people live in
// features/people as Company Contacts.

export const contactTypeOptions = [
  {
    value: 'JOBSITE_SUPERINTENDENT',
    label: 'Jobsite Superintendent',
    description: 'Runs the jobsite. Signs off on completed work.',
  },
  {
    value: 'AP_CONTACT',
    label: 'AP Contact',
    description: 'Receives the billing package and answers payment questions.',
  },
]

export const OTHER_CONTACT_TYPE = 'OTHER'
export const MAX_CONTACT_TYPE_LENGTH = 60

export const contactTypeLabels = Object.fromEntries(
  contactTypeOptions.map(({ value, label }) => [value, label]),
)

/** Collapses spaces so "Land   manager " and "land manager" are one type. */
export function cleanContactTypeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * The stored type for what was typed: a fixed type when the text is its label,
 * otherwise OTHER with the typed name (to be saved as a custom type).
 */
export function resolveContactType(typeName) {
  const name = cleanContactTypeName(typeName)
  const fixed = contactTypeOptions.find(
    (option) => option.label.toLowerCase() === name.toLowerCase(),
  )
  return fixed
    ? { type: fixed.value, name: fixed.label }
    : { type: OTHER_CONTACT_TYPE, name }
}

export const contactTypeDescriptions = Object.fromEntries(
  contactTypeOptions.map(({ value, description }) => [value, description]),
)

export const emptyContact = {
  name: '',
  // What the contact is: a fixed type's label or any text the team types.
  typeName: 'Jobsite Superintendent',
  builderId: '',
  email: '',
  phone: '',
  officePhone: '',
  notes: '',
  isActive: true,
}

export const initialContacts = [
  {
    id: 1,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 4,
    email: 'daniel.torres@kbhome.com',
    phone: '+19515550184',
    officePhone: '+19515550100',
    notes: '',
  },
  {
    id: 2,
    name: 'Andrea Collins',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 1,
    email: 'a.collins@cityventures.com',
    phone: '+14155550132',
    officePhone: '',
    notes: 'Covers Cedar Grove and the north communities.',
  },
  {
    id: 3,
    name: 'Marcus Webb',
    type: 'AP_CONTACT',
    builderId: 4,
    email: 'ap.riverside@kbhome.com',
    phone: '',
    officePhone: '+19515550177',
    notes: 'Billing goes through Textura, not email.',
  },
  {
    id: 4,
    name: 'Yuki Tanaka',
    type: 'AP_CONTACT',
    builderId: 2,
    email: 'accounts.payable@trumarkhomes.com',
    phone: '',
    officePhone: '+19255550190',
    notes: '',
  },
  {
    id: 5,
    name: 'Olusegun Adeyemi',
    type: 'JOBSITE_SUPERINTENDENT',
    builderId: 3,
    email: 'o.adeyemi@brookfieldrp.com',
    phone: '+17145550146',
    officePhone: '',
    notes: '',
  },
  {
    id: 6,
    name: 'Rebecca Lindqvist',
    type: 'AP_CONTACT',
    builderId: 1,
    email: 'r.lindqvist@cityventures.com',
    phone: '+14155550158',
    officePhone: '+14155550100',
    notes: 'Prefers the payment schedule as Excel.',
  },
].map((contact) => ({
  ...contact,
  typeName: contactTypeLabels[contact.type],
  isActive: true,
}))

/** Every contact type name to offer: the fixed ones, then the ones saved. */
export function contactTypeNames(customTypes = []) {
  const names = contactTypeOptions.map(({ label }) => label)
  for (const { name } of customTypes) {
    if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  }
  return names
}
