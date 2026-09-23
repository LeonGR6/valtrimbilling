import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toBuilderContact,
  toBuilderContactMutation,
} from '../src/features/builder-contacts/services/builderContactRecord.js'

test('builder contact rows map both supported contact types to the frontend model', () => {
  const baseRow = {
    builder_id: 42,
    name: 'Daniel Torres',
    email: 'daniel@example.com',
    phone: null,
    office_phone: '+19515550100',
    notes: null,
    is_active: true,
  }

  const superintendent = toBuilderContact({
    ...baseRow,
    id: 10,
    type: 'JOBSITE_SUPERINTENDENT',
  })
  const apContact = toBuilderContact({
    ...baseRow,
    id: 11,
    type: 'AP_CONTACT',
    is_active: false,
  })

  assert.deepEqual(superintendent, {
    id: 10,
    builderId: 42,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    email: 'daniel@example.com',
    phone: '',
    officePhone: '+19515550100',
    notes: '',
    isActive: true,
  })
  assert.equal(apContact.type, 'AP_CONTACT')
  assert.equal(apContact.isActive, false)
})

test('builder contact mutations expose only writable database fields', () => {
  const mutation = toBuilderContactMutation({
    id: 10,
    builderId: '42',
    name: '  Andrea Collins  ',
    type: 'AP_CONTACT',
    email: ' AP@EXAMPLE.COM ',
    phone: '',
    officePhone: ' +14155550100 ',
    notes: '  Billing contact  ',
    isActive: false,
    createdBy: 'browser-must-not-write-this',
  })

  assert.deepEqual(mutation, {
    builder_id: 42,
    name: 'Andrea Collins',
    type: 'AP_CONTACT',
    email: 'ap@example.com',
    phone: null,
    office_phone: '+14155550100',
    notes: 'Billing contact',
    is_active: false,
  })
})
