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
      plan_id: 31,
      is_reverse: true,
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
      planId: 31,
      reverse: true,
      optionIds: [41, 42],
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
          plan_id: 31,
          is_reverse: true,
          option_ids: [41, 42],
        },
        {
          id: null,
          lot_number: '19',
          plan_id: 32,
          is_reverse: false,
          option_ids: [],
        },
      ],
    },
  )
})
