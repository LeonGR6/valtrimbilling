import { z } from 'zod'

function normalize(value) {
  return value.trim().toLocaleLowerCase()
}

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
      totalLots: z.preprocess(
        (value) => (value === '' ? 0 : value),
        z.coerce
          .number()
          .int('Enter a whole number of lots.')
          .min(0, 'The lot total cannot be negative.')
          .max(100000, 'Enter 100,000 lots or fewer.'),
      ),
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
}
