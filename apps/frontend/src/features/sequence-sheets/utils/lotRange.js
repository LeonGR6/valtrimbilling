export function parseLotRange(value, maxLots = 500) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return { success: false, error: 'Enter one or more lot ranges.' }
  }

  const ranges = normalized.split(',').map((range) => range.trim())
  if (ranges.some((range) => !range)) {
    return { success: false, error: 'Separate ranges with commas, such as 9-14, 20-25.' }
  }

  const lotNumbers = []
  const includedLotNumbers = new Set()

  for (const range of ranges) {
    const match = range.match(/^(\d+)\s*[-–—]\s*(\d+)$/)
    if (!match) {
      return { success: false, error: 'Use ranges such as 9-14, 20-25.' }
    }

    const start = Number(match[1])
    const end = Number(match[2])

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { success: false, error: 'Use smaller whole lot numbers.' }
    }

    if (start < 1 || end < 1) {
      return { success: false, error: 'Lot numbers must be greater than zero.' }
    }

    if (start > end) {
      return { success: false, error: 'The first lot number in every range must be less than or equal to the second.' }
    }

    const count = end - start + 1
    if (!Number.isSafeInteger(count) || count > maxLots - lotNumbers.length) {
      return { success: false, error: `The ranges can contain up to ${maxLots} lots in total.` }
    }

    for (let lotNumber = start; lotNumber <= end; lotNumber += 1) {
      const normalizedLotNumber = String(lotNumber)
      if (includedLotNumbers.has(normalizedLotNumber)) {
        return { success: false, error: `Lot ${normalizedLotNumber} is repeated in the ranges.` }
      }

      includedLotNumbers.add(normalizedLotNumber)
      lotNumbers.push(normalizedLotNumber)
    }
  }

  return {
    success: true,
    lotNumbers,
  }
}
