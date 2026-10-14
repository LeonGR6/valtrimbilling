import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Breadcrumbs,
  Chip,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  TableCell,
  TableRow,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded'

import { focusRingSx } from './catalogStyles.js'

// Shared pieces for the catalog pages of the Jobs flow (Builders -> Jobs ->
// Plans & options), so the three levels read as one product.

const PAGE_PADDING_X = { xs: 2.5, md: 4 }

/**
 * Header of every page in the Jobs flow: where you are (clickable breadcrumbs),
 * what this is, and the one primary action on the right.
 *
 * breadcrumbs: [{ label, to? }] - the last one is the current page and has no `to`.
 * meta: optional node under the title (figures, chips).
 * borderless: drop the bottom rule when a navigation strip follows.
 */
export function CatalogPageHeader({
  breadcrumbs,
  title,
  titleAdornment,
  subtitle,
  meta,
  actions,
  borderless = false,
}) {
  return (
    <Box
      component="header"
      sx={{
        px: PAGE_PADDING_X,
        pt: 2,
        pb: 2,
        bgcolor: 'background.paper',
        ...(!borderless && { borderBottom: 1, borderColor: 'divider' }),
      }}
    >
      {breadcrumbs?.length > 0 && (
        <Breadcrumbs
          aria-label="Breadcrumb"
          maxItems={4}
          sx={{ mb: 0.75, fontSize: 13, '& .MuiBreadcrumbs-separator': { mx: 0.75 } }}
        >
          {breadcrumbs.map(({ label, to }) => (
            to ? (
              <Link
                key={label}
                component={RouterLink}
                to={to}
                underline="hover"
                color="text.secondary"
                variant="body2"
                sx={focusRingSx}
              >
                {label}
              </Link>
            ) : (
              <Typography
                key={label}
                variant="body2"
                color="text.primary"
                fontWeight={600}
                aria-current="page"
                noWrap
              >
                {label}
              </Typography>
            )
          ))}
        </Breadcrumbs>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.25}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Typography
              variant="h5"
              component="h1"
              fontWeight={800}
              letterSpacing="-0.01em"
              sx={{ lineHeight: 1.25, overflowWrap: 'anywhere' }}
            >
              {title}
            </Typography>
            {titleAdornment}
          </Stack>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
          {meta}
        </Box>
        {actions && (
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}
          >
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

/**
 * Key numbers of a page as one quiet row (replaces a row of metric cards).
 * figures: [{ label, value }]
 */
export function FigureStrip({ figures, label = 'Summary' }) {
  return (
    <Box
      component="dl"
      aria-label={label}
      sx={{
        m: 0,
        mt: 1.5,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 3.5,
        rowGap: 1,
      }}
    >
      {figures.map(({ label: figureLabel, value }) => (
        <Box key={figureLabel} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <Typography
            component="dd"
            variant="h6"
            sx={{ m: 0, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </Typography>
          <Typography component="dt" variant="body2" color="text.secondary">
            {figureLabel}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Status filter as tabs with counts, same pattern as the Packages catalog.
 * options: [{ value, label, count }]
 */
export function StatusTabs({ value, onChange, options, label }) {
  return (
    <Tabs
      value={value}
      onChange={(_, next) => onChange(next)}
      variant="scrollable"
      scrollButtons="auto"
      aria-label={label}
      sx={{
        flexShrink: 0,
        minHeight: 44,
        maxWidth: '100%',
        '& .MuiTab-root': {
          minHeight: 44,
          minWidth: 0,
          py: 0,
          px: 1.5,
          textTransform: 'none',
          fontWeight: 600,
        },
      }}
    >
      {options.map((option) => (
        <Tab key={option.value} value={option.value} label={`${option.label} (${option.count})`} />
      ))}
    </Tabs>
  )
}

export function StatusChip({ active }) {
  return (
    <Chip
      label={active ? 'Active' : 'Inactive'}
      size="small"
      color={active ? 'success' : 'default'}
      variant="outlined"
      sx={{ fontWeight: 600 }}
    />
  )
}

/** Empty or no-results row content for a table; offers the way out. */
export function CatalogEmptyState({ icon, title, description, action }) {
  return (
    <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
      <Box sx={{ mb: 1, lineHeight: 0 }}>
        {icon ?? <SearchOffRoundedIcon color="disabled" sx={{ fontSize: 36 }} aria-hidden="true" />}
      </Box>
      <Typography fontWeight={700}>{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  )
}

/** Placeholder rows while a catalog loads, so the table does not jump. */
export function CatalogSkeletonRows({ columns, rows = 4 }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row} aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <TableCell key={column}>
          <Skeleton variant="text" width={column === 0 ? '70%' : '55%'} />
        </TableCell>
      ))}
    </TableRow>
  ))
}

/**
 * The secondary actions of one row behind a "more" button.
 * items: [{ label, icon, onClick, color?, disabled? }]
 */
export function RowActionsMenu({ label, items }) {
  const [anchor, setAnchor] = useState(null)

  return (
    <>
      <IconButton
        size="small"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => {
          event.stopPropagation()
          setAnchor(event.currentTarget)
        }}
      >
        <MoreHorizRoundedIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              setAnchor(null)
              item.onClick()
            }}
            sx={item.color ? { color: item.color } : undefined}
          >
            <ListItemIcon sx={item.color ? { color: 'inherit' } : undefined}>
              {item.icon}
            </ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
