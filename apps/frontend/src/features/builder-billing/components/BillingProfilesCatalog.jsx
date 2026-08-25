import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
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
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  builderLabels,
  builderOptions,
  emptyProfile,
  frequencyLabels,
  frequencyOptions,
  initialProfiles,
  invoiceDateOptions,
  invoiceLineFormatLabels,
  invoiceLineFormatOptions,
  weekdayOptions,
  workAcceptedOptions,
} from '../data/billingProfiles.js'
import { billingProfileSchema } from '../schemas/billingProfileSchema.js'
import {
  computeDrawPeriods,
  describeSchedule,
  formatPeriodDate,
} from '../utils/drawPeriods.js'

const sectionSx = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'text.secondary',
}

function requiredDocuments(profile) {
  return [
    profile.requiresPo && 'PO',
    profile.requiresPaymentSchedule && 'Payment schedule',
    profile.requiresRelease && 'Release',
    profile.requiresBackup && 'Backup',
  ].filter(Boolean)
}

// Shows the concrete windows the current rule produces. Without this the
// cutoff configuration is impossible to sanity-check before it is used.
function SchedulePreview({ control }) {
  const values = useWatch({ control })

  const periods = useMemo(
    () =>
      computeDrawPeriods(
        {
          ...values,
          cutoffDay: Number(values.cutoffDay) || 1,
          submissionDay: Number(values.submissionDay) || 1,
          cutoffWeekday: Number(values.cutoffWeekday) || 0,
          cutoffDays: (values.cutoffDays ?? []).map(Number).filter(Boolean),
          submissionOffsetDays: Number(values.submissionOffsetDays) || 0,
          paymentTermsDays: Number(values.paymentTermsDays) || 0,
        },
        3,
      ),
    [values],
  )

  return (
    <Box sx={{ bgcolor: 'primary.light', borderRadius: 2, p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <CalendarMonthRoundedIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography variant="body2" fontWeight={700} color="primary.main">
          Next periods this rule produces
        </Typography>
      </Stack>

      {periods.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Complete the schedule to see the resulting periods.
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {periods.map((period) => (
            <Stack
              key={period.key}
              direction="row"
              spacing={1}
              sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <Typography variant="caption" color="text.secondary">
                Cutoff {formatPeriodDate(period.cutoffDate)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Due {formatPeriodDate(period.submissionDate)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Invoice {formatPeriodDate(period.invoiceDate)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Pay ~{formatPeriodDate(period.estimatedPaymentDate)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  )
}

function ProfileDialog({ profile, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(billingProfileSchema),
    defaultValues: profile ? { ...profile } : { ...emptyProfile },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  const frequency = useWatch({ control, name: 'frequency' })

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {profile ? 'Edit billing profile' : 'New billing profile'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          These rules decide which draw each completed job belongs to.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.5}>
          <Controller
            name="builder"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.builder)} fullWidth>
                <InputLabel id="profile-builder-label">Builder</InputLabel>
                <Select
                  labelId="profile-builder-label"
                  label="Builder"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {builderOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.builder?.message ?? ' '}</FormHelperText>
              </FormControl>
            )}
          />

          <Divider textAlign="left"><Typography sx={sectionSx}>Draw schedule</Typography></Divider>

          <Controller
            name="frequency"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel id="profile-frequency-label">Frequency</InputLabel>
                <Select
                  labelId="profile-frequency-label"
                  label="Frequency"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {frequencyOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />

          {frequency === 'MONTHLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Cutoff day"
                {...register('cutoffDay')}
                error={Boolean(errors.cutoffDay)}
                helperText={errors.cutoffDay?.message ?? 'Day of the month'}
                fullWidth
              />
              <TextField
                label="Submission due day"
                {...register('submissionDay')}
                error={Boolean(errors.submissionDay)}
                helperText={errors.submissionDay?.message ?? 'Day of the month'}
                fullWidth
              />
            </Stack>
          )}

          {frequency === 'SEMIMONTHLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="First cutoff day"
                {...register('cutoffDays.0')}
                error={Boolean(errors.cutoffDays)}
                helperText={errors.cutoffDays?.message ?? ' '}
                fullWidth
              />
              <TextField
                label="Second cutoff day"
                {...register('cutoffDays.1')}
                error={Boolean(errors.cutoffDays)}
                helperText=" "
                fullWidth
              />
              <TextField
                label="Days until due"
                {...register('submissionOffsetDays')}
                error={Boolean(errors.submissionOffsetDays)}
                helperText={errors.submissionOffsetDays?.message ?? ' '}
                fullWidth
              />
            </Stack>
          )}

          {frequency === 'WEEKLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="cutoffWeekday"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel id="profile-weekday-label">Cutoff weekday</InputLabel>
                    <Select
                      labelId="profile-weekday-label"
                      label="Cutoff weekday"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    >
                      {weekdayOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
              <TextField
                label="Days until due"
                {...register('submissionOffsetDays')}
                error={Boolean(errors.submissionOffsetDays)}
                helperText={errors.submissionOffsetDays?.message ?? ' '}
                fullWidth
              />
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Controller
              name="workAcceptedThrough"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="profile-accepted-label">Work accepted through</InputLabel>
                  <Select
                    labelId="profile-accepted-label"
                    label="Work accepted through"
                    value={field.value}
                    onChange={field.onChange}
                  >
                    {workAcceptedOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
            <Controller
              name="invoiceDateRule"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="profile-invoice-date-label">Invoice date</InputLabel>
                  <Select
                    labelId="profile-invoice-date-label"
                    label="Invoice date"
                    value={field.value}
                    onChange={field.onChange}
                  >
                    {invoiceDateOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
          </Stack>

          <SchedulePreview control={control} />

          <Divider textAlign="left"><Typography sx={sectionSx}>Payment</Typography></Divider>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Payment terms"
              {...register('paymentTermsDays')}
              error={Boolean(errors.paymentTermsDays)}
              helperText={errors.paymentTermsDays?.message ?? 'Days after the invoice date'}
              fullWidth
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">days</InputAdornment> },
              }}
            />
            <TextField
              label="Retention"
              {...register('retentionPercentage')}
              error={Boolean(errors.retentionPercentage)}
              helperText={
                errors.retentionPercentage?.message ??
                'Held back, released at closeout. Leave empty if none.'
              }
              fullWidth
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                htmlInput: { inputMode: 'decimal' },
              }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {/* Mirrors a fullWidth field so OCIP lines up under Retention. */}
            <Box sx={{ width: '100%', display: { xs: 'none', sm: 'block' } }} />
            <TextField
              label="OCIP / WRAP"
              {...register('ocipWrapPercentage')}
              error={Boolean(errors.ocipWrapPercentage)}
              helperText={
                errors.ocipWrapPercentage?.message ??
                'Wrap-up insurance the builder deducts.'
              }
              fullWidth
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                htmlInput: { inputMode: 'decimal' },
              }}
            />
          </Stack>

          <Divider textAlign="left"><Typography sx={sectionSx}>Required to submit</Typography></Divider>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            }}
          >
            {[
              ['requiresPo', 'Purchase order'],
              ['requiresPaymentSchedule', 'Payment schedule'],
              ['requiresRelease', 'Release'],
              ['requiresBackup', 'Backup documentation'],
            ].map(([name, label]) => (
              <Controller
                key={name}
                name={name}
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    label={label}
                    control={
                      <Checkbox
                        checked={Boolean(field.value)}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    }
                  />
                )}
              />
            ))}
          </Box>

          <Divider textAlign="left"><Typography sx={sectionSx}>Submission</Typography></Divider>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Portal"
              {...register('portalName')}
              error={Boolean(errors.portalName)}
              helperText={errors.portalName?.message ?? 'Optional'}
              fullWidth
            />
            <Controller
              name="invoiceLineFormat"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="profile-line-format-label">Invoice line format</InputLabel>
                  <Select
                    labelId="profile-line-format-label"
                    label="Invoice line format"
                    value={field.value}
                    onChange={field.onChange}
                  >
                    {invoiceLineFormatOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
          </Stack>

          <TextField
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={errors.notes?.message ?? ' '}
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
          {profile ? 'Save changes' : 'Create profile'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BillingProfilesCatalog() {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return profiles

    return profiles.filter((profile) =>
      [builderLabels[profile.builder], profile.portalName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [profiles, search])

  const visibleProfiles = filteredProfiles.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, profile) => {
    setMenuAnchor(event.currentTarget)
    setSelectedProfile(profile)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedProfile(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', profile: selectedProfile })
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedProfile)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === dialogState.profile.id ? { ...profile, ...form } : profile,
        ),
      )
      setNotice({ severity: 'success', message: 'Billing profile updated.' })
    } else {
      setProfiles((current) => [{ ...form, id: Date.now() }, ...current])
      setPage(0)
      setNotice({ severity: 'success', message: 'Billing profile created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setProfiles((current) =>
      current.filter((profile) => profile.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Billing profile deleted.' })
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
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Billing Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Cutoff rules, payment terms and required documents for each builder.
          </Typography>
        </Box>
        <ResponsiveCreateButton
          label="New profile"
          onClick={() => setDialogState({ mode: 'create' })}
        />
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
          <Stack sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
              size="small"
              placeholder="Search by builder or portal..."
              sx={{ width: { xs: '100%', md: 380 } }}
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
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 900 }}>
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
                  <TableCell>Schedule</TableCell>
                  <TableCell>Terms</TableCell>
                  <TableCell>Required to submit</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleProfiles.map((profile) => (
                  <TableRow
                    key={profile.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {builderLabels[profile.builder] ?? profile.builder}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {profile.portalName || 'No portal'}
                        {' · '}
                        {invoiceLineFormatLabels[profile.invoiceLineFormat]}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={frequencyLabels[profile.frequency]}
                        size="small"
                        variant="outlined"
                      />
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                        {describeSchedule(profile)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        Net {profile.paymentTermsDays}
                      </Typography>
                      {profile.retentionPercentage > 0 && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {profile.retentionPercentage}% retention
                        </Typography>
                      )}
                      {profile.ocipWrapPercentage > 0 && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {profile.ocipWrapPercentage}% OCIP / WRAP
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {requiredDocuments(profile).length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            Nothing required
                          </Typography>
                        ) : (
                          requiredDocuments(profile).map((document) => (
                            <Chip key={document} label={document} size="small" variant="outlined" />
                          ))
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${builderLabels[profile.builder]}`}
                        onClick={(event) => handleMenuOpen(event, profile)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visibleProfiles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No billing profiles found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Every builder needs one before their work can be placed in a draw.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredProfiles.length}
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
        <MenuItem onClick={openDeleteDialog} sx={{ color: 'error.main' }}>
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete
        </MenuItem>
      </Menu>

      {dialogState && (
        <ProfileDialog
          key={dialogState.profile?.id ?? 'new'}
          profile={dialogState.profile}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete billing profile?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `Work for ${builderLabels[deleteTarget.builder]} will have no cutoff rule until a new profile is created.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete profile
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
