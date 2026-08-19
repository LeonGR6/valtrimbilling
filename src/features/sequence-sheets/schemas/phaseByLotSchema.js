import { z } from 'zod'
import {
  normalizeBuildingCode,
  normalizePhaseCode,
} from '../utils/phaseBuildingCodes.js'

function normalized(value) {
  return value.trim().toLocaleUpperCase()
}

const phaseCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter a phase number or code.')
  .max(100, 'Use 100 characters or fewer.')
  .transform(normalizePhaseCode)
  .refine((value) => value.length > 0, 'Enter a phase number or code.')

const buildingCodeSchema = z
  .string()
  .trim()
  .min(1, 'Enter a building number or code.')
  .max(50, 'Use 50 characters or fewer.')
  .transform(normalizeBuildingCode)
  .refine((value) => value.length > 0, 'Enter a building number or code.')

const lotAssignmentSchema = z.object({
  lotNumber: z
    .string()
    .trim()
    .min(1, 'Enter a lot number.')
    .max(30, 'Use 30 characters or fewer.')
    .transform((value) => value.toUpperCase()),
  planId: z.coerce.number().int().positive('Select a plan.'),
  reverse: z.boolean(),
  optionIds: z.array(z.coerce.number().int().positive()),
})

export function createPhaseByLotSchema(job) {
  const phases = job.sequenceSheet?.phases ?? []
  const plans = job.sequenceSheet?.plans ?? []

  return z
    .object({
      phaseName: phaseCodeSchema,
      building: buildingCodeSchema,
      lots: z
        .array(lotAssignmentSchema)
        .min(1, 'Add at least one lot.')
        .max(500, 'A phase can contain up to 500 lots.'),
    })
    .superRefine((data, context) => {
      if (
        phases.some(
          (phase) =>
            normalizePhaseCode(phase.name) === normalizePhaseCode(data.phaseName),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['phaseName'],
          message: 'This phase already exists for the selected Job.',
        })
      }

      const usedLots = new Set()

      data.lots.forEach((lot, index) => {
        const normalizedLot = normalized(lot.lotNumber)
        if (usedLots.has(normalizedLot)) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'lotNumber'],
            message: 'Each lot can only appear once in the phase.',
          })
        }
        usedLots.add(normalizedLot)

        const selectedPlan = plans.find((plan) => plan.id === lot.planId)
        if (!selectedPlan) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'planId'],
            message: 'Select a plan configured for this Job.',
          })
          return
        }

        const validOptionIds = new Set(
          (selectedPlan.options ?? []).map((option) => option.id),
        )
        if (lot.optionIds.some((optionId) => !validOptionIds.has(optionId))) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'optionIds'],
            message: 'An option does not belong to the selected plan.',
          })
        }
      })
    })
}
