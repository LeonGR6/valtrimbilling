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
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import {
  builderOptions,
  emptyPlanType,
  initialPlanTypes,
} from '../data/planTypes.js'

function PlanTypeDialog({ open, planType, planTypes, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    planType ? { ...planType } : { ...emptyPlanType },
  )
  const [submitted, setSubmitted] = useState(false)

  const normalizedCode = form.code.trim().toUpperCase()
  const codeAlreadyExists = planTypes.some(
    (item) =>
      item.id !== planType?.id &&
      item.builder === form.builder &&
      item.code.toUpperCase() === normalizedCode,
  )
  const hasRequiredFields = Boolean(
    form.builder && normalizedCode && form.name.trim(),
  )

  const updateField = (field) => (event) => {
    const value =
      field === 'isActive' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = () => {
    setSubmitted(true)
    if (!hasRequiredFields || codeAlreadyExists) return

    onSave({
      ...form,
      code: normalizedCode,
      name: form.name.trim(),
      planPrice: form.planPrice.trim(),
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {planType ? 'Edit plan type' : 'New plan type'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {planType
            ? 'Update the catalog information for this plan.'
            : 'Add a plan to make it available in the catalog.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <FormControl fullWidth error={submitted && !form.builder}>
            <InputLabel id="plan-builder-label">Builder</InputLabel>
            <Select
              labelId="plan-builder-label"
              value={form.builder}
              label="Builder"
              onChange={updateField('builder')}
            >
              {builderOptions.map((builder) => (
                <MenuItem value={builder} key={builder}>
                  {builder}
                </MenuItem>
              ))}
            </Select>
            {submitted && !form.builder && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                Select a builder.
              </Typography>
            )}
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Plan code"
              value={form.code}
              onChange={updateField('code')}
              error={(submitted && !normalizedCode) || codeAlreadyExists}
              helperText={
                codeAlreadyExists
                  ? 'This code already exists for the selected builder.'
                  : 'Example: PLAN-7C'
              }
              fullWidth
              slotProps={{ htmlInput: { maxLength: 24 } }}
            />
            <TextField
              label="Plan name"
              value={form.name}
              onChange={updateField('name')}
              error={submitted && !form.name.trim()}
              helperText={
                submitted && !form.name.trim() ? 'Enter a plan name.' : ' '
              }
              fullWidth
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
          </Stack>

          <TextField
            label="Plan Price"
            value={form.planPrice}
            onChange={updateField('planPrice')}
            multiline
            minRows={3}
            placeholder="Add a Plan Price..."
            slotProps={{ htmlInput: { maxLength: 240 } }}
            helperText={`${form.planPrice.length}/240`}
          />

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
                <Switch
                  checked={form.isActive}
                  onChange={updateField('isActive')}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Active plan type
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Inactive plans remain in the catalog but cannot be selected.
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disableElevation>
          {planType ? 'Save changes' : 'Create plan type'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PlanTypesCatalog() {
  const [planTypes, setPlanTypes] = useState(initialPlanTypes)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase()

    return planTypes.filter((planType) => {
      const matchesSearch =
        !query ||
        [planType.code, planType.name, planType.builder, planType.planPrice]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? planType.isActive : !planType.isActive)

      return matchesSearch && matchesStatus
    })
  }, [planTypes, search, status])

  const visiblePlans = filteredPlans.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  const handleMenuOpen = (event, planType) => {
    setMenuAnchor(event.currentTarget)
    setSelectedPlan(planType)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedPlan(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', planType: selectedPlan })
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedPlan)
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setPlanTypes((current) =>
        current.map((item) =>
          item.id === dialogState.planType.id ? { ...item, ...form } : item,
        ),
      )
      setNotice({ severity: 'success', message: 'Plan type updated.' })
    } else {
      setPlanTypes((current) => [
        { ...form, id: Date.now() },
        ...current,
      ])
      setPage(0)
      setNotice({ severity: 'success', message: 'Plan type created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setPlanTypes((current) =>
      current.filter((item) => item.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Plan type deleted.' })
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
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Plan Types
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage the residential plans available for each builder.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => setDialogState({ mode: 'create' })}
          disableElevation
          sx={{ whiteSpace: 'nowrap' }}
        >
          New plan type
        </Button>
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
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <TextField
              value={search}
              onChange={changeSearch}
              size="small"
              placeholder="Search by code, name or builder..."
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
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="status-filter-label">Status</InputLabel>
              <Select
                labelId="status-filter-label"
                label="Status"
                value={status}
                onChange={changeStatus}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All plans</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 800 }}>
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
                  <TableCell>Plan</TableCell>
                  <TableCell>Builder</TableCell>
                  <TableCell>Plan Price</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visiblePlans.map((planType) => (
                  <TableRow
                    key={planType.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
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
                          <MapOutlinedIcon fontSize="small" />
                        </Box>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {planType.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {planType.code}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{planType.builder}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {planType.planPrice || 'No plan price'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={planType.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={planType.isActive ? 'success' : 'default'}
                        variant={planType.isActive ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          ...(planType.isActive && {
                            bgcolor: 'success.light',
                            color: 'success.dark',
                          }),
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${planType.name}`}
                        onClick={(event) => handleMenuOpen(event, planType)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visiblePlans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center' }}>
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
                      <Typography fontWeight={600}>No plan types found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Try changing your search or status filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredPlans.length}
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
        <PlanTypeDialog
          key={dialogState.planType?.id ?? 'new'}
          open
          planType={dialogState.planType}
          planTypes={planTypes}
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
        <DialogTitle>Delete plan type?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.name} (${deleteTarget.code}) will be removed from this catalog.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete plan type
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
