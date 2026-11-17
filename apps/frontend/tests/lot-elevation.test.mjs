import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ELEVATION_SUGGESTIONS,
  MAX_ELEVATION_LENGTH,
  cleanElevation,
  planWithElevation,
} from '../src/features/sequence-sheets/utils/lotElevation.js'
import { toSequenceSheetLot, toSequenceSheetPhaseRpc } from '../src/features/sequence-sheets/services/sequenceSheetRecord.js'
import { createPhaseByLotSchema } from '../src/features/sequence-sheets/schemas/phaseByLotSchema.js'
import { buildDrawWorksheet } from '../src/features/draw-invoice/utils/drawWorksheet.js'
import { testJobs } from './fixtures/jobs.mjs'

test('A to D are offered and an elevation is trimmed, upper case and at most 20 characters', () => {
  assert.deepEqual(ELEVATION_SUGGESTIONS, ['A', 'B', 'C', 'D'])
  assert.equal(cleanElevation(' b '), 'B')
  assert.equal(cleanElevation('Craftsman-Deluxe'), 'CRAFTSMAN-DELUXE')
  assert.equal(cleanElevation('x'.repeat(30)).length, MAX_ELEVATION_LENGTH)
  assert.equal(cleanElevation(null), '')
})

test('a Plan reads the same as before for a Lot with no elevation, and says it for one that has it', () => {
  assert.equal(planWithElevation('10A', ''), '10A')
  assert.equal(planWithElevation('10A', null), '10A')
  assert.equal(planWithElevation('10', 'b'), '10 · Elev. B')
  assert.equal(planWithElevation('', 'b'), 'Elev. B')
})

test('a saved Lot brings its elevation, and an older Lot has none', () => {
  const base = { id: 1, lot_number: '1', plan_id: 5, is_reverse: false, is_utility_building: false }
  assert.equal(toSequenceSheetLot({ ...base, elevation: 'A' }).elevation, 'A')
  assert.equal(toSequenceSheetLot({ ...base, elevation: null }).elevation, '')
  assert.equal(toSequenceSheetLot(base).elevation, '')
})

test('the Phase is saved with the elevation of each Lot, empty to clear it, and none for a Utility row', () => {
  const rpc = toSequenceSheetPhaseRpc(11, 21, {
    phaseName: '1',
    building: '',
    lots: [
      { id: 1, lotNumber: '1', planId: 5, reverse: false, elevation: ' a ', optionIds: [] },
      { id: 2, lotNumber: '2', planId: 5, reverse: false, elevation: '', optionIds: [] },
      { id: 3, lotNumber: '', utilityName: 'Pool', planId: 5, reverse: false, elevation: 'B', optionIds: [], isUtilityBuilding: true },
    ],
  })

  assert.deepEqual(rpc.p_lots.map((lot) => lot.elevation), ['A', '', ''])
})

test('the form accepts the same Plan on two Lots with another elevation, and refuses a long one', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const planId = job.sequenceSheet.plans[0].id
  const schema = createPhaseByLotSchema(job)
  const lot = (lotNumber, elevation) => ({ lotNumber, planId, reverse: false, optionIds: [], elevation })

  const ok = schema.safeParse({ phaseName: '9', building: '', lots: [lot('1', 'a'), lot('2', 'b'), lot('3', '')] })
  assert.equal(ok.success, true)
  assert.deepEqual(ok.data.lots.map((item) => item.elevation), ['A', 'B', ''])

  const long = schema.safeParse({ phaseName: '9', building: '', lots: [lot('1', 'x'.repeat(21))] })
  assert.equal(long.success, false)

  // A form that never had the field (older rows) still parses, with no elevation.
  const withoutField = schema.safeParse({ phaseName: '9', building: '', lots: [{ lotNumber: '1', planId, reverse: false, optionIds: [] }] })
  assert.equal(withoutField.success, true)
  assert.equal(withoutField.data.lots[0].elevation, '')
})

test('the Draw worksheet carries the elevation of a Lot and nothing changes in what it charges', () => {
  const job = {
    sequenceSheet: { plans: [{ id: 1, code: '10', price: 1000, options: [] }] },
  }
  const phase = {
    lots: [
      { id: 1, lotNumber: '1', planId: 1, elevation: 'A', optionIds: [] },
      { id: 2, lotNumber: '2', planId: 1, optionIds: [] },
    ],
  }
  const schedule = { draws: [{ percentage: 50 }, { percentage: 50 }] }
  const worksheet = buildDrawWorksheet(job, phase, schedule)

  assert.deepEqual(worksheet.rows.map((row) => [row.planCode, row.lotElevation]), [['10', 'A'], ['10', '']])
  assert.deepEqual(worksheet.rows[0].drawAmounts, worksheet.rows[1].drawAmounts)
})
