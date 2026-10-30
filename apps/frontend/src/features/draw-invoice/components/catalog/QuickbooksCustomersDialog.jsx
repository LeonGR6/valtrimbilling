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
  listQuickbooksCustomers,
  unlinkQuickbooksCustomer,
} from '../../services/quickbooksRepository.js'

const normalizedName = (value) => value.trim().toLowerCase()

/**
 * Chooses a QuickBooks Customer out of the full list, typing only to narrow it.
 * The Customer whose name equals the Builder's is already selected when there is
 * one. A Customer already linked to another Builder says so.
 */
function CustomerPicker({ builderName, customers, takenBy, saving, onSave, onCancel }) {
  const [selected, setSelected] = useState(
    () => customers.find((customer) => normalizedName(customer.displayName) === normalizedName(builderName)) ?? null,
  )
  const takenByOther = selected ? takenBy.get(selected.id) : null

  return (
    <Stack spacing={1.5} sx={{ py: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Autocomplete
          fullWidth
          size="small"
          options={customers}
          value={selected}
          autoHighlight
          getOptionLabel={(option) => option.displayName}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          onChange={(_event, value) => setSelected(value)}
          noOptionsText="No QuickBooks Customer matches"
          renderOption={(props, option) => {
            const { key, ...optionProps } = props
            const other = takenBy.get(option.id)
            return (
              <li key={key} {...optionProps}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                  <span>{option.displayName}</span>
                  {other && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      linked to {other}
                    </Typography>
                  )}
                </Stack>
              </li>
            )
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={`QuickBooks Customer (${customers.length})`}
              placeholder="Type to narrow the list"
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
      {takenByOther && (
        <Alert severity="warning">
          This Customer is already linked to {takenByOther}. Linking it here as well sends both
          Builders&apos; invoices to the same QuickBooks Customer.
        </Alert>
      )}
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
  // The QuickBooks list is read the first time a Customer is to be chosen, then reused.
  const [customers, setCustomers] = useState({ status: 'idle', items: [], error: '' })

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

  const loadCustomers = () => {
    setCustomers((current) => ({ ...current, status: 'loading', error: '' }))
    listQuickbooksCustomers()
      .then((items) => setCustomers({ status: 'ready', items, error: '' }))
      .catch((failure) => setCustomers({ status: 'error', items: [], error: failure.message }))
  }

  const startEditing = (builderId) => {
    const closing = editingId === builderId
    setEditingId(closing ? null : builderId)
    if (!closing && customers.status === 'idle') loadCustomers()
  }

  // Which Builder each Customer already belongs to, to flag a second link to it.
  const takenByFor = (builderId) => new Map(
    rows
      .filter((row) => row.linked && row.builderId !== builderId)
      .map((row) => [row.customerId, row.builderName]),
  )

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
            platform is set to. Choose the Customer from the full list once per Builder; it is
            remembered afterwards.
          </Typography>
          {customers.status === 'ready' && (
            <Box>
              <Button size="small" onClick={loadCustomers}>
                Reload the QuickBooks Customers ({customers.items.length})
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Use it after creating a new Customer in QuickBooks.
              </Typography>
            </Box>
          )}
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
                            onClick={() => startEditing(row.builderId)}
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
                            {customers.status === 'ready' ? (
                              <CustomerPicker
                                builderName={row.builderName}
                                customers={customers.items}
                                takenBy={takenByFor(row.builderId)}
                                saving={busyId === row.builderId}
                                onCancel={() => setEditingId(null)}
                                onSave={(customer) => change(
                                  row.builderId,
                                  () => linkQuickbooksCustomer(row.builderId, customer.id),
                                )}
                              />
                            ) : customers.status === 'error' ? (
                              <Alert
                                severity="error"
                                action={<Button color="inherit" size="small" onClick={loadCustomers}>Retry</Button>}
                              >
                                {customers.error}
                              </Alert>
                            ) : (
                              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
                                <CircularProgress size={20} />
                                <Typography color="text.secondary">Loading the QuickBooks Customers…</Typography>
                              </Stack>
                            )}
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
