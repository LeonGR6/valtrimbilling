import { Fragment, useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useBuilders } from '../../../builders/context/useBuilders.js'
import { quickbooksCustomerRows, quickbooksEnvironmentLabel } from '../../services/quickbooksRecord.js'
import {
  linkQuickbooksCustomer,
  listQuickbooksCustomerLinks,
  searchQuickbooksCustomers,
  unlinkQuickbooksCustomer,
} from '../../services/quickbooksRepository.js'

const SEARCH_DELAY_MS = 350
const MIN_SEARCH_LENGTH = 2

/** Searches QuickBooks while typing, starting from the Builder's own name. */
function CustomerPicker({ builderName, saving, onSave, onCancel }) {
  const [inputValue, setInputValue] = useState(builderName)
  const [selected, setSelected] = useState(null)
  const [found, setFound] = useState({ key: null, options: [], error: '' })

  const query = inputValue.trim()
  const searchable = query.length >= MIN_SEARCH_LENGTH
  // Picking an option puts its name in the box; searching for it again is pointless.
  const settled = selected != null && selected.displayName === inputValue
  const loading = searchable && !settled && found.key !== query

  useEffect(() => {
    if (!searchable || settled) return undefined

    let cancelled = false
    const timer = setTimeout(() => {
      searchQuickbooksCustomers(query)
        .then((options) => {
          if (!cancelled) setFound({ key: query, options, error: '' })
        })
        .catch((error) => {
          if (!cancelled) setFound({ key: query, options: [], error: error.message })
        })
    }, SEARCH_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, searchable, settled])

  return (
    <Stack spacing={1.5} sx={{ py: 1 }}>
      {found.key === query && found.error && <Alert severity="error">{found.error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Autocomplete
          fullWidth
          size="small"
          options={found.key === query ? found.options : []}
          value={selected}
          inputValue={inputValue}
          loading={loading}
          filterOptions={(options) => options}
          getOptionLabel={(option) => option.displayName}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          onChange={(_event, value) => setSelected(value)}
          onInputChange={(_event, value, reason) => {
            // On mount MUI "resets" the box to empty because nothing is selected,
            // which would erase the Builder name the search starts from.
            if (reason === 'reset' && value === '') return
            setInputValue(value)
          }}
          noOptionsText={searchable ? 'No QuickBooks Customer found' : 'Type at least 2 characters'}
          renderInput={(params) => (
            <TextField
              {...params}
              label="QuickBooks Customer"
              // MUI 9 hands the input wiring over in params.slotProps.
              slotProps={{
                ...params.slotProps,
                input: {
                  ...params.slotProps.input,
                  endAdornment: (
                    <>
                      {loading && <CircularProgress size={16} />}
                      {params.slotProps.input.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        <Button
          variant="contained"
          disableElevation
          disabled={!selected || saving}
          onClick={() => onSave(selected)}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving…' : 'Link Customer'}
        </Button>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
      </Stack>
    </Stack>
  )
}

/** Which QuickBooks Customer each Builder is linked to, and changing it. */
export default function QuickbooksCustomersDialog({ environment, onClose }) {
  const { builders } = useBuilders()
  const [links, setLinks] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listQuickbooksCustomerLinks()
      .then((next) => {
        if (!cancelled) setLinks(next)
      })
      .catch((failure) => {
        if (!cancelled) setLoadError(failure.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = links ? quickbooksCustomerRows(builders, links, environment) : []

  const change = async (builderId, action) => {
    setBusyId(builderId)
    setError('')
    try {
      await action()
      setLinks(await listQuickbooksCustomerLinks())
      setEditingId(null)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open onClose={busyId == null ? onClose : undefined} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <span>QuickBooks customers</span>
          <Chip
            size="small"
            color={environment === 'production' ? 'error' : 'warning'}
            label={`${quickbooksEnvironmentLabel(environment)} company`}
            sx={{ fontWeight: 800 }}
          />
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Invoices go to the QuickBooks Customer linked to the Builder. With no link, the
            first invoice uses the Customer whose name is exactly the Builder&apos;s name and
            remembers it. Link a different Customer here when the names do not match. Each
            QuickBooks company has its own links: these are the ones of the company the
            platform is set to.
          </Typography>
          {loadError && <Alert severity="error">{loadError}</Alert>}
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          {!links && !loadError && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Loading…</Typography>
            </Stack>
          )}
          {links && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Builder to QuickBooks Customer links">
                <TableHead>
                  <TableRow>
                    <TableCell>Builder</TableCell>
                    <TableCell>QuickBooks Customer</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography color="text.secondary">There are no Builders yet.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => (
                    <Fragment key={row.builderId}>
                      <TableRow sx={{ '& td': editingId === row.builderId ? { borderBottom: 0 } : undefined }}>
                        <TableCell sx={{ fontWeight: 700 }}>{row.builderName}</TableCell>
                        <TableCell>
                          {row.linked ? (
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <span>{row.customerName}</span>
                              <Chip size="small" color="success" variant="outlined" label="Linked" />
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Not linked · matched by name when an invoice is sent
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Button
                            size="small"
                            onClick={() => setEditingId(editingId === row.builderId ? null : row.builderId)}
                            disabled={busyId != null}
                          >
                            {row.linked ? 'Change' : 'Link'}
                          </Button>
                          {row.linked && (
                            <Button
                              size="small"
                              color="error"
                              disabled={busyId != null}
                              onClick={() => change(row.builderId, () => unlinkQuickbooksCustomer(row.builderId))}
                            >
                              Unlink
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {editingId === row.builderId && (
                        <TableRow>
                          <TableCell colSpan={3}>
                            <CustomerPicker
                              builderName={row.builderName}
                              saving={busyId === row.builderId}
                              onCancel={() => setEditingId(null)}
                              onSave={(customer) => change(
                                row.builderId,
                                () => linkQuickbooksCustomer(row.builderId, customer.id),
                              )}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busyId != null}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
