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
  assert.equal(apContact.isActive, false)
})

test('Builder Contact form values are normalized for Supabase', () => {
  assert.deepEqual(toBuilderContactMutation({
    id: 10,
    builderId: '3',
    name: '  Daniel Torres  ',
    type: 'JOBSITE_SUPERINTENDENT',
    email: '  Daniel@Example.com ',
    phone: '',
    officePhone: ' +19515550100 ',
    notes: '  Prefers SMS  ',
    isActive: false,
    createdBy: 'browser-must-not-write-this',
  }), {
    builder_id: 3,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    email: 'daniel@example.com',
    phone: null,
    office_phone: '+19515550100',
    notes: 'Prefers SMS',
    is_active: false,
  })
})
