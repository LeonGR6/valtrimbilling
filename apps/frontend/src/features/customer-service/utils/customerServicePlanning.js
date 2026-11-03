// Keep the deployable pure module with the Edge Functions; Vite bundles the
// same file for the browser. This facade has no backend runtime dependency.
export * from '../../../../../backend/supabase/functions/_shared/customerServicePlanning.mjs'
import {
  calculateGeneralFixDuration,
  hasPlanningValue,
  planningForTask,
  suggestRequestPlanning,
} from '../../../../../backend/supabase/functions/_shared/customerServicePlanning.mjs'

const normalized = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

// Only propose missing fields in the current editable scope. Source metadata is
// used only for a unique matching description, never by selecting the first row.
export function missingRequestPlanningValues(values, sourceItems = []) {
  if (!Array.isArray(sourceItems)) sourceItems = []
  const included = (values.requestedWorkItems ?? []).filter((item) => normalized(item.description))
  if (!included.length) return {}
  const items = included.map((item) => {
    const matches = sourceItems.filter((source) => source.assignedToValtrim !== false && [
      source.description,
      [...new Set([source.location, source.description, source.requestedAction].filter(Boolean))].join(' — '),
    ].some((description) => normalized(description) === normalized(item.description)))
    const source = matches.length === 1 ? matches[0] : {}
    return {
      ...source,
      description: item.description,
      suggestedServiceKind: values.serviceKind || source.suggestedServiceKind,
      suggestedWorkType: values.workType || source.suggestedWorkType,
      suggestedServiceTask: values.serviceTask || source.suggestedServiceTask,
    }
  })
  const proposed = suggestRequestPlanning(items)
  const patch = {}
  for (const field of ['serviceKind', 'workType', 'serviceTask']) {
    if (!hasPlanningValue(values[field]) && proposed[field]) patch[field] = proposed[field]
  }
  const task = hasPlanningValue(values.serviceTask) ? values.serviceTask : proposed.serviceTask
  const planning = planningForTask(task, included.length)
  for (const field of ['estimatedDurationMinutes', 'crewSize']) {
    if (!hasPlanningValue(values[field]) && planning[field] !== null) patch[field] = planning[field]
  }
  return patch
}

export function hasCustomGeneralFixDuration(values) {
  return values.serviceTask === 'GENERAL_FIX' && hasPlanningValue(values.estimatedDurationMinutes)
    && Number(values.estimatedDurationMinutes) !== calculateGeneralFixDuration(
      (values.requestedWorkItems ?? []).filter((item) => normalized(item.description)).length,
    )
}
