import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sameContactTypes,
  toCompanyContact,
  toCompanyContactMutation,
} from '../src/features/people/services/companyContactRecord.js'

test('company contact records map database fields and list their types in order', () => {
  assert.deepEqual(toCompanyContact({
    id: 41,
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: null,
    office_phone: '+17145550100',
    territory: 'Inland Empire',
    is_active: false,
    person_roles: [{ role: 'ESTIMATOR' }, { role: 'SUPERVISOR' }, { role: 'FOREMAN' }],
  }), {
    id: 41,
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: '',
    officePhone: '+17145550100',
    types: ['SUPERVISOR', 'ESTIMATOR'],
    territory: 'Inland Empire',
    isActive: false,
  })
})

test('company contact mutations normalize values and keep the territory for supervisors only', () => {
  const person = {
    name: '  Lauren Mitchell ',
    email: ' LAUREN@EXAMPLE.COM ',
    phone: '',
    officePhone: ' +17145550100 ',
    territory: ' Inland Empire ',
    isActive: true,
  }

  assert.deepEqual(toCompanyContactMutation({ ...person, types: ['SUPERVISOR'] }), {
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: null,
    office_phone: '+17145550100',
    territory: 'Inland Empire',
    is_active: true,
  })
  assert.equal(toCompanyContactMutation({ ...person, types: ['ESTIMATOR'] }).territory, null)
})

test('contact types are compared without regard to order', () => {
  assert.equal(sameContactTypes(['ESTIMATOR', 'SUPERVISOR'], ['SUPERVISOR', 'ESTIMATOR']), true)
  assert.equal(sameContactTypes(['ESTIMATOR'], ['ESTIMATOR', 'SUPERVISOR']), false)
})
