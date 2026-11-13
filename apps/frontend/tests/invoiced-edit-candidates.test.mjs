import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDrawWorksheet } from '../src/features/draw-invoice/utils/drawWorksheet.js'
import {
  listFreeHardwareEvents,
  listFreeOptionUnits,
} from '../src/features/draw-invoice/utils/invoicedEditCandidates.js'

// A Job with three Lots (and a Utility building) on a Plan with two Options. Lot 1 has both Options, one of
// them twice; Lot 2 has the second one; Lot 3 has none. The Options are billed from the second Draw (index 1).
const schedule = {
  separateHardwarePrice: true,
  hardwareBillingMode: 'BY_EVENT',
  hardwareEventPercentages: { EXT: 0, DM: 40, HW: 60 },
  optionsBillingDrawIndex: 1,
  draws: [
    { percentage: 25, eventType: 'EXT' },
    { percentage: 50, eventType: 'DM' },
    { percentage: 25, eventType: 'HW' },
  ],
}
const phase = {
  id: 70,
  name: '2',
  building: '15',
  lots: [
    {
      id: 1,
      lotNumber: '1',
      planId: 5,
      optionIds: [50, 51],
      optionDetails: { 51: { quantity: 2, locations: ['Kitchen', 'Bath'] } },
    },
    { id: 2, lotNumber: '2', planId: 5, optionIds: [51] },
    { id: 3, lotNumber: '3', planId: 5, optionIds: [] },
    { id: 4, lotNumber: 'U', planId: 5, optionIds: [50], isUtilityBuilding: true },
  ],
}
const job = {
  id: 7,
  sequenceSheet: {
    plans: [{
      id: 5,
      code: 'P',
      price: 1000,
      hardwarePrice: 100,
      options: [
        { id: 50, code: 'C9100', description: 'Cabinet', price: 300 },
        { id: 51, code: 'P65100C', description: 'Panel', price: 120 },
      ],
    }],
    phases: [phase],
  },
}
const phaseModels = [{ phase, worksheet: buildDrawWorksheet(job, phase, schedule) }]

const record = { id: 100, jobId: 7 }
const cell = (lotId, drawIndex) => ({ phaseId: 70, lotId, drawIndex })
const billedOption = (lotId, optionId, unitNo = 1) => ({ lotId, optionId, unitNo, price: 1, billingDrawIndex: 1 })
const otherPackage = (overrides = {}) => ({
  id: 200,
  jobId: 7,
  status: 'DRAFT',
  selections: [],
  persistedOptionLines: [],
  persistedHardwareLines: [],
  persistedDrawLines: [],
  ...overrides,
})
const freeOptions = (overrides = {}) => listFreeOptionUnits({
  phaseModels,
  selections: [cell(1, 1), cell(2, 1), cell(3, 1)],
  record: { ...record, selections: [cell(1, 1), cell(2, 1), cell(3, 1)] },
  packages: [],
  schedule,
  ...overrides,
})
const ids = (options) => options.map(({ lotId, optionId, unitNo }) => `${lotId}:${optionId}:${unitNo}`)

test('every Option unit of the Lots the Package bills is free when no Package bills it', () => {
  // Lot 1: C9100 and two units of P65100C; Lot 2: P65100C. The Utility building has none.
  assert.deepEqual(ids(freeOptions()), ['1:50:1', '1:51:1', '1:51:2', '2:51:1'])
})

test('a free unit carries what the list shows: Lot, code, unit place and price', () => {
  const [, panel] = freeOptions()
  assert.equal(panel.lotNumber, '1')
  assert.equal(panel.optionCode, 'P65100C')
  assert.equal(panel.unitLabel, 'Kitchen')
  assert.equal(panel.price, 120)
  assert.equal(panel.phaseCode, '2')
  assert.equal(panel.building, '15')
})

test('a unit that a Package bills is not free, this Package included', () => {
  const mine = { ...record, persistedOptionLines: [billedOption(1, 50)] }
  const other = otherPackage({ persistedOptionLines: [billedOption(1, 51, 2)] })
  const free = freeOptions({ record: mine, packages: [mine, other] })
  assert.deepEqual(ids(free), ['1:51:1', '2:51:1'])
})

test('a cancelled Package frees its units', () => {
  const cancelled = otherPackage({ status: 'CANCELLED', persistedOptionLines: [billedOption(1, 50)] })
  assert.ok(ids(freeOptions({ packages: [cancelled] })).includes('1:50:1'))
})

test('only the Lots that have a cell at or after the Options billing Draw are offered', () => {
  // Lot 2 keeps just its first Draw (index 0), before the Options Draw: its Option waits.
  const selections = [cell(1, 1), cell(2, 0)]
  assert.deepEqual(ids(freeOptions({ selections })), ['1:50:1', '1:51:1', '1:51:2'])
})

test('a Lot that another Package already took past the Options billing Draw is offered too', () => {
  const selections = [cell(1, 1), cell(2, 0)]
  const other = otherPackage({ selections: [cell(2, 2)] })
  assert.ok(ids(freeOptions({ selections, packages: [other] })).includes('2:51:1'))
})

test('the cells of this Package as saved do not make a Lot reach the Draw, only the edit does', () => {
  // The Package as saved holds a later cell of Lot 2, but the edit takes it off.
  const saved = { ...record, selections: [cell(1, 1), cell(2, 2)] }
  const selections = [cell(1, 1), cell(2, 0)]
  assert.ok(!ids(freeOptions({ selections, record: saved, packages: [saved] })).includes('2:51:1'))
})

test('a Lot the Package does not bill offers nothing', () => {
  assert.deepEqual(ids(freeOptions({ selections: [cell(3, 1)] })), [])
})

test('a Builder that does not bill Options has none to add', () => {
  assert.deepEqual(freeOptions({ schedule: { ...schedule, optionsBillingDrawIndex: null } }), [])
})

test('an Option without a price is listed as missing its price', () => {
  const unpricedJob = {
    ...job,
    sequenceSheet: {
      ...job.sequenceSheet,
      plans: [{ ...job.sequenceSheet.plans[0], options: [{ id: 50, code: 'C9100', description: 'Cabinet', price: null }] }],
    },
  }
  const models = [{ phase, worksheet: buildDrawWorksheet(unpricedJob, phase, schedule) }]
  const [first] = freeOptions({ phaseModels: models })
  assert.equal(first.issue, 'PRICE_MISSING')
})

test('the Separate Hardware events of the Lots the Package bills are free until a Package bills them', () => {
  const free = listFreeHardwareEvents({
    job,
    schedule,
    selections: [cell(1, 1)],
    keptHardwareLines: [],
    record,
    packages: [],
  })
  // DM and HW have a share of the Hardware price; EXT has none. Lot 1 is the only Lot of the Package.
  assert.deepEqual(free.map(({ id }) => id), ['1:DM', '1:HW'])
  assert.deepEqual(
    [free[0].lotNumber, free[0].phaseCode, free[0].building, free[0].eventType],
    ['1', '2', '15', 'DM'],
  )
})

test('Separate Hardware another Package bills, or this one keeps, is not offered', () => {
  const mine = { ...record, persistedHardwareLines: [{ lotId: 2, hardwareEventType: 'HW' }] }
  const other = otherPackage({ persistedHardwareLines: [{ lotId: 1, hardwareEventType: 'DM' }] })
  const free = listFreeHardwareEvents({
    job,
    schedule,
    selections: [cell(1, 1), cell(2, 1)],
    keptHardwareLines: [{ lotId: 2, hardwareEventType: 'HW' }],
    record: mine,
    packages: [mine, other],
  })
  assert.deepEqual(free.map(({ id }) => id), ['1:HW', '2:DM'])
})

test('a Package of Separate Hardware lines alone offers the Hardware of the Lots it holds', () => {
  const free = listFreeHardwareEvents({
    job,
    schedule,
    selections: [],
    keptHardwareLines: [{ lotId: 3, hardwareEventType: 'HW' }],
    record: { ...record, persistedHardwareLines: [{ lotId: 3, hardwareEventType: 'HW' }] },
    packages: [{ ...record, persistedHardwareLines: [{ lotId: 3, hardwareEventType: 'HW' }] }],
  })
  assert.deepEqual(free.map(({ id }) => id), ['3:DM'])
})

test('a Builder that does not price Hardware by event has no Hardware to add', () => {
  assert.deepEqual(listFreeHardwareEvents({
    job,
    schedule: { ...schedule, hardwareBillingMode: 'FULL' },
    selections: [cell(1, 1)],
    keptHardwareLines: [],
    record,
    packages: [],
  }), [])
})
