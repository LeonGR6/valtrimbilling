import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCoverageTree,
  coveredLots,
  filterCoverageTree,
  listCoverageLots,
  lotsNamedByPlace,
  lotNumbersInPlace,
  placeLotHint,
  nodeSelectionState,
  restoreCoverage,
  summarizeCoverage,
  toggleNode,
} from '../src/features/change-orders/utils/coverage.js'

const job = {
  sequenceSheet: {
    plans: [{ id: 1, code: 'A' }, { id: 2, code: 'B' }],
    phases: [
      {
        id: 10,
        name: '1',
        building: '1',
        lots: [
          { id: 100, lotNumber: '2', planId: 1 },
          { id: 101, lotNumber: '1', planId: 1 },
          { id: 102, lotNumber: '', planId: null, isUtilityBuilding: true },
        ],
      },
      { id: 11, name: '1', building: '2', lots: [{ id: 110, lotNumber: '5', planId: 2 }] },
      { id: 20, name: '2', building: '', lots: [{ id: 200, lotNumber: '9', planId: 2 }] },
    ],
  },
}

const none = { mode: 'lots', lotIds: new Set(), recordIds: new Set(), planIds: new Set() }

test('the lots tree is Phase > Building > Lot, without Utility rows', () => {
  const tree = buildCoverageTree(job, 'lot')
  assert.deepEqual(tree.map((node) => node.label), ['Phase 1', 'Phase 2'])
  assert.deepEqual(tree[0].children.map((node) => node.label), ['Building 1', 'Building 2'])
  assert.deepEqual(
    tree[0].children[0].children.map((node) => node.label),
    ['Lot 1 – Plan A', 'Lot 2 – Plan A'],
  )
  // A Phase with no Building lists its Lots directly.
  assert.deepEqual(tree[1].children.map((node) => node.label), ['Lot 9 – Plan B'])
})

test('the phase tree stops at the Building', () => {
  const tree = buildCoverageTree(job, 'record')
  assert.deepEqual(tree[0].children.map((node) => node.leaves), [['10'], ['11']])
  assert.deepEqual(tree[1].children.map((node) => node.leaves), [['20']])
})

test('a node is ticked when all of its leaves are', () => {
  const [phaseOne] = buildCoverageTree(job, 'lot')
  const some = toggleNode(phaseOne.children[0], new Set())
  assert.equal(nodeSelectionState(phaseOne.children[0], some), 'all')
  assert.equal(nodeSelectionState(phaseOne, some), 'some')
  assert.equal(nodeSelectionState(phaseOne, toggleNode(phaseOne, some)), 'all')
  assert.equal(nodeSelectionState(phaseOne, toggleNode(phaseOne, toggleNode(phaseOne, some))), 'none')
})

test('searching keeps the matching branch only', () => {
  const tree = filterCoverageTree(buildCoverageTree(job, 'lot'), 'lot 5')
  assert.equal(tree.length, 1)
  assert.equal(tree[0].children[0].children[0].label, 'Lot 5 – Plan B')
})

test('each coverage mode reaches its Lots', () => {
  assert.equal(coveredLots(job, none).length, 0)
  assert.deepEqual(
    coveredLots(job, { ...none, lotIds: new Set(['110']) }).map((row) => row.lot),
    ['5'],
  )
  assert.deepEqual(
    coveredLots(job, { ...none, mode: 'phase', recordIds: new Set(['10']) }).map((row) => row.lot),
    ['1', '2'],
  )
  assert.deepEqual(
    coveredLots(job, { ...none, mode: 'plans', planIds: new Set(['2']) }).map((row) => row.lot),
    ['5', '9'],
  )
  assert.equal(coveredLots(job, { ...none, mode: 'job' }).length, 4)
})

test('the summary counts lots, phases and buildings', () => {
  const rows = coveredLots(job, { ...none, mode: 'job' })
  assert.deepEqual(summarizeCoverage(rows), { lots: 4, phases: 2, buildings: 2 })
})

test('a saved coverage comes back as it was while it still reaches exactly the saved lots', () => {
  const saved = { mode: 'phase', lotIds: [], recordIds: [10], planIds: [] }
  const restored = restoreCoverage(job, saved, [100, 101])

  assert.equal(restored.mode, 'phase')
  assert.deepEqual([...restored.recordIds], ['10'])
  assert.equal(restoreCoverage(job, { mode: 'job', lotIds: [], recordIds: [], planIds: [] }, [100, 101, 110, 200]).mode, 'job')
})

test('a saved coverage that reaches other lots now opens as the saved lots, ticked one by one', () => {
  // The Phase 1 / Building 1 record reaches two lots; one of them was not saved.
  const restored = restoreCoverage(job, { mode: 'phase', lotIds: [], recordIds: [10], planIds: [] }, [100])

  assert.equal(restored.mode, 'lots')
  assert.deepEqual([...restored.lotIds], ['100'])
  assert.equal(restored.recordIds.size, 0)
})

test('with no Job, no coverage or an unknown mode the saved lots are kept as lots', () => {
  for (const [candidate, saved] of [
    [null, { mode: 'job' }],
    [job, null],
    [job, { mode: 'everything' }],
  ]) {
    const restored = restoreCoverage(candidate, saved, [101, '110'])
    assert.equal(restored.mode, 'lots')
    assert.deepEqual([...restored.lotIds].sort(), ['101', '110'])
  }
})

test('Specific Plan Types opens as it was saved even when a Lot of those Plans was added since', () => {
  // Plan B reaches Lots 110 and 200 today; only 110 was saved.
  const restored = restoreCoverage(job, { mode: 'plans', lotIds: [], recordIds: [], planIds: [2] }, [110])

  assert.equal(restored.mode, 'plans')
  assert.deepEqual([...restored.planIds], ['2'])
  assert.deepEqual(coveredLots(job, restored).map((row) => row.lotId), ['110', '200'])
})

test('the Lot numbers a place seems to name, however they are written', () => {
  for (const text of ['Lot 14', 'LOT 14', 'lot14', 'LOT14', '14', '"14"', "'14'", '“14”', '#14', 'Lot #14', 'Lot# 14', 'Lt. 14', 'L14', 'No. 14', ' 14 ']) {
    assert.deepEqual(lotNumbersInPlace(text), ['14'], text)
  }
  assert.deepEqual(lotNumbersInPlace('Lots 14, 15 and 16'), ['14', '15', '16'])
  assert.deepEqual(lotNumbersInPlace('lot 12a'), ['12A'])
  assert.deepEqual(lotNumbersInPlace('Lot 12.1'), ['12.1'])
  for (const text of ['Sales Office', 'Lot 14 restroom', 'Lobby', 'Lot', '', null, 'Lots 14-16']) {
    assert.deepEqual(lotNumbersInPlace(text), [], String(text))
  }
})

test('a place that names a Lot of the Job is found whatever the way it is written', () => {
  const lots = listCoverageLots(job)
  const first = lots[0]
  for (const text of [`Lot ${first.lot}`, `lot ${first.lot}`, `LOT${first.lot}`, first.lot, `"${first.lot}"`, `#${first.lot}`, `0${first.lot}`]) {
    assert.ok(lotsNamedByPlace(text, lots).some((row) => row.lotId === first.lotId), text)
  }
  assert.deepEqual(lotsNamedByPlace('Sales Office', lots), [])
  assert.deepEqual(lotsNamedByPlace('Lot 9999', lots), [])
  assert.deepEqual(lotsNamedByPlace('', lots), [])
})

test('the hint says if the Lot is only in the Job or already a line of the order', () => {
  const lots = listCoverageLots(job)
  const first = lots[0]
  assert.equal(placeLotHint('Sales Office', lots, new Set()), null)
  assert.equal(placeLotHint('Lot 9999', lots, new Set()), null)

  const free = placeLotHint(`LOT${first.lot}`, lots, new Set())
  assert.match(free.message, /already exists? in this Job/)
  assert.ok(free.targets.some((target) => target.lotId === first.lotId))
  assert.equal(free.covered, false)

  // A coverage that cannot take one Lot: it only says where to choose it.
  const fixed = placeLotHint(first.lot, lots, new Set(), { canAdd: false })
  assert.deepEqual(fixed.targets, [])
  assert.match(fixed.message, /Choose it in the coverage above/)

  const twice = placeLotHint(`"${first.lot}"`, lots, new Set([first.lotId]))
  assert.equal(twice.covered, true)
  assert.deepEqual(twice.targets, [])
  assert.match(twice.message, /charged twice/)
})
