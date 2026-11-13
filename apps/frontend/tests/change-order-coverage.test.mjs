import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCoverageTree,
  coveredLots,
  filterCoverageTree,
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
