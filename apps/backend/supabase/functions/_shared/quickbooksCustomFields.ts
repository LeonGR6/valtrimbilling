// QuickBooks Online invoices can carry up to three text "custom fields". Their
// names are set in the QuickBooks settings (Sales > Custom fields) and exposed
// through Preferences; an invoice fills them by DefinitionId (1, 2 or 3).
// This reads those definitions and fills "Job Name" and "Job #" when the
// company has them, saying so when it cannot.

// QuickBooks limits a custom field value to 31 characters (from Intuit's API
// reference, not verified against the live API); longer values are cut and
// reported instead of risking the whole invoice being rejected.
export const CUSTOM_FIELD_MAX_LENGTH = 31

export interface CustomFieldDefinition {
  definitionId: string
  label: string
  enabled: boolean
}

export interface InvoiceCustomField {
  definitionId: string
  name: string
  value: string
}

type PreferenceEntry = { Name?: unknown; StringValue?: unknown; BooleanValue?: unknown }

// Preferences nest the entries in groups and QuickBooks does not promise their
// order, so every entry is collected and matched by its Name.
function collectEntries(node: unknown, found: PreferenceEntry[] = []): PreferenceEntry[] {
  if (Array.isArray(node)) {
    for (const item of node) collectEntries(item, found)
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (typeof record.Name === 'string') found.push(record as PreferenceEntry)
    if ('CustomField' in record) collectEntries(record.CustomField, found)
  }
  return found
}

/** Reads the custom field definitions from a QuickBooks `preferences` response. */
export function parseCustomFieldDefinitions(body: unknown): CustomFieldDefinition[] {
  const prefs = (body as { Preferences?: { SalesFormsPrefs?: { CustomField?: unknown } } } | null)
    ?.Preferences?.SalesFormsPrefs
  const entries = collectEntries(prefs?.CustomField)

  const labels = new Map<string, string>()
  const flags = new Map<string, boolean>()
  for (const entry of entries) {
    const name = String(entry.Name)
    const label = /^SalesFormsPrefs\.SalesCustomName(\d)$/u.exec(name)
    const flag = /^SalesFormsPrefs\.UseSalesCustom(\d)$/u.exec(name)
    if (label && typeof entry.StringValue === 'string' && entry.StringValue.trim()) {
      labels.set(label[1], entry.StringValue.trim())
    }
    if (flag && typeof entry.BooleanValue === 'boolean') flags.set(flag[1], entry.BooleanValue)
  }

  return [...labels.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([definitionId, label]) => ({
      definitionId,
      label,
      // A label with no on/off entry is treated as on.
      enabled: flags.get(definitionId) ?? true,
    }))
}

/** "Job #" -> "job number"; a trailing "(Community)" note is ignored. */
export function normalizeCustomFieldLabel(label: string) {
  return label
    .replace(/\([^)]*\)/gu, ' ')
    .replaceAll('#', ' number ')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

const JOB_NAME_LABEL = /^job ?name$/u
const JOB_NUMBER_LABEL = /^job ?(number|no\.?|num)$/u

export interface JobCustomFieldValues {
  jobName: string | null
  jobNumber: string | null
}

export function matchJobCustomFields(
  definitions: CustomFieldDefinition[],
  values: JobCustomFieldValues,
): { fields: InvoiceCustomField[]; warnings: string[] } {
  const wanted = [
    { title: 'Job Name', pattern: JOB_NAME_LABEL, value: values.jobName },
    { title: 'Job #', pattern: JOB_NUMBER_LABEL, value: values.jobNumber },
  ]

  const fields: InvoiceCustomField[] = []
  const warnings: string[] = []

  for (const { title, pattern, value } of wanted) {
    const definition = definitions.find(({ label }) => pattern.test(normalizeCustomFieldLabel(label)))

    if (!definition) {
      warnings.push(
        `QuickBooks has no "${title}" custom field, so it was left empty. `
          + 'Create it in QuickBooks under Sales > Custom fields.',
      )
      continue
    }
    if (!definition.enabled) {
      warnings.push(`The QuickBooks custom field "${definition.label}" is turned off, so it was left empty.`)
      continue
    }

    const text = value?.trim()
    if (!text) {
      warnings.push(`The Job has no ${title === 'Job #' ? 'number' : 'community'}, so "${definition.label}" was left empty.`)
      continue
    }

    const cut = Array.from(text).slice(0, CUSTOM_FIELD_MAX_LENGTH).join('')
    if (cut !== text) {
      warnings.push(`"${definition.label}" was shortened to ${CUSTOM_FIELD_MAX_LENGTH} characters, the QuickBooks limit.`)
    }
    fields.push({ definitionId: definition.definitionId, name: definition.label, value: cut })
  }

  return { fields, warnings }
}
