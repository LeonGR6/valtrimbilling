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
    customTypeId: null,
    typeName: 'Jobsite Superintendent',
    email: 'daniel@example.com',
    phone: '',
    officePhone: '+19515550100',
    notes: '',
    isActive: true,
  })
  assert.equal(apContact.type, 'AP_CONTACT')
  assert.equal(apContact.typeName, 'AP Contact')
  assert.equal(apContact.isActive, false)
})

test('builder contact mutations expose only writable database fields', () => {
  const mutation = toBuilderContactMutation({
    id: 10,
    builderId: '42',
    name: '  Andrea Collins  ',
    typeName: 'ap contact',
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
    custom_type_id: null,
    email: 'ap@example.com',
    phone: null,
    office_phone: '+14155550100',
    notes: 'Billing contact',
    is_active: false,
  })
})

test('a contact whose type was typed is stored as OTHER with the saved type', () => {
  const row = {
    id: 12,
    builder_id: 42,
    name: 'Sam Rivera',
    type: 'OTHER',
    custom_type_id: 7,
    builder_contact_types: { name: 'Land Manager' },
    email: 'sam@example.com',
    phone: null,
    office_phone: null,
    notes: null,
    is_active: true,
  }

  const contact = toBuilderContact(row)
  assert.equal(contact.type, 'OTHER')
  assert.equal(contact.customTypeId, 7)
  assert.equal(contact.typeName, 'Land Manager')

  const mutation = toBuilderContactMutation(
    { ...contact, typeName: ' land   manager ', isActive: true },
    7,
  )
  assert.equal(mutation.type, 'OTHER')
  assert.equal(mutation.custom_type_id, 7)

  // A fixed type never carries a saved type, even if one is passed.
  assert.equal(
    toBuilderContactMutation({ ...contact, typeName: 'AP contact' }, 7).custom_type_id,
    null,
  )
})
