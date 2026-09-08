import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import {
  formatPhoneNumber,
  getNationalPhoneNumber,
  getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useBuilders } from '../context/useBuilders.js'
import { emptyBuilder } from '../data/builders.js'
import { createBuilderSchema } from '../schemas/builderSchema.js'

function OptionalLabel({ children }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {children}
      </Typography>
      <Chip
        label="Optional"
        size="small"
        variant="outlined"
        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
      />
    </Stack>
  )
}

function getBuilderFormValues(builder) {
  if (!builder) return { ...emptyBuilder, contactPhoneCountry: 'US' }

  const contactPhoneCountry = getPhoneCountry(builder.contactPhone)
  return {
    ...builder,
    contactPhoneCountry,
    contactPhone: getNationalPhoneNumber(builder.contactPhone, contactPhoneCountry),
  }
}

function BuilderDialog({ open, builder, builders, onClose, onSave, submitting }) {
  const schema = useMemo(
    () => createBuilderSchema(builders, builder?.id),
    [builder?.id, builders],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: getBuilderFormValues(builder),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const description = useWatch({ control, name: 'description' })

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {builder ? 'Edit builder' : 'New builder'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {builder
            ? 'Update the company and contact information for this builder.'
            : 'Add a new builder to the company catalog.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Builder information
            </Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Builder code"
                  {...register('code')}
                  error={Boolean(errors.code)}
                  helperText={errors.code?.message ?? 'Example: CV'}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 24 } }}
                />
                <TextField
                  label="Builder name"
                  {...register('name')}
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message ?? ' '}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
              </Stack>

              <Box>
                <OptionalLabel>Description</OptionalLabel>
                <TextField
                  aria-label="Description"
                  {...register('description')}
                  multiline
                  minRows={2}
                  placeholder="Add a short description of this builder..."
                  fullWidth
                  sx={{ mt: 1 }}
                  slotProps={{ htmlInput: { maxLength: 240 } }}
                  error={Boolean(errors.description)}
                  helperText={errors.description?.message ?? `${description.length}/240`}
                />
              </Box>

              <Box>
                <OptionalLabel>Address</OptionalLabel>
                <TextField
                  aria-label="Address"
                  {...register('address')}
                  multiline
                  minRows={2}
                  placeholder="Street, city, state and ZIP code"
                  fullWidth
                  sx={{ mt: 1 }}
                  slotProps={{ htmlInput: { maxLength: 240 } }}
                  error={Boolean(errors.address)}
                  helperText={errors.address?.message}
                />
              </Box>
            </Stack>
          </Box>

          <Box>
            <OptionalLabel>Primary contact</OptionalLabel>
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              <TextField
                label="Contact name"
                {...register('contactName')}
                error={Boolean(errors.contactName)}
                helperText={errors.contactName?.message ?? ' '}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  {...register('contactEmail')}
                  error={Boolean(errors.contactEmail)}
                  helperText={errors.contactEmail?.message ?? ' '}
                  fullWidth
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <MailOutlineRoundedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                    htmlInput: { maxLength: 160 },
                  }}
                />
                <FormPhoneInput
                  control={control}
                  name="contactPhone"
                  label="Phone"
                  error={errors.contactPhone}
                  helperText="Optional · choose +1 or +52"
                />
              </Stack>
            </Stack>
          </Box>

          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              px: 2,
              py: 1,
            }}
          >
            <FormControlLabel
              sx={{ m: 0, width: '100%', justifyContent: 'space-between' }}
              labelPlacement="start"
              control={
                <Controller
                  name="isActive"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                      slotProps={{ input: { ref: field.ref } }}
                    />
                  )}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Active builder
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Inactive builders remain visible in the catalog.
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" type="submit" disabled={submitting} disableElevation>
          {submitting
            ? 'Saving...'
            : builder ? 'Save changes' : 'Create builder'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuildersCatalog({
  getBuilderJobCount,
  onBuilderRenamed,
  onSelectBuilder,
}) {
  const isJobsEntry = Boolean(onSelectBuilder)
  const {
    builders,
    loading,
    error,
    canManageBuilders,
    refreshBuilders,
    createBuilder,
    updateBuilder,
    deactivateBuilder,
  } = useBuilders()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedBuilder, setSelectedBuilder] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)

  const filteredBuilders = useMemo(() => {
    const query = search.trim().toLowerCase()

    return builders.filter((builder) => {
      const matchesSearch =
        !query ||
        [
          builder.code,
          builder.name,
          builder.description,
          builder.address,
          builder.contactName,
          builder.contactEmail,
          builder.contactPhone,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? builder.isActive : !builder.isActive)

      return matchesSearch && matchesStatus
    })
  }, [builders, search, status])

  const visibleBuilders = filteredBuilders.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const deactivateTargetJobCount = deactivateTarget
    ? getBuilderJobCount?.(deactivateTarget) ?? 0
    : 0

  const handleMenuOpen = (event, builder) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setSelectedBuilder(builder)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedBuilder(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', builder: selectedBuilder })
    handleMenuClose()
  }

  const openDeactivateDialog = () => {
    setDeactivateTarget(selectedBuilder)
    handleMenuClose()
  }

  const handleSave = async (form) => {
    setSubmitting(true)
    try {
      if (dialogState?.mode === 'edit') {
        const previousBuilder = dialogState.builder
        const updated = await updateBuilder(previousBuilder.id, form)
        if (previousBuilder.name !== updated.name) {
          onBuilderRenamed?.(previousBuilder.name, updated.name)
        }
        setNotice({ severity: 'success', message: 'Builder updated.' })
      } else {
        await createBuilder(form)
        setPage(0)
        setNotice({ severity: 'success', message: 'Builder created.' })
      }

      setDialogState(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
    setSubmitting(true)
    try {
      await deactivateBuilder(deactivateTarget.id)
      setDeactivateTarget(null)
      setPage(0)
      setNotice({ severity: 'success', message: 'Builder deactivated.' })
    } catch (deactivateError) {
      setNotice({ severity: 'error', message: deactivateError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const changeSearch = (event) => {
    setSearch(event.target.value)
    setPage(0)
  }

  const changeStatus = (event) => {
    setStatus(event.target.value)
    setPage(0)
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Box>
          {isJobsEntry && (
            <Typography
              variant="caption"
              color="primary.main"
              fontWeight={700}
              sx={{ display: 'block', mb: 0.5, letterSpacing: '0.04em' }}
            >
              JOBS / BUILDERS
            </Typography>
          )}
          <Typography variant="h5" fontWeight={700} color="text.primary">
            {isJobsEntry ? 'Choose a builder' : 'Builders'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {isJobsEntry
              ? 'You are in Jobs. Jobs are grouped by builder, so select one to continue.'
              : 'Manage builder companies and their primary contact information.'}
          </Typography>
        </Box>
        {canManageBuilders && (
          <ResponsiveCreateButton
            label="New builder"
            onClick={() => setDialogState({ mode: 'create' })}
          />
        )}
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {isJobsEntry && (
            <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle1" fontWeight={700}>
                Builders
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                Select a builder below to see the jobs assigned to it.
              </Typography>
            </Box>
          )}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <TextField
              value={search}
              onChange={changeSearch}
              size="small"
              placeholder="Search builders or contacts..."
              sx={{ width: { xs: '100%', md: 360 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="builder-status-filter-label">Status</InputLabel>
              <Select
                labelId="builder-status-filter-label"
                label="Status"
                value={status}
                onChange={changeStatus}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All builders</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {error && (
            <Alert
              severity="error"
              action={(
                <Button color="inherit" size="small" onClick={() => refreshBuilders().catch(() => {})}>
                  Retry
                </Button>
              )}
              sx={{ borderRadius: 0 }}
            >
              {error}
            </Alert>
          )}

          <TableContainer>
            <Table sx={{ minWidth: 1000 }}>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: 'sidebar.bg',
                    '& .MuiTableCell-root': {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    },
                  }}
                >
                  <TableCell>Builder</TableCell>
                  <TableCell>Primary contact</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Address</TableCell>
                  {getBuilderJobCount && <TableCell width={100}>Jobs</TableCell>}
                  <TableCell>Status</TableCell>
                  {canManageBuilders && (
                    <TableCell align="right" width={72}>Actions</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleBuilders.map((builder) => (
                  <TableRow
                    key={builder.id}
                    hover
                    {...(onSelectBuilder && {
                      role: 'link',
                      tabIndex: 0,
                      'aria-label': `View jobs for ${builder.name}`,
                      onClick: () => onSelectBuilder(builder),
                      onKeyDown: (event) => {
                        if (event.target === event.currentTarget && event.key === 'Enter') {
                          onSelectBuilder(builder)
                        }
                      },
                    })}
                    sx={{
                      cursor: onSelectBuilder ? 'pointer' : 'default',
                      '&:last-child td': { borderBottom: 0 },
                      ...(onSelectBuilder && {
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: -2,
                        },
                      }),
                    }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: 36,
                            height: 36,
                            borderRadius: 1.5,
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'primary.light',
                            color: 'primary.main',
                            flexShrink: 0,
                          }}
                        >
                          <BusinessRoundedIcon fontSize="small" />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {builder.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {builder.code}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {builder.contactName || 'No contact'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {builder.contactEmail || 'No email'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {builder.contactPhone ? formatPhoneNumber(builder.contactPhone) : 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ whiteSpace: 'pre-line' }}
                      >
                        {builder.address || 'No address'}
                      </Typography>
                    </TableCell>
                    {getBuilderJobCount && (
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight={600}>
                            {getBuilderJobCount(builder)}
                          </Typography>
                          {isJobsEntry && (
                            <ArrowForwardRoundedIcon
                              color="primary"
                              sx={{ fontSize: 18 }}
                              aria-hidden="true"
                            />
                          )}
                        </Stack>
                      </TableCell>
                    )}
                    <TableCell>
                      <Chip
                        label={builder.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={builder.isActive ? 'success' : 'default'}
                        variant={builder.isActive ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          ...(builder.isActive && {
                            bgcolor: 'success.light',
                            color: 'success.dark',
                          }),
                        }}
                      />
                    </TableCell>
                    {canManageBuilders && (
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${builder.name}`}
                          onClick={(event) => handleMenuOpen(event, builder)}
                        >
                          <MoreHorizRoundedIcon />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                {loading && visibleBuilders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5 + Number(Boolean(getBuilderJobCount)) + Number(canManageBuilders)}
                      sx={{ py: 8, textAlign: 'center' }}
                    >
                      <Typography color="text.secondary">Loading builders...</Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && visibleBuilders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5 + Number(Boolean(getBuilderJobCount)) + Number(canManageBuilders)}
                      sx={{ py: 8, textAlign: 'center' }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          bgcolor: 'sidebar.bg',
                          color: 'text.secondary',
                          display: 'grid',
                          placeItems: 'center',
                          mx: 'auto',
                          mb: 1.5,
                        }}
                      >
                        <SearchRoundedIcon />
                      </Box>
                      <Typography fontWeight={600}>No builders found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {builders.length === 0
                          ? 'Create the first builder to start the catalog.'
                          : 'Try changing your search or status filter.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredBuilders.length}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={[5, 10, 25]}
          />
        </Box>
      </Box>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={openEditDialog}>
          <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={openDeactivateDialog}
          disabled={!selectedBuilder?.isActive}
          sx={{ color: 'error.main' }}
        >
          <BlockRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Deactivate
        </MenuItem>
      </Menu>

      {dialogState && (
        <BuilderDialog
          key={dialogState.builder?.id ?? 'new'}
          open
          builder={dialogState.builder}
          builders={builders}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
          submitting={submitting}
        />
      )}

      <Dialog
        open={Boolean(deactivateTarget)}
        onClose={submitting ? undefined : () => setDeactivateTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Deactivate builder?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deactivateTarget
              ? `${deactivateTarget.name} (${deactivateTarget.code}) will remain in the catalog as inactive. ${deactivateTargetJobCount > 0 ? `Its ${deactivateTargetJobCount} existing ${deactivateTargetJobCount === 1 ? 'job will' : 'jobs will'} be preserved.` : 'No existing jobs will be affected.'}`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeactivateTarget(null)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeactivate}
            disabled={submitting}
            disableElevation
          >
            {submitting ? 'Deactivating...' : 'Deactivate builder'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          onClose={() => setNotice(null)}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
