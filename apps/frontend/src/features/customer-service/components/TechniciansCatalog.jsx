import { useCallback, useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, InputAdornment, MenuItem, Snackbar, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import {
  formatPhoneNumber, getNationalPhoneNumber, getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import { technicianSchema } from '../schemas/technicianSchema.js'
import { customerServiceWorkday } from '../utils/customerServiceScheduling.js'
import {
  createTechnician, listTechnicians, updateTechnician,
} from '../services/techniciansRepository.js'

function TechnicianDialog({ technician, onClose, onSave, saving }) {
  const country = getPhoneCountry(technician?.phone ?? '')
  const { control, register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(technicianSchema),
    defaultValues: {
      name: technician?.name ?? '',
      email: technician?.email ?? '',
      phone: getNationalPhoneNumber(technician?.phone ?? '', country),
      phoneCountry: country,
      workdayStartsAt: technician?.workdayStartsAt ?? customerServiceWorkday.startsAt,
      workdayEndsAt: technician?.workdayEndsAt ?? customerServiceWorkday.endsAt,
    },
    mode: 'onTouched',
  })

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm"
      component="form" onSubmit={handleSubmit(onSave)} noValidate>
      <DialogTitle>{technician ? 'Edit technician' : 'New technician'}</DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Technicians are field staff, not application users. This does not send an invitation or create a login.
          </Typography>
          <TextField label="Name" {...register('name')} fullWidth required
            error={Boolean(errors.name)} helperText={errors.name?.message}
            slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField label="Email (optional)" type="email" {...register('email')} fullWidth
            error={Boolean(errors.email)} helperText={errors.email?.message}
            slotProps={{ htmlInput: { maxLength: 160 } }} />
          <FormPhoneInput control={control} name="phone" label="Phone number"
            error={errors.phone} helperText="Optional · choose +1 or +52" />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Workday starts" type="time" {...register('workdayStartsAt')}
              error={Boolean(errors.workdayStartsAt)} helperText={errors.workdayStartsAt?.message}
              fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Workday ends" type="time" {...register('workdayEndsAt')}
              error={Boolean(errors.workdayEndsAt)} helperText={errors.workdayEndsAt?.message}
              fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={saving} disableElevation>
          {saving ? 'Saving...' : technician ? 'Save changes' : 'Create technician'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function TechniciansCatalog() {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [editing, setEditing] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTechnicians(await listTechnicians())
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The remote roster is synchronized when this tab opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  const visible = useMemo(() => technicians.filter((technician) => {
    const matchesStatus = status === 'all'
      || (status === 'active' ? technician.isActive : !technician.isActive)
    const matchesSearch = [technician.name, technician.email, technician.phone]
      .join(' ').toLowerCase().includes(search.trim().toLowerCase())
    return matchesStatus && matchesSearch
  }), [technicians, search, status])

  const save = async (values) => {
    setSaving(true)
    try {
      if (editing?.id) {
        await updateTechnician(editing.id, { ...values, isActive: editing.isActive })
      } else {
        await createTechnician(values)
      }
      setEditing(null)
      await refresh()
      setNotice({ severity: 'success', message: editing?.id ? 'Technician updated.' : 'Technician created.' })
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (technician) => {
    setSaving(true)
    try {
      await updateTechnician(technician.id, { ...technician, isActive: !technician.isActive })
      await refresh()
      setDeactivateTarget(null)
      setNotice({
        severity: 'success',
        message: technician.isActive ? 'Technician deactivated.' : 'Technician reactivated.',
      })
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
        sx={{ p: 2.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Service technicians</Typography>
          <Typography variant="body2" color="text.secondary">
            Register the field staff who can be assigned to Customer Service visits.
          </Typography>
        </Box>
        <ResponsiveCreateButton label="New technician" onClick={() => setEditing({})} disabled={saving} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ px: 2.5, pb: 2.5 }}>
        <TextField size="small" placeholder="Search name, email or phone..." value={search}
          onChange={(event) => setSearch(event.target.value)} sx={{ flex: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }} />
        <TextField select size="small" label="Status" value={status}
          onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="inactive">Inactive</MenuItem>
          <MenuItem value="all">All</MenuItem>
        </TextField>
      </Stack>
      {error && <Alert severity="error" action={<Button color="inherit" onClick={refresh}>Retry</Button>}>{error}</Alert>}
      <TableContainer>
        <Table sx={{ minWidth: 720 }}>
          <TableHead><TableRow sx={{ bgcolor: 'sidebar.bg' }}>
            <TableCell>Technician</TableCell><TableCell>Phone</TableCell>
            <TableCell>Workday</TableCell>
            <TableCell>Status</TableCell><TableCell align="right">Actions</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {visible.map((technician) => <TableRow key={technician.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>{technician.name}</Typography>
                <Typography variant="caption" color="text.secondary">{technician.email || 'No email'}</Typography>
              </TableCell>
              <TableCell>{technician.phone ? formatPhoneNumber(technician.phone) : '—'}</TableCell>
              <TableCell>{technician.workdayStartsAt && technician.workdayEndsAt
                ? `${technician.workdayStartsAt} – ${technician.workdayEndsAt}`
                : 'Incomplete'}</TableCell>
              <TableCell><Chip size="small" label={technician.isActive ? 'Active' : 'Inactive'}
                color={technician.isActive ? 'success' : 'default'} /></TableCell>
              <TableCell align="right">
                <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(technician)} disabled={saving}>Edit</Button>
                <Button size="small" color={technician.isActive ? 'error' : 'success'}
                  onClick={() => technician.isActive
                    ? setDeactivateTarget(technician)
                    : toggleActive(technician)} disabled={saving}>
                  {technician.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </TableCell>
            </TableRow>)}
            {!loading && visible.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6 }}>
              {technicians.length ? 'No technicians match these filters.' : 'No technicians registered yet.'}
            </TableCell></TableRow>}
            {loading && visible.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6 }}>Loading technicians...</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {editing && <TechnicianDialog key={editing.id ?? 'new'} technician={editing.id ? editing : null}
        onClose={() => setEditing(null)} onSave={save} saving={saving} />}
      <Dialog open={Boolean(deactivateTarget)}
        onClose={saving ? undefined : () => setDeactivateTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Deactivate technician?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deactivateTarget?.name} will remain in the roster but cannot be selected for new visits.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeactivateTarget(null)} disabled={saving}>Cancel</Button>
          <Button color="error" variant="contained" disableElevation disabled={saving}
            onClick={() => toggleActive(deactivateTarget)}>
            {saving ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert variant="filled" severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)}>{notice?.message}</Alert>
      </Snackbar>
    </Box>
  )
}
