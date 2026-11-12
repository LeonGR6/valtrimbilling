import test from 'node:test'
import assert from 'node:assert/strict'
import { roadmapAreas, roadmapStatuses } from '../src/features/roadmap/data/roadmap.js'

test('every roadmap item has a known status, a title and a description', () => {
  for (const area of roadmapAreas) {
    assert.ok(area.title && area.description, 'area needs a title and a description')
    assert.ok(area.items.length > 0, `${area.title} has no items`)
    for (const item of area.items) {
      assert.ok(roadmapStatuses[item.status], `${item.title}: unknown status ${item.status}`)
      assert.ok(item.title.trim() && item.description.trim(), `${area.title}: empty item`)
    }
  }
})

test('roadmap titles are unique, since the page uses them as keys', () => {
  const areaTitles = roadmapAreas.map(({ title }) => title)
  assert.equal(new Set(areaTitles).size, areaTitles.length)
  for (const area of roadmapAreas) {
    const titles = area.items.map(({ title }) => title)
    assert.equal(new Set(titles).size, titles.length, `${area.title} repeats an item`)
  }
})
