import { z } from 'zod'

// Shared field-level validators, composed by each screen's schema.
// Email is trimmed and lowercased so "  User@X.com " normalizes to "user@x.com".
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Enter a valid email address')

// 72 is the byte limit bcrypt hashes; capping avoids silently ignored characters.
export const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(24, 'Password is too long')
