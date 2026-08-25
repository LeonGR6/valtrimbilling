import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'

test('Builder Draw Schedule accepts 3 draws totaling 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse({
    builderId: 2,
    draws: [
      { percentage: 10 },
      { percentage: 75 },
      { percentage: 15 },
    ],
  })

  assert.equal(result.builderId, 2)
  assert.equal(result.draws.length, 3)
})

test('Builder Draw Schedule accepts 5 draws with two-decimal percentages', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse({
    builderId: 2,
    draws: [
      { percentage: 16.67 },
      { percentage: 16.67 },
      { percentage: 16.66 },
      { percentage: 25 },
      { percentage: 25 },
    ],
  })

  assert.equal(result.success, true)
})

test('Builder Draw Schedule rejects totals other than 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse({
    builderId: 2,
    draws: [
      { percentage: 10 },
      { percentage: 70 },
      { percentage: 15 },
    ],
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.draws, [
    'Draw percentages must total exactly 100%.',
  ])
})

test('Builder Draw Schedule requires between 3 and 5 draws', () => {
  const tooFew = createBuilderDrawScheduleSchema([], null).safeParse({
    builderId: 2,
    draws: [{ percentage: 50 }, { percentage: 50 }],
  })
  const tooMany = createBuilderDrawScheduleSchema([], null).safeParse({
    builderId: 2,
    draws: Array.from({ length: 6 }, (_, index) => ({
      percentage: index === 5 ? 15 : 17,
    })),
  })

  assert.equal(tooFew.success, false)
  assert.equal(tooMany.success, false)
})

test('a builder can only have one Builder Draw Schedule', () => {
  const schedules = [{ id: 1, builderId: 2 }]
  const duplicate = createBuilderDrawScheduleSchema(schedules, null).safeParse({
    builderId: 2,
    draws: [
      { percentage: 10 },
      { percentage: 75 },
      { percentage: 15 },
    ],
  })

  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error.flatten().fieldErrors.builderId, [
    'This builder already has a draw schedule.',
  ])
})
