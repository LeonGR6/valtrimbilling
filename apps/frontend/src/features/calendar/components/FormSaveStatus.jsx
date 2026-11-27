import { Alert, AlertTitle, Box, Link } from '@mui/material'
import { failureTitle } from '../utils/calendarFormErrors.js'

// The answer to "did it save?", kept next to the Save button so it is in view whatever part of the
// form the person is looking at. It says that nothing was saved and why; each reason that belongs
// to a field is a link that takes the person to that field.
export default function FormSaveStatus({ errors, onJump }) {
  if (errors.length === 0) return null

  return (
    <Alert severity="error" className="form-save-status">
      <AlertTitle>{failureTitle(errors)}</AlertTitle>
      <Box component="ul" className="form-save-status__list">
        {errors.map((error) => (
          <li key={`${error.key}|${error.message}`}>
            {error.key ? (
              <Link
                component="button"
                type="button"
                color="inherit"
                underline="always"
                className="form-save-status__link"
                onClick={() => onJump(error.key)}
              >
                <strong>{error.label}</strong>: {error.message}
              </Link>
            ) : (
              error.message
            )}
          </li>
        ))}
      </Box>
    </Alert>
  )
}
