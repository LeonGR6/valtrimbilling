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
  .max(40, 'Use 40 characters or fewer.')
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
  id: z.union([z.string(), z.number()]).optional(),
  lotNumber: z
    .string()
    .trim()
    .max(30, 'Use 30 characters or fewer.')
    .transform((value) => value.toUpperCase()),
  utilityName: z
    .string()
    .trim()
    .max(80, 'Use 80 characters or fewer.')
    .optional(),
  planId: z.coerce.number().int().positive('Select a plan.'),
  reverse: z.boolean(),
  optionIds: z.array(z.coerce.number().int().positive()),
  isUtilityBuilding: z.boolean().default(false),
})

export function createPhaseByLotSchema(
  job,
  currentPhaseId,
  utilityBuildingRequired = false,
) {
  const phases = job.sequenceSheet?.phases ?? []
  const plans = job.sequenceSheet?.plans ?? []

  return z
    .object({
      phaseName: phaseCodeSchema,
      building: buildingCodeSchema,
      lots: z
        .array(lotAssignmentSchema)
        .min(1, 'Add at least one row.')
        .max(500, 'A phase can contain up to 500 rows.'),
    })
    .superRefine((data, context) => {
      if (
        phases.some(
          (phase) =>
            phase.id !== currentPhaseId &&
            normalizePhaseCode(phase.name) === normalizePhaseCode(data.phaseName),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['phaseName'],
          message: 'This phase already exists for the selected Job.',
        })
      }

      if (
        utilityBuildingRequired
        && !data.lots.some((lot) => lot.isUtilityBuilding)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['lots'],
          message: 'Add at least one Utility Building row to this phase.',
        })
      }

      const usedLots = new Set()

      data.lots.forEach((lot, index) => {
        if (lot.isUtilityBuilding && !lot.utilityName?.length) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'utilityName'],
            message: 'Enter a Utility name.',
          })
        }

        if (!lot.isUtilityBuilding && lot.lotNumber.length === 0) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'lotNumber'],
            message: 'Enter a lot number.',
          })
        }

        if (lot.isUtilityBuilding && lot.optionIds.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index],
            message: 'Utility Building rows cannot include Options.',
          })
        }

        const normalizedLot = normalized(lot.lotNumber)
        if (!lot.isUtilityBuilding && usedLots.has(normalizedLot)) {
          context.addIssue({
            code: 'custom',
            path: ['lots', index, 'lotNumber'],
            message: 'Each lot can only appear once in the phase.',
          })
        }
        if (!lot.isUtilityBuilding) usedLots.add(normalizedLot)

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
