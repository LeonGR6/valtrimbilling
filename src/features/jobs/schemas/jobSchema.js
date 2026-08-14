import { z } from 'zod'

const lotNumber = z
  .string()
  .trim()
  .min(1, 'Enter the first lot or unit.')
  .regex(/^\d+$/, 'Use a positive whole number.')
  .refine((value) => Number(value) > 0, 'Use a positive whole number.')

const optionalLotNumber = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || (/^\d+$/.test(value) && Number(value) > 0),
    'Use a positive whole number.',
  )

function normalize(value) {
  return value.trim().toLocaleLowerCase()
}

export function createJobSchema(jobs, currentJobId) {
  return z
    .object({
      builder: z.string().trim().min(1, 'Select a builder.'),
      community: z
        .string()
        .trim()
        .min(1, 'Enter a community or project.')
        .max(100, 'Use 100 characters or fewer.'),
      phase: z
        .string()
        .trim()
        .min(1, 'Enter a phase.')
        .max(30, 'Use 30 characters or fewer.'),
      building: z.string().trim().max(30, 'Use 30 characters or fewer.'),
      lotFrom: lotNumber,
      lotTo: optionalLotNumber,
    })
    .superRefine((data, context) => {
      const start = Number(data.lotFrom)
      const end = Number(data.lotTo || data.lotFrom)

      if (end < start) {
        context.addIssue({
          code: 'custom',
          path: ['lotTo'],
          message: 'The last lot must be greater than or equal to the first.',
        })
        return
      }

      const overlapsExistingJob = jobs.some((job) => {
        if (job.id === currentJobId) return false

        const sameLocation =
          normalize(job.builder) === normalize(data.builder) &&
          normalize(job.community) === normalize(data.community) &&
          normalize(job.phase) === normalize(data.phase) &&
          normalize(job.building) === normalize(data.building)

        if (!sameLocation) return false

        const existingStart = Number(job.lotFrom)
        const existingEnd = Number(job.lotTo || job.lotFrom)

        return start <= existingEnd && end >= existingStart
      })

      if (overlapsExistingJob) {
        context.addIssue({
          code: 'custom',
          path: ['lotFrom'],
          message: 'This lot range overlaps an existing job at this location.',
        })
      }
    })
}
