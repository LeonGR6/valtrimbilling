import { z } from 'zod'
import { parseJobCoordinates } from '../utils/jobCoordinates.js'

function normalize(value) {
  return value.trim().toLocaleLowerCase()
}

const communityCoordinatesSchema = z
  .string()
  .trim()
  .min(1, 'Enter the community coordinates.')
  .superRefine((value, context) => {
    if (value && !parseJobCoordinates(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Enter latitude and longitude separated by a comma.',
      })
    }
  })
  .transform((value) => parseJobCoordinates(value))

export function createJobSchema(jobs, currentJobId) {
  return z
    .object({
      code: z
        .string()
        .trim()
        .min(1, 'Enter the job number.')
        .max(30, 'Use 30 characters or fewer.')
        .transform((value) => value.toUpperCase()),
      builder: z.string().trim().min(1, 'Select a builder.'),
      community: z
        .string()
        .trim()
        .min(1, 'Enter a community or project.')
        .max(100, 'Use 100 characters or fewer.'),
      coordinates: communityCoordinatesSchema,
      // References into features/people and features/builder-contacts, so a job
      // points at a record instead of repeating a name as loose text.
      supervisorId: z
        .number({ invalid_type_error: 'Select a supervisor.' })
        .int()
        .positive('Select a supervisor.'),
      superintendentId: z
        .number({ invalid_type_error: 'Select a jobsite superintendent.' })
        .int()
        .positive('Select a jobsite superintendent.'),
    })
    .superRefine((data, context) => {
      const duplicateCode = jobs.some(
        (job) =>
          job.id !== currentJobId &&
          normalize(job.code) === normalize(data.code),
      )

      if (duplicateCode) {
        context.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'This job number is already in use.',
        })
      }
    })
    .transform(({ coordinates, ...data }) => ({
      ...data,
      communityLatitude: coordinates.latitude,
      communityLongitude: coordinates.longitude,
    }))
}
