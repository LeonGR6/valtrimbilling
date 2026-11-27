// Shared by the request form and calendar; the final option represents a request
// whose items span more than one of the specific service categories.
import { serviceWorkTypeOptions } from '../utils/customerServicePlanning.js'
export { serviceWorkTypeOptions, multipleServiceWorkType } from '../utils/customerServicePlanning.js'

const legacyWorkTypes = {
  hw: ['Hardware'],
  ws: ['Woodwork'],
  hw_ws: ['Hardware', 'Woodwork'],
  woodwork: ['Woodwork'],
}

export function normalizeServiceWorkTypes(value) {
  const values = Array.isArray(value) ? value : [value]
  const normalized = values.flatMap((type) => {
    if (typeof type !== 'string' || !type.trim()) return []
    const name = type.trim()
    const key = name.toLowerCase()
    // WS historically meant Woodwork. Do not guess a more specific current category.
    if (Object.hasOwn(legacyWorkTypes, key)) return legacyWorkTypes[key]
    const option = serviceWorkTypeOptions.find((item) => item.value.toLowerCase() === key)
    return [option?.value ?? name]
  })

  return [...new Set(normalized)]
}
