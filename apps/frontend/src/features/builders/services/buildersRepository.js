import { requireSupabase } from '../../../services/api.js'
import {
  defaultBuilderDateConfiguration,
  normalizeBuilderDateConfiguration,
} from '../data/builders.js'

const BUILDER_COLUMNS = [
  'id',
  'code',
  'name',
  'description',
  'address',
  'contact_name',
  'contact_email',
  'contact_phone',
  'is_active',
  'ext_to_dm_weeks',
  'shutter_before_dm_weeks',
  'dm_to_hw_weeks',
].join(', ')

function optionalValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : value
  return normalized || null
}

function toCatalogMutation(builder) {
  return {
    code: builder.code.trim().toUpperCase(),
    name: builder.name.trim(),
    description: optionalValue(builder.description),
    address: optionalValue(builder.address),
    contact_name: optionalValue(builder.contactName),
    contact_email: optionalValue(builder.contactEmail),
    contact_phone: optionalValue(builder.contactPhone),
    is_active: builder.isActive,
  }
}

function toBuilder(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    address: row.address ?? '',
    contactName: row.contact_name ?? '',
    contactEmail: row.contact_email ?? '',
    contactPhone: row.contact_phone ?? '',
    isActive: row.is_active,
    calendarDateConfiguration: normalizeBuilderDateConfiguration({
      extToDmWeeks: row.ext_to_dm_weeks,
      shutterBeforeDmWeeks: row.shutter_before_dm_weeks,
      dmToHwWeeks: row.dm_to_hw_weeks,
    }),
  }
}

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A builder with that code or name already exists.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change builders.', { cause: error })
  }

  throw new Error(error.message || 'The builders request failed.', { cause: error })
}

export async function listBuilders() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builders')
    .select(BUILDER_COLUMNS)
    .order('name', { ascending: true })

  throwRepositoryError(error)
  return data.map(toBuilder)
}

export async function createBuilder(builder) {
  const client = await requireSupabase()
  const configuration = normalizeBuilderDateConfiguration(
    builder.calendarDateConfiguration ?? defaultBuilderDateConfiguration,
  )
  const { data, error } = await client
    .from('builders')
    .insert({
      ...toCatalogMutation(builder),
      ext_to_dm_weeks: configuration.extToDmWeeks,
      shutter_before_dm_weeks: configuration.shutterBeforeDmWeeks,
      dm_to_hw_weeks: configuration.dmToHwWeeks,
    })
    .select(BUILDER_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilder(data)
}

export async function updateBuilder(builderId, builder) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builders')
    .update(toCatalogMutation(builder))
    .eq('id', builderId)
    .select(BUILDER_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilder(data)
}

export async function deactivateBuilder(builderId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builders')
    .update({ is_active: false })
    .eq('id', builderId)
    .select(BUILDER_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilder(data)
}

export async function updateBuilderDateConfiguration(builderId, configuration) {
  const client = await requireSupabase()
  const normalized = normalizeBuilderDateConfiguration(configuration)
  const { data, error } = await client
    .from('builders')
    .update({
      ext_to_dm_weeks: normalized.extToDmWeeks,
      shutter_before_dm_weeks: normalized.shutterBeforeDmWeeks,
      dm_to_hw_weeks: normalized.dmToHwWeeks,
    })
    .eq('id', builderId)
    .select(BUILDER_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilder(data)
}
