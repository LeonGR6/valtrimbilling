import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toSupervisor,
  toSupervisorMutation,
} from '../src/features/people/services/supervisorRecord.js'

test('supervisor records map database fields into the shared People shape', () => {
  assert.deepEqual(toSupervisor({
    id: 41,
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: null,
    office_phone: '+17145550100',
    territory: 'Inland Empire',
    is_active: false,
  }), {
    id: 41,
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: '',
    officePhone: '+17145550100',
    types: ['SUPERVISOR'],
    territory: 'Inland Empire',
    isActive: false,
  })
})

test('supervisor mutations normalize values and include only writable columns', () => {
  assert.deepEqual(toSupervisorMutation({
    name: '  Lauren Mitchell ',
    email: ' LAUREN@EXAMPLE.COM ',
    phone: '',
    officePhone: ' +17145550100 ',
    territory: ' Inland Empire ',
    isActive: true,
  }), {
    name: 'Lauren Mitchell',
    email: 'lauren@example.com',
    phone: null,
    office_phone: '+17145550100',
    territory: 'Inland Empire',
    is_active: true,
  })
})
