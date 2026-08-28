// Valtrim's own field staff. Builder-side people — jobsite superintendents and
// AP contacts — live in features/builder-contacts instead.
export const personTypeOptions = [
  {
    value: 'SUPERVISOR',
    label: 'Supervisor',
  },
]

export const personTypeLabels = Object.fromEntries(
  personTypeOptions.map(({ value, label }) => [value, label]),
)

export const initialPeople = [
  {
    id: 1,
    name: 'Lauren Mitchell',
    phone: '(714) 555-0162',
    officePhone: '',
    email: 'lauren.mitchell@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Inland Empire',
  },
  {
    id: 2,
    name: 'Robert King',
    phone: '(714) 555-0178',
    officePhone: '(714) 555-0100',
    email: 'robert.king@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Orange County',
  },
  {
    id: 3,
    name: 'Esteban Marquez',
    phone: '(951) 555-0135',
    officePhone: '',
    email: 'esteban.marquez@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'Riverside County',
  },
  {
    id: 4,
    name: 'Nadia Haddad',
    phone: '(909) 555-0191',
    officePhone: '(909) 555-0100',
    email: 'nadia.haddad@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: 'High Desert',
  },
]

export const emptyPerson = {
  name: '',
  phone: '',
  officePhone: '',
  email: '',
  // Supervisor is the only role this screen holds today, so it starts checked.
  types: ['SUPERVISOR'],
  territory: '',
}
