import assert from 'node:assert/strict'
import test from 'node:test'
import { boxOnPage } from '../src/features/release-templates/services/releasePdfGeometry.js'

// The analysis turns a PDF rectangle into a displayed, normalized one. This is
// that conversion (the backend's normalizeRect), used to check the inverse.
function displayedPoint(page, x, y) {
  const px = x - page.x
  const py = y - page.y
  switch (page.rotation) {
    case 90: return [py, px]
    case 180: return [page.width - px, py]
    case 270: return [page.height - py, page.width - px]
    default: return [px, page.height - py]
  }
}

const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`)
}

for (const rotation of [0, 90, 180, 270]) {
  for (const cropOrigin of [{ x: 0, y: 0 }, { x: 50, y: 60 }]) {
    test(`a box converted to the page and displayed again is the same (rotation ${rotation}, origin ${cropOrigin.x},${cropOrigin.y})`, () => {
      const page = { ...cropOrigin, width: 612, height: 792, rotation }
      const sideways = rotation === 90 || rotation === 270
      const displayWidth = sideways ? 792 : 612
      const displayHeight = sideways ? 612 : 792
      const rect = { x: 0.25, y: 0.3, w: 0.3, h: 0.03 }

      const box = boxOnPage(page, rect)
      near(box.width, rect.w * displayWidth, 'width')
      near(box.height, rect.h * displayHeight, 'height')
      assert.equal(box.rotation, rotation)

      // The origin is the displayed bottom-left corner of the box.
      const [cornerX, cornerY] = displayedPoint(page, box.origin.x, box.origin.y)
      near(cornerX, rect.x * displayWidth, 'corner x')
      near(cornerY, (rect.y + rect.h) * displayHeight, 'corner y')

      // `at` is relative to that corner: right and up as the reader sees it.
      const [pointX, pointY] = displayedPoint(page, ...Object.values(box.at(10, 5)))
      near(pointX, rect.x * displayWidth + 10, 'point x')
      near(pointY, (rect.y + rect.h) * displayHeight - 5, 'point y')
    })
  }
}

test('a rotation that is not a multiple of 90 is treated as the nearest one', () => {
  const upright = boxOnPage({ x: 0, y: 0, width: 612, height: 792, rotation: 0 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.02 })
  const odd = boxOnPage({ x: 0, y: 0, width: 612, height: 792, rotation: 360 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.02 })
  assert.deepEqual(odd.origin, upright.origin)
  assert.equal(odd.rotation, 0)
})

test('the box also reports where it starts and how wide the displayed page is', () => {
  const upright = boxOnPage({ x: 0, y: 0, width: 612, height: 792, rotation: 0 }, { x: 0.25, y: 0.3, w: 0.3, h: 0.03 })
  near(upright.left, 0.25 * 612, 'left')
  near(upright.displayWidth, 612, 'display width')

  const sideways = boxOnPage({ x: 0, y: 0, width: 612, height: 792, rotation: 90 }, { x: 0.25, y: 0.3, w: 0.3, h: 0.03 })
  near(sideways.left, 0.25 * 792, 'left when rotated')
  near(sideways.displayWidth, 792, 'display width when rotated')
})
