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
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
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
  Link,
  Typography,
} from '@mui/material'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  CatalogSkeletonRows,
  RowActionsMenu,
  StatusChip,
  StatusTabs,
  catalogTableSx,
  focusRingSx,
  visuallyHiddenSx,
} from '../../../components/common/CatalogPage'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import {
  formatPhoneNumber,
  getNationalPhoneNumber,
  getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useBuilders } from '../context/useBuilders.js'
import { builderCountries, emptyBuilder, formatBuilderAddress } from '../data/builders.js'
import { emptyContact } from '../../builder-contacts/data/builderContacts.js'
import { createBuilderSchema } from '../schemas/builderSchema.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import ContactTypeField from '../../builder-contacts/components/ContactTypeField.jsx'
import { contactTypeNames } from '../../builder-contacts/data/builderContacts.js'

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

const emptyExtraContact = {
  name: '',
  typeName: '',
  email: '',
  phone: '',
  phoneCountry: 'US',
  officePhone: '',
  officePhoneCountry: 'US',
}

function BuilderDialog({
  open,
  builder,
  builders,
  contactEmails,
  typeNames,
  onClose,
  onSave,
  submitting,
}) {
  const schema = useMemo(
    () => createBuilderSchema(builders, builder?.id, contactEmails),
    [builder?.id, builders, contactEmails],
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
  const {
    fields: extraContacts,
    append: addExtraContact,
    remove: removeExtraContact,
  } = useFieldArray({ control, name: 'contacts' })

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
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                  <TextField
                    label="Address line 1"
                    placeholder="Street and number"
                    {...register('addressLine1')}
                    error={Boolean(errors.addressLine1)}
                    helperText={errors.addressLine1?.message ?? ' '}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                  <TextField
                    label="Address line 2"
                    placeholder="Apartment, suite, unit"
                    {...register('addressLine2')}
                    error={Boolean(errors.addressLine2)}
                    helperText={errors.addressLine2?.message ?? ' '}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="City"
                      {...register('city')}
                      error={Boolean(errors.city)}
                      helperText={errors.city?.message ?? ' '}
                      fullWidth
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                    <TextField
                      label="State"
                      {...register('state')}
                      error={Boolean(errors.state)}
                      helperText={errors.state?.message ?? ' '}
                      sx={{ width: { xs: '100%', sm: 140 } }}
                      slotProps={{ htmlInput: { maxLength: 2 } }}
                    />
                    <TextField
                      label="ZIP code"
                      {...register('zipCode')}
                      error={Boolean(errors.zipCode)}
                      helperText={errors.zipCode?.message ?? ' '}
                      sx={{ width: { xs: '100%', sm: 180 } }}
                      slotProps={{ htmlInput: { maxLength: 10 } }}
                    />
                  </Stack>
                  <Controller
                    name="country"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        select
                        label="Country"
                        {...field}
                        error={Boolean(errors.country)}
                        helperText={errors.country?.message ?? ' '}
                        fullWidth
                      >
                        {builderCountries.map((country) => (
                          <MenuItem key={country.value} value={country.value}>
                            {country.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </Stack>
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

          {!builder && (
            <Box>
              <OptionalLabel>Other contacts</OptionalLabel>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                People at the builder besides the primary contact. Pick a contact type
                or type a new one: it is saved for the next builder.
              </Typography>
              <Stack spacing={2} sx={{ mt: 1.5 }}>
                {extraContacts.map((item, index) => (
                  <Box
                    key={item.id}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
                  >
                    <Stack spacing={2}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          label="Name"
                          {...register(`contacts.${index}.name`)}
                          error={Boolean(errors.contacts?.[index]?.name)}
                          helperText={errors.contacts?.[index]?.name?.message ?? ' '}
                          fullWidth
                          slotProps={{ htmlInput: { maxLength: 100 } }}
                        />
                        <Box sx={{ width: '100%' }}>
                          <ContactTypeField
                            control={control}
                            name={`contacts.${index}.typeName`}
                            typeNames={typeNames}
                            error={errors.contacts?.[index]?.typeName}
                            hideDescription
                          />
                        </Box>
                        <IconButton
                          aria-label="Remove contact"
                          onClick={() => removeExtraContact(index)}
                          sx={{ alignSelf: { xs: 'flex-end', sm: 'flex-start' }, mt: { sm: 0.5 } }}
                        >
                          <DeleteOutlineRoundedIcon />
                        </IconButton>
                      </Stack>
                      <TextField
                        label="Email"
                        type="email"
                        {...register(`contacts.${index}.email`)}
                        error={Boolean(errors.contacts?.[index]?.email)}
                        helperText={errors.contacts?.[index]?.email?.message ?? ' '}
                        fullWidth
                        slotProps={{ htmlInput: { maxLength: 160 } }}
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <FormPhoneInput
                          control={control}
                          name={`contacts.${index}.officePhone`}
                          label="Office number"
                          error={errors.contacts?.[index]?.officePhone}
                          helperText="Optional · choose +1 or +52"
                        />
                        <FormPhoneInput
                          control={control}
                          name={`contacts.${index}.phone`}
                          label="Cell phone"
                          error={errors.contacts?.[index]?.phone}
                          helperText="Optional · choose +1 or +52"
                        />
                      </Stack>
                    </Stack>
                  </Box>
                ))}
                <Box>
                  <Button
                    size="small"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => addExtraContact(emptyExtraContact)}
                  >
                    Add contact
                  </Button>
                </Box>
              </Stack>
            </Box>
          )}

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
  banner,
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
  const { contacts, contactTypes, createBuilderContact } = useBuilderContacts()
  const contactEmails = useMemo(() => contacts.map((contact) => contact.email), [contacts])
  const typeNames = useMemo(() => contactTypeNames(contactTypes), [contactTypes])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [dialogState, setDialogState] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)

  const searchedBuilders = useMemo(() => {
    const query = search.trim().toLowerCase()

    return builders.filter((builder) =>
      !query ||
      [
        builder.code,
        builder.name,
        builder.description,
        formatBuilderAddress(builder),
        builder.contactName,
        builder.contactEmail,
        builder.contactPhone,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [builders, search])
  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All', count: searchedBuilders.length },
    {
      value: 'active',
      label: 'Active',
      count: searchedBuilders.filter((builder) => builder.isActive).length,
    },
    {
      value: 'inactive',
      label: 'Inactive',
      count: searchedBuilders.filter((builder) => !builder.isActive).length,
    },
  ], [searchedBuilders])
  const filteredBuilders = useMemo(
    () => searchedBuilders.filter((builder) =>
      status === 'all' || (status === 'active' ? builder.isActive : !builder.isActive),
    ),
    [searchedBuilders, status],
  )

  // The Jobs entry lists every Builder at once so one can be picked without paging;
  // the Builders catalog keeps its pages.
  const visibleBuilders = isJobsEntry
    ? filteredBuilders
    : filteredBuilders.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const deactivateTargetJobCount = deactivateTarget
    ? getBuilderJobCount?.(deactivateTarget) ?? 0
    : 0

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
        const { contacts: newContacts, ...builderFields } = form
        const created = await createBuilder(builderFields)
        setPage(0)

        // The builder exists now; its other contacts are saved one by one, and
        // the ones that fail are named so they can be added from Builder Contacts.
        const failed = []
        for (const contact of newContacts ?? []) {
          try {
            await createBuilderContact({
              ...emptyContact,
              ...contact,
              builderId: created.id,
              isActive: true,
            })
          } catch {
            failed.push(contact.name)
          }
        }
        setNotice(
          failed.length === 0
            ? { severity: 'success', message: 'Builder created.' }
            : {
                severity: 'warning',
                message: `Builder created, but these contacts could not be saved: ${failed.join(', ')}. Add them from Builder Contacts.`,
              },
        )
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

  const changeStatus = (nextStatus) => {
    setStatus(nextStatus)
    setPage(0)
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setPage(0)
  }

  const columnCount = 4 + Number(Boolean(getBuilderJobCount)) + Number(canManageBuilders)
  const hasFilters = Boolean(search.trim()) || status !== 'all'

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        breadcrumbs={isJobsEntry ? [{ label: 'Jobs' }] : undefined}
        title={isJobsEntry ? 'Jobs by builder' : 'Builders'}
        subtitle={isJobsEntry
          ? 'Pick a builder to see its jobs.'
          : 'Manage builder companies and their primary contact information.'}
        actions={canManageBuilders && (
          <ResponsiveCreateButton
            label="New builder"
            onClick={() => setDialogState({ mode: 'create' })}
          />
        )}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {banner}

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            sx={{
              alignItems: { lg: 'center' },
              justifyContent: 'space-between',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ px: 1, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider' }}>
              <StatusTabs
                label="Filter builders by status"
                value={status}
                onChange={changeStatus}
                options={statusOptions}
              />
            </Box>
            <Box sx={{ p: 1.25 }}>
              <TextField
                value={search}
                onChange={changeSearch}
                size="small"
                placeholder="Search builders or contacts"
                sx={{ width: { xs: '100%', lg: 340 } }}
                slotProps={{
                  htmlInput: { 'aria-label': 'Search builders or contacts' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label="Clear search"
                          onClick={() => {
                            setSearch('')
                            setPage(0)
                          }}
                        >
                          <ClearRoundedIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
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
            <Table
              size="small"
              aria-label="Builders"
              aria-busy={loading}
              sx={[{ minWidth: isJobsEntry ? 860 : 1000 }, catalogTableSx]}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Builder</TableCell>
                  <TableCell>Primary contact</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Address</TableCell>
                  {getBuilderJobCount && <TableCell align="right" width={110}>Jobs</TableCell>}
                  <TableCell>Status</TableCell>
                  {canManageBuilders && (
                    <TableCell align="right" width={64}>
                      <Box component="span" sx={visuallyHiddenSx}>Actions</Box>
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleBuilders.map((builder) => (
                  <TableRow
                    key={builder.id}
                    hover
                    {...(onSelectBuilder && { onClick: () => onSelectBuilder(builder) })}
                    sx={{ cursor: onSelectBuilder ? 'pointer' : 'default' }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
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
                          {onSelectBuilder ? (
                            <Link
                              component="button"
                              type="button"
                              underline="hover"
                              variant="body2"
                              fontWeight={700}
                              color="text.primary"
                              aria-label={`View jobs for ${builder.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                onSelectBuilder(builder)
                              }}
                              sx={[{ textAlign: 'left' }, focusRingSx]}
                            >
                              {builder.name}
                            </Link>
                          ) : (
                            <Typography variant="body2" fontWeight={700} noWrap>
                              {builder.name}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" component="div">
                            {builder.code}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      <Typography
                        variant="body2"
                        fontWeight={500}
                        noWrap
                        color={builder.contactName ? 'text.primary' : 'text.disabled'}
                      >
                        {builder.contactName || 'No contact'}
                      </Typography>
                      <Typography
                        variant="caption"
                        color={builder.contactEmail ? 'text.secondary' : 'text.disabled'}
                        noWrap
                        component="div"
                      >
                        {builder.contactEmail || 'No email'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color={builder.contactPhone ? 'text.secondary' : 'text.disabled'}
                        noWrap
                      >
                        {builder.contactPhone ? formatPhoneNumber(builder.contactPhone) : 'No phone'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography
                        variant="body2"
                        color={formatBuilderAddress(builder) ? 'text.secondary' : 'text.disabled'}
                        sx={{ whiteSpace: 'pre-line' }}
                      >
                        {formatBuilderAddress(builder) || 'No address'}
                      </Typography>
                    </TableCell>
                    {getBuilderJobCount && (
                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                        >
                          <Typography variant="body2" fontWeight={700}>
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
                      <StatusChip active={builder.isActive} />
                    </TableCell>
                    {canManageBuilders && (
                      <TableCell align="right">
                        <RowActionsMenu
                          label={`Actions for ${builder.name}`}
                          items={[
                            {
                              label: 'Edit',
                              icon: <EditOutlinedIcon fontSize="small" />,
                              onClick: () => setDialogState({ mode: 'edit', builder }),
                            },
                            {
                              label: 'Deactivate',
                              icon: <BlockRoundedIcon fontSize="small" />,
                              color: 'error.main',
                              disabled: !builder.isActive,
                              onClick: () => setDeactivateTarget(builder),
                            },
                          ]}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                {loading && visibleBuilders.length === 0 && (
                  <CatalogSkeletonRows columns={columnCount} />
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {!loading && visibleBuilders.length === 0 && (
            <CatalogEmptyState
              title="No builders found"
              description={builders.length === 0
                ? 'Create the first builder to start the catalog.'
                : 'No builder matches your search or status filter.'}
              action={hasFilters && builders.length > 0 && (
                <Button size="small" variant="outlined" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            />
          )}

          {!isJobsEntry && (
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
              labelRowsPerPage="Rows"
            />
          )}
        </Box>
      </Box>

      {dialogState && (
        <BuilderDialog
          key={dialogState.builder?.id ?? 'new'}
          open
          builder={dialogState.builder}
          builders={builders}
          contactEmails={contactEmails}
          typeNames={typeNames}
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
