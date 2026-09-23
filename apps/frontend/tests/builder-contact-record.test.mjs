import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toBuilderContact,
  toBuilderContactMutation,
} from '../src/features/builder-contacts/services/builderContactRecord.js'

test('Builder Contact rows are mapped to the catalog model', () => {
  assert.deepEqual(toBuilderContact({
    id: 14,
    builder_id: 3,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    email: 'daniel@example.com',
    phone: null,
    office_phone: '+19515550100',
    notes: null,
    is_active: true,
    created_at: '2026-09-15T10:00:00Z',
    updated_at: '2026-09-15T11:00:00Z',
    builder: { id: 3, code: 'KB', name: 'KB Home' },
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
})

test('Builder Contact form values are normalized for Supabase', () => {
  assert.deepEqual(toBuilderContactMutation({
    builderId: '3',
    name: '  Daniel Torres  ',
    type: 'JOBSITE_SUPERINTENDENT',
    email: '  Daniel@Example.com ',
    phone: '',
    officePhone: '+19515550100',
    notes: '  Prefers SMS  ',
    isActive: true,
  }), {
    builder_id: 3,
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    email: 'daniel@example.com',
    phone: null,
    office_phone: '+19515550100',
    notes: 'Prefers SMS',
    is_active: true,
  })
})
