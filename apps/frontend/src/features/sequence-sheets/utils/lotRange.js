export function parseLotRange(value, maxLots = 500) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return { success: false, error: 'Enter a lot range.' }
  }

  const match = normalized.match(/^(\d+)\s*[-–—]\s*(\d+)$/)
  if (!match) {
    return { success: false, error: 'Use a range such as 9-14.' }
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
    return { success: false, error: 'The first lot must be smaller than the last lot.' }
  }

  const count = end - start + 1
  if (count > maxLots) {
    return { success: false, error: `A range can contain up to ${maxLots} lots.` }
  }

  return {
    success: true,
    lotNumbers: Array.from({ length: count }, (_, index) => String(start + index)),
  }
}
