export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function isValidPhone(value) {
  // Allows only: digits (0-9), spaces, hyphens, parentheses, plus sign
  // Must contain at least some digits
  const phoneRegex = /^[\d\s\-()+ ]*$/.test(value)
  const hasDigits = /\d/.test(value)
  return phoneRegex && (value.trim() === '' || hasDigits)
}

export function isValidNameOnly(value) {
  // Allows letters (including accented), spaces, hyphens, and apostrophes
  // No numbers allowed
  const nameRegex = /^[a-zA-ZáéíóúàèìòùäëïöüñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑ\s\-']*$/.test(value)
  return value.trim() === '' || nameRegex
}
