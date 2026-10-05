import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toSequenceSheetLot,
  toSequenceSheetPhase,
  toSequenceSheetPhaseRpc,
} from '../src/features/sequence-sheets/services/sequenceSheetRecord.js'

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
          option_ids: [41, 42],
          is_utility_building: false,
        },
        {
          id: null,
          lot_number: '19',
          utility_name: null,
          plan_id: 32,
          is_reverse: false,
          option_ids: [],
          is_utility_building: false,
        },
      ],
      p_is_utility_building: false,
    },
  )
})

test('maps and saves a Utility Building row inside a normal Phase without extras', () => {
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
      is_reverse: false,
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
      is_reverse: false,
      option_ids: [],
      is_utility_building: true,
    }],
    p_is_utility_building: false,
  })
})
