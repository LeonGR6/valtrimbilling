import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toLotOptionPrice,
  toLotPlanPrice,
  toSequenceSheetLot,
  toSequenceSheetPhase,
  toSequenceSheetPhaseRpc,
} from '../src/features/sequence-sheets/services/sequenceSheetRecord.js'
import { optionDetailsFromRows } from '../src/features/sequence-sheets/utils/optionDetails.js'

test('maps persisted Phase, Lot, reverse and selected Options to the UI model', () => {
  const lot = toSequenceSheetLot(
    {
      id: 71,
      lot_number: '18',
      utility_name: null,
      plan_id: 31,
      is_reverse: true,
      is_utility_building: false,
    },
    [41, 42],
  )
  const phase = toSequenceSheetPhase(
    {
      id: 21,
      code: '3',
      building: 'C5',
      created_at: '2026-09-10T18:00:00Z',
    },
    [lot],
  )

  assert.deepEqual(phase, {
    id: 21,
    name: '3',
    building: 'C5',
    createdAt: '2026-09-10',
    lots: [{
      id: 71,
      lotNumber: '18',
      utilityName: '',
      planId: 31,
      reverse: true,
      elevation: '',
      optionIds: [41, 42],
      isUtilityBuilding: false,
    }],
  })
})

test('builds the atomic Sequence Sheet RPC payload with normalized values', () => {
  assert.deepEqual(
    toSequenceSheetPhaseRpc(11, 21, {
      phaseName: ' a3 ',
      building: ' c5 ',
      lots: [
        {
          id: 71,
          lotNumber: ' 18a ',
          planId: '31',
          reverse: true,
          optionIds: ['41', 42],
        },
        {
          lotNumber: '19',
          planId: 32,
          reverse: false,
          optionIds: [],
        },
      ],
    }),
    {
      p_job_id: 11,
      p_phase_id: 21,
      p_code: 'A3',
      p_building: 'C5',
      p_lots: [
        {
          id: 71,
          lot_number: '18A',
          utility_name: null,
          plan_id: 31,
          is_reverse: true,
          elevation: '',
          option_ids: [41, 42],
          option_details: [],
          is_utility_building: false,
        },
        {
          id: null,
          lot_number: '19',
          utility_name: null,
          plan_id: 32,
          is_reverse: false,
          elevation: '',
          option_ids: [],
          option_details: [],
          is_utility_building: false,
        },
      ],
      p_is_utility_building: false,
    },
  )
})

test('maps and saves a Utility Building row with Reverse but without Options', () => {
  const phase = toSequenceSheetPhase(
    {
      id: 22,
      code: 'UTILITY',
      building: 'CLUBHOUSE',
      created_at: '2026-10-01T18:00:00Z',
    },
    [toSequenceSheetLot({
      id: 72,
      lot_number: 'UTILITY-1',
      utility_name: 'Clubhouse',
      plan_id: 31,
      is_reverse: true,
      is_utility_building: true,
    })],
  )

  assert.equal(phase.lots[0].isUtilityBuilding, true)
  assert.equal(phase.lots[0].utilityName, 'Clubhouse')
  assert.deepEqual(toSequenceSheetPhaseRpc(11, 22, {
    phaseName: 'UTILITY',
    building: 'CLUBHOUSE',
    lots: [{
      id: 72,
      lotNumber: 'Anything shown in the editor',
      utilityName: ' Pool House ',
      planId: 31,
      reverse: true,
      elevation: '',
      optionIds: [41],
      isUtilityBuilding: true,
    }],
  }), {
    p_job_id: 11,
    p_phase_id: 22,
    p_code: 'UTILITY',
    p_building: 'CLUBHOUSE',
    p_lots: [{
      id: 72,
      lot_number: '',
      utility_name: 'Pool House',
      plan_id: 31,
      is_reverse: true,
      elevation: '',
      option_ids: [],
      option_details: [],
      is_utility_building: true,
    }],
    p_is_utility_building: false,
  })
})

test('a Lot carries the Plan and Option prices it was created with', () => {
  const lot = toSequenceSheetLot(
    {
      id: 71,
      lot_number: '18',
      utility_name: null,
      plan_id: 31,
      is_reverse: false,
      is_utility_building: false,
    },
    [41],
    {
      planPrice: toLotPlanPrice({ id: 5, base_price: '2000.00', hardware_price: null }),
      optionPrices: { 41: toLotOptionPrice({ id: 8, price: '-150.50', is_not_applicable: false }) },
    },
  )

  assert.deepEqual(lot.planPrice, { id: 5, basePrice: 2000, hardwarePrice: null })
  assert.deepEqual(lot.optionPrices, {
    41: { id: 8, price: -150.5, priceNotApplicable: false },
  })
})

test('a Lot with no pinned price leaves the price fields out', () => {
  const lot = toSequenceSheetLot(
    {
      id: 71,
      lot_number: '18',
      utility_name: null,
      plan_id: 31,
      is_reverse: false,
      is_utility_building: false,
    },
    [41],
  )

  assert.equal('planPrice' in lot, false)
  assert.equal('optionPrices' in lot, false)
})

test('a Lot carries the quantity and locations of its Options and sends them to the database', () => {
  const lot = toSequenceSheetLot(
    { id: 71, lot_number: '18', utility_name: null, plan_id: 31, is_reverse: false, is_utility_building: false },
    [41, 42],
    {
      optionDetails: optionDetailsFromRows([
        { option_id: 41, quantity: 3, locations: ['1st floor', '2nd floor'] },
        { option_id: 42, quantity: 1, locations: [] },
      ]),
    },
  )

  // Only the Option that is more than one unit or has a place is kept.
  assert.deepEqual(lot.optionDetails, { 41: { quantity: 3, locations: ['1st floor', '2nd floor'] } })

  const payload = toSequenceSheetPhaseRpc(11, 21, { phaseName: 'A3', building: 'C5', lots: [lot] })
  assert.deepEqual(payload.p_lots[0].option_ids, [41, 42])
  assert.deepEqual(payload.p_lots[0].option_details, [
    { option_id: 41, quantity: 3, locations: ['1st floor', '2nd floor'] },
  ])
})

test('a Lot with no quantity or place on its Options has no details', () => {
  const lot = toSequenceSheetLot(
    { id: 71, lot_number: '18', utility_name: null, plan_id: 31, is_reverse: false, is_utility_building: false },
    [41],
    { optionDetails: optionDetailsFromRows([{ option_id: 41, quantity: 1, locations: [] }]) },
  )

  assert.equal('optionDetails' in lot, false)
})

test('details of an Option that is no longer selected are not sent', () => {
  const payload = toSequenceSheetPhaseRpc(11, 21, {
    phaseName: 'A3',
    building: '',
    lots: [{
      id: 71,
      lotNumber: '18',
      planId: 31,
      reverse: false,
      optionIds: [41],
      optionDetails: { 41: { quantity: 2, locations: ['Garage'] }, 42: { quantity: 5, locations: [] } },
    }],
  })

  assert.deepEqual(payload.p_lots[0].option_details, [
    { option_id: 41, quantity: 2, locations: ['Garage'] },
  ])
})
