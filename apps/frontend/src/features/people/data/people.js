export const personTypeOptions = [
  {
    value: 'JOBSITE_SUPERINTENDENT',
    label: 'Jobsite Superintendent',
  },
  {
    value: 'SUPERVISOR',
    label: 'Supervisor',
  },
  {
    value: 'AP_CONTACT',
    label: 'AP Contact',
  },
]

export const personTypeLabels = Object.fromEntries(
  personTypeOptions.map(({ value, label }) => [value, label]),
)

export const initialPeople = [
  {
    id: 1,
    name: 'Daniel Torres',
    phone: '(951) 555-0184',
    officePhone: '(951) 555-0100',
    email: 'daniel.torres@kbhome.com',
    types: ['JOBSITE_SUPERINTENDENT'],
  },
  {
    id: 2,
    name: 'Lauren Mitchell',
    phone: '(714) 555-0162',
    officePhone: '',
    email: 'lauren.mitchell@valtriminc.com',
    types: ['SUPERVISOR'],
  },
  {
    id: 3,
    name: 'Andrea Collins',
    phone: '(949) 555-0146',
    officePhone: '(949) 555-0110',
    email: 'ap@cityventures.com',
    types: ['AP_CONTACT'],
  },
]

export const emptyPerson = {
  name: '',
  phone: '',
  officePhone: '',
  email: '',
  types: [],
}
