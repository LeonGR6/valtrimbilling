import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toBuilderContact,
  toBuilderContactMutation,
} from '../src/features/builder-contacts/services/builderContactRecord.js'

test('Builder Contact rows are mapped to the catalog model', () => {
  const baseRow = {
    builder_id: 3,
    name: 'Daniel Torres',
    email: 'daniel@example.com',
    phone: null,
    office_phone: '+19515550100',
    notes: null,
    is_active: true,
    created_at: '2026-09-15T10:00:00Z',
    updated_at: '2026-09-15T11:00:00Z',
    builder: { id: 3, code: 'KB', name: 'KB Home' },
  }

  assert.deepEqual(toBuilderContact({
    ...baseRow,
    id: 14,
    type: 'JOBSITE_SUPERINTENDENT',
  }), {
    id: 14,
    builderId: 3,
    builderCode: 'KB',
    builderName: 'KB Home',
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    customTypeId: null,
    typeName: 'Jobsite Superintendent',
    email: 'daniel@example.com',
    phone: '',
    officePhone: '+19515550100',
    notes: '',
    isActive: true,
    createdAt: '2026-09-15T10:00:00Z',
    updatedAt: '2026-09-15T11:00:00Z',
  })

  const apContact = toBuilderContact({
    ...baseRow,
    id: 15,
    type: 'AP_CONTACT',
    is_active: false,
  })
  assert.equal(apContact.type, 'AP_CONTACT')
  assert.equal(apContact.typeName, 'AP Contact')
  assert.equal(apContact.isActive, false)
})

test('Builder Contact form values are normalized for Supabase', () => {
  assert.deepEqual(toBuilderContactMutation({
    id: 10,
<<<<<<< HEAD
    builderId: '42',
    name: '  Andrea Collins  ',
    typeName: 'ap contact',
    email: ' AP@EXAMPLE.COM ',
=======
    builderId: '3',
    name: '  Daniel Torres  ',
    type: 'JOBSITE_SUPERINTENDENT',
    email: '  Daniel@Example.com ',
>>>>>>> dev/leon
    phone: '',
    officePhone: ' +19515550100 ',
    notes: '  Prefers SMS  ',
    isActive: false,
    createdBy: 'browser-must-not-write-this',
<<<<<<< HEAD
  })

  assert.deepEqual(mutation, {
    builder_id: 42,
    name: 'Andrea Collins',
    type: 'AP_CONTACT',
    custom_type_id: null,
    email: 'ap@example.com',
=======
  }), {
    builder_id: 3,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    email: 'daniel@example.com',
>>>>>>> dev/leon
    phone: null,
    office_phone: '+19515550100',
    notes: 'Prefers SMS',
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
