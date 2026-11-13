import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatBuilding,
  formatPhase,
  formatPhaseBuilding,
} from '../src/features/sequence-sheets/utils/phaseBuildingCodes.js'
import { phaseScopeLabel } from '../src/features/draw-invoice/utils/packagePhaseScope.js'

test('a Phase is named with its Building, or alone when it has none', () => {
  assert.equal(formatPhaseBuilding('2', '15'), 'Phase 2 · Building 15')
  assert.equal(formatPhaseBuilding('Phase 2', 'B15'), 'Phase 2 · Building 15')
  assert.equal(formatPhaseBuilding('2', ''), 'Phase 2')
  assert.equal(formatPhaseBuilding('2', null), 'Phase 2')
  assert.equal(formatPhaseBuilding('2', undefined), 'Phase 2')
  assert.equal(formatPhaseBuilding('2', '15', { separator: ' / ' }), 'Phase 2 / Building 15')
  assert.equal(formatPhaseBuilding('2', '15', { variant: 'short', separator: ' / ' }), 'P2 / B15')
  assert.equal(formatPhaseBuilding('2', '', { variant: 'short' }), 'P2')
  assert.equal(formatBuilding(''), '')
  assert.equal(formatPhase('2'), 'Phase 2')
})

test('a Package scope label does not leave a dangling separator without a Building', () => {
  assert.equal(phaseScopeLabel('2', '15'), 'Phase 2 / Building 15')
  assert.equal(phaseScopeLabel('2', ''), 'Phase 2')
  assert.equal(phaseScopeLabel('2', null), 'Phase 2')
})
