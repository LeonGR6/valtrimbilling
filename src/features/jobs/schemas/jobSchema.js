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
      supervisor: z
        .string()
        .trim()
        .min(1, 'Enter the supervisor.')
        .max(100, 'Use 100 characters or fewer.'),
      jobsiteSuperintendent: z
        .string()
        .trim()
        .min(1, 'Enter the jobsite superintendent.')
        .max(100, 'Use 100 characters or fewer.'),
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
