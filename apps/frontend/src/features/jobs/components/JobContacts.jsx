import { Box, Link, Stack, Typography } from '@mui/material'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'

/** One line per contact: the role in small type, then the name. For the Jobs table. */
export function JobContactsSummary({ contacts }) {
  return (
    <Stack spacing={0.25}>
      {contacts.map((contact) => (
        <Typography key={contact.key} variant="body2" noWrap sx={{ lineHeight: 1.35 }}>
          <Box component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>
            {contact.role}:{' '}
          </Box>
          <Box
            component="span"
            sx={{ fontWeight: 600, ...(!contact.name && { color: 'text.disabled', fontWeight: 400 }) }}
          >
            {contact.name || 'Unassigned'}
          </Box>
        </Typography>
      ))}
    </Stack>
  )
}

/**
 * A small card per contact with how to reach them, laid out in as many columns
 * as fit so a Job's information stays short. For a Job's information.
 */
export function JobContactsGrid({ contacts }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.25,
        gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
      }}
    >
      {contacts.map((contact) => (
        <Box
          key={contact.key}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1.25, py: 0.75, minWidth: 0 }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ lineHeight: 1.3 }}
          >
            {contact.role}
          </Typography>
          <Typography
            variant="body2"
            noWrap
            sx={{
              fontWeight: contact.name ? 600 : 400,
              color: contact.name ? 'text.primary' : 'text.disabled',
              lineHeight: 1.35,
            }}
          >
            {contact.name || 'Unassigned'}
          </Typography>
          {contact.email && (
            <Link
              href={`mailto:${contact.email}`}
              variant="caption"
              underline="hover"
              noWrap
              sx={{ display: 'block', lineHeight: 1.35 }}
            >
              {contact.email}
            </Link>
          )}
          {(contact.phone || contact.officePhone) && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              component="div"
              sx={{ lineHeight: 1.35 }}
            >
              {[
                contact.phone && `Cell ${formatPhoneNumber(contact.phone)}`,
                contact.officePhone && `Office ${formatPhoneNumber(contact.officePhone)}`,
              ].filter(Boolean).join(' · ')}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  )
}
