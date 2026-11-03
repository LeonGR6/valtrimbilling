export function parseJobCoordinates(value) {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => part.trim())

  if (parts.length !== 2 || parts.some((part) => part === '')) return null

  const [latitude, longitude] = parts.map(Number)
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

export function formatJobCoordinates(latitude, longitude) {
  const normalizedLatitude = Number(latitude)
  const normalizedLongitude = Number(longitude)

  return Number.isFinite(normalizedLatitude) && Number.isFinite(normalizedLongitude)
    ? `${normalizedLatitude}, ${normalizedLongitude}`
    : ''
}

export function jobCoordinatesGoogleMapsUrl(latitude, longitude) {
  const coordinates = formatJobCoordinates(latitude, longitude)
  return coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`
    : ''
}
