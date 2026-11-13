function isWholeNumber(value) {
  return /^\d+$/.test(value)
}

/**
 * Lot numbers as a short phrase: "Lot 5", "Lots 1–4, 7", "Lots 3, 4". Three or more lots in a row
 * collapse into a range; numbers that are not whole (an "A" lot) stay as they are.
 */
export function formatLotRanges(lotNumbers = []) {
  const numbers = lotNumbers
    .map(String)
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
  if (numbers.length === 0) return ''
  if (numbers.length === 1) return `Lot ${numbers[0]}`

  const parts = []
  let index = 0
  while (index < numbers.length) {
    let end = index
    while (
      end + 1 < numbers.length
      && isWholeNumber(numbers[end])
      && isWholeNumber(numbers[end + 1])
      && Number(numbers[end + 1]) === Number(numbers[end]) + 1
    ) end += 1

    if (end - index >= 2) {
      parts.push(`${numbers[index]}–${numbers[end]}`)
      index = end + 1
    } else {
      parts.push(numbers[index])
      index += 1
    }
  }

  return `Lots ${parts.join(', ')}`
}
