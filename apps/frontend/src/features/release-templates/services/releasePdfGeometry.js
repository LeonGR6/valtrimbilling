// Where a box of the mapping sits on the PDF page.
//
// The mapping stores a rectangle as fractions of the page AS DISPLAYED (origin
// top-left, after the page's /Rotate). Drawing happens in the page's own
// coordinates (origin bottom-left, unrotated, offset by the crop box), so the
// box is converted back with the exact inverse of the analysis conversion.

/**
 * @param page {{ x: number, y: number, width: number, height: number, rotation: number }}
 *   crop box origin and size in points (unrotated) and the page rotation.
 * @param rect {{ x: number, y: number, w: number, h: number }} normalized box.
 */
export function boxOnPage(page, rect) {
  const rotation = ((Math.round(page.rotation / 90) % 4) + 4) % 4 * 90
  const sideways = rotation === 90 || rotation === 270
  const displayWidth = sideways ? page.height : page.width
  const displayHeight = sideways ? page.width : page.height

  // A point of the displayed page (origin top-left) in PDF page coordinates.
  const toPdf = (displayX, displayY) => {
    let x
    let y
    switch (rotation) {
      case 90:
        x = displayY
        y = displayX
        break
      case 180:
        x = page.width - displayX
        y = displayY
        break
      case 270:
        x = page.width - displayY
        y = page.height - displayX
        break
      default:
        x = displayX
        y = page.height - displayY
    }
    return { x: page.x + x, y: page.y + y }
  }

  const left = rect.x * displayWidth
  const top = rect.y * displayHeight
  const width = rect.w * displayWidth
  const height = rect.h * displayHeight

  return {
    width,
    height,
    // Drawing things rotated like the page keeps them upright when displayed.
    rotation,
    // The displayed bottom-left corner of the box, in PDF coordinates.
    origin: toPdf(left, top + height),
    // A point `right` points to the right of and `up` points above that corner.
    at: (right, up) => toPdf(left + right, top + height - up),
  }
}
