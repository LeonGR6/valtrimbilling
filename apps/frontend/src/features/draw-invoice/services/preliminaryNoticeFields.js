// Finds the blanks of a Preliminary Notice so nobody has to place boxes: the
// printed underlines are text blanks and the small printed squares are check
// boxes. This reads what the PDF draws (its path operators) and the text next
// to it, so it works for any form laid out like this one, not only one file.
//
// A field is { id, kind: 'text' | 'check', page, x, y, w, h, label } with its
// rectangle as fractions of the page AS DISPLAYED (origin top-left), the same
// space the editor and the writer use.

export const FIELD_HEIGHT_POINTS = 14
const MIN_BLANK_WIDTH = 20
const MIN_CHECK_SIZE = 5
const MAX_CHECK_SIZE = 12
// A line this wide with nothing written before it is a divider, not a blank.
const DIVIDER_WIDTH_SHARE = 0.85
const ROW_TOLERANCE = 8
const SAME_ROW = 6

const round = (value) => Math.round(value * 10000) / 10000

function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

/** The subpaths the page strokes or fills, in displayed points (origin top-left). */
function readShapes({ operatorList, OPS, viewport }) {
  const shapes = []
  const saved = []
  let matrix = [1, 0, 0, 1, 0, 0]

  operatorList.fnArray.forEach((operator, index) => {
    const args = operatorList.argsArray[index]
    if (operator === OPS.save) {
      saved.push(matrix)
    } else if (operator === OPS.restore) {
      matrix = saved.pop() ?? matrix
    } else if (operator === OPS.transform) {
      matrix = multiply(matrix, args)
    } else if (operator === OPS.constructPath) {
      const paint = args[0]
      const data = args[1]?.[0]
      if (paint === OPS.endPath || !data?.length) return

      let path = null
      const paths = []
      for (let cursor = 0; cursor < data.length;) {
        const command = data[cursor]
        if (command === 0) {
          path = [[data[cursor + 1], data[cursor + 2]]]
          paths.push(path)
          cursor += 3
        } else if (command === 1 && path) {
          path.push([data[cursor + 1], data[cursor + 2]])
          cursor += 3
        } else if (command === 4) {
          cursor += 1
        } else {
          // A curve: not part of a blank or a check box.
          path = null
          cursor += command === 2 ? 7 : 5
        }
      }

      for (const points of paths) {
        const displayed = points.map(([x, y]) => viewport.convertToViewportPoint(
          matrix[0] * x + matrix[2] * y + matrix[4],
          matrix[1] * x + matrix[3] * y + matrix[5],
        ))
        const xs = displayed.map((point) => point[0])
        const ys = displayed.map((point) => point[1])
        shapes.push({
          paint,
          points: displayed.length,
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        })
      }
    }
  })

  return shapes
}

function readTexts({ textItems, viewport }) {
  return textItems
    .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => {
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      return { text: item.str.trim(), x, y, width: item.width }
    })
}

function labelBefore(texts, line) {
  const before = texts
    .filter((item) => (
      Math.abs(item.y - line.y) < ROW_TOLERANCE && item.x + item.width <= line.x + 2
    ))
    .sort((left, right) => right.x - left.x)
  return before[0] ?? null
}

function labelAfter(texts, square) {
  const after = texts
    .filter((item) => (
      Math.abs(item.y - (square.y + square.height)) < ROW_TOLERANCE + 1
      && item.x >= square.x + square.width - 1
    ))
    .sort((left, right) => left.x - right.x)
  return after[0] ?? null
}

/**
 * @param operatorList the page's pdf.js operator list
 * @param OPS pdf.js operator codes
 * @param viewport pdf.js viewport at scale 1 (applies the page rotation)
 * @param textItems the items of the page's text content
 */
export function detectFieldsInPage({ page, operatorList, OPS, viewport, textItems }) {
  const shapes = readShapes({ operatorList, OPS, viewport })
  const texts = readTexts({ textItems, viewport })
  const isStroke = (shape) => shape.paint === OPS.stroke || shape.paint === OPS.closeStroke

  // Boxes that group blanks, like the Owner / Contractor / Lender cells: their
  // first line of text names the blanks inside.
  const cells = shapes.filter((shape) => (
    shape.points >= 4 && shape.width >= 100 && shape.height >= 40 && !isStroke(shape)
  ))
  const cellHeading = (line) => {
    const cell = cells
      .filter((candidate) => (
        line.x >= candidate.x - 1
        && line.x + line.width <= candidate.x + candidate.width + 1
        && line.y >= candidate.y && line.y <= candidate.y + candidate.height
      ))
      .sort((left, right) => left.width * left.height - right.width * right.height)[0]
    if (!cell) return null

    return texts
      .filter((item) => (
        item.x >= cell.x - 1 && item.x <= cell.x + cell.width
        && item.y >= cell.y && item.y <= cell.y + cell.height
      ))
      .sort((left, right) => left.y - right.y || left.x - right.x)[0]?.text ?? null
  }

  const lines = shapes
    .filter((shape) => (
      isStroke(shape) && shape.points === 2 && shape.height < 0.01 && shape.width >= MIN_BLANK_WIDTH
    ))
    .map((shape) => ({ x: shape.x, y: shape.y, width: shape.width }))
    .sort((left, right) => left.y - right.y || left.x - right.x)

  const blanks = []
  lines.forEach((line, index) => {
    const before = labelBefore(texts, line)
    if (!before && line.width >= viewport.width * DIVIDER_WIDTH_SHARE) return

    let label = before?.text.replace(/[\s:$]+$/u, '').trim() ?? null
    if (!label) {
      // A continuation line: it carries the label of the line above it.
      const above = lines
        .slice(0, index)
        .filter((candidate) => (
          line.y - candidate.y > 0 && line.y - candidate.y <= 22
          && candidate.x < line.x + line.width && candidate.x + candidate.width > line.x
        ))
        .at(-1)
      const aboveLabel = above ? labelBefore(texts, above)?.text.replace(/[\s:$]+$/u, '').trim() : null
      label = aboveLabel ? `${aboveLabel} (cont.)` : 'Text'
    }

    const heading = cellHeading(line)
    blanks.push({
      kind: 'text',
      x: line.x,
      y: line.y - FIELD_HEIGHT_POINTS,
      w: line.width,
      h: FIELD_HEIGHT_POINTS,
      label: heading ? `${heading} · ${label}` : label,
    })
  })

  const checks = shapes
    .filter((shape) => (
      isStroke(shape)
      && shape.points >= 4
      && shape.width >= MIN_CHECK_SIZE && shape.width <= MAX_CHECK_SIZE
      && Math.abs(shape.width - shape.height) < 1
    ))
    .map((shape) => ({
      kind: 'check',
      x: shape.x,
      y: shape.y,
      w: shape.width,
      h: shape.height,
      label: labelAfter(texts, shape)?.text.replace(/[:;.]+$/, '') ?? 'Check box',
    }))

  // Reading order: top to bottom by row, then left to right.
  const rowOf = (field) => Math.round((field.y + field.h) / SAME_ROW)
  return [...blanks, ...checks]
    .sort((left, right) => rowOf(left) - rowOf(right) || left.x - right.x)
    .map((field, index) => ({
      id: `p${page}-${index + 1}`,
      kind: field.kind,
      page,
      x: round(field.x / viewport.width),
      y: round(field.y / viewport.height),
      w: round(field.w / viewport.width),
      h: round(field.h / viewport.height),
      label: field.label,
    }))
}
