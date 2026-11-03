import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { listTechnicians } from '../services/techniciansRepository.js'
import {
  createServiceCalendarEvent,
  serviceWorkTypeOptions,
} from '../data/serviceCalendarEvents.js'
import { useCustomerServiceCalendar } from '../context/useCustomerServiceCalendar.js'

function todayString() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function ServiceVisitDialog({ requests, onClose, onCreated }) {
  const { addServiceEvent } = useCustomerServiceCalendar()
  const availableRequests = requests.filter((request) => request.status !== 'CLOSED')
  const [technicianOptions, setTechnicianOptions] = useState([])
  const [techniciansLoading, setTechniciansLoading] = useState(true)
  const [values, setValues] = useState({
    requestId: availableRequests[0]?.id ? String(availableRequests[0].id) : '',
    date: todayString(),
    start: '09:00',
    end: '11:00',
    technicianId: '',
    workTypes: ['Hardware'],
    status: 'SCHEDULED',
    notes: '',
  })
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listTechnicians().then((technicians) => {
      if (!active) return
      setTechnicianOptions(technicians.filter((technician) => technician.isActive)
        .map((technician) => ({ value: technician.id, label: technician.name })))
      setTechniciansLoading(false)
    }).catch((loadError) => {
      if (!active) return
      setError(loadError.message)
      setTechniciansLoading(false)
    })
    return () => { active = false }
  }, [])

  const change = (name, value) => {
    setValues((current) => ({ ...current, [name]: value }))
    setError('')
  }

  const toggleWorkType = (workType) => {
    const next = values.workTypes.includes(workType)
      ? values.workTypes.filter((value) => value !== workType)
      : [...values.workTypes, workType]
    change('workTypes', next)
  }

  const submit = (event) => {
    event.preventDefault()
    const request = availableRequests.find((item) => String(item.id) === values.requestId)
    const technician = technicianOptions.find(
      (item) => String(item.value) === values.technicianId,
    )

    if (!request || !technician || !values.date || !values.start || !values.end) {
      setError('Complete the request, technician, date and visit window.')
      return
    }
    if (!values.workTypes.length) {
      setError('Select at least one work type.')
      return
    }
    if (values.end <= values.start) {
      setError('The visit end time must be after the start time.')
      return
    }

    const serviceEvent = createServiceCalendarEvent({
      request,
      date: values.date,
      start: values.start,
      end: values.end,
      status: values.status,
      workTypes: values.workTypes,
      technicianId: technician.value,
      technician: technician.label,
      notes: values.notes,
    })
    addServiceEvent(serviceEvent)
    onCreated?.(serviceEvent)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>
        <Typography variant="h6" fontWeight={750}>New service visit</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Frontend prototype: the visit is kept only until the page is reloaded.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth>
            <InputLabel id="service-visit-request-label">Service request</InputLabel>
            <Select
              labelId="service-visit-request-label"
              label="Service request"
              value={values.requestId}
              onChange={(event) => change('requestId', event.target.value)}
            >
              {availableRequests.map((request) => (
                <MenuItem key={request.id} value={String(request.id)}>
                  {request.requestNumber} · {request.street}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl component="fieldset">
            <Typography variant="caption" color="text.secondary">Work type</Typography>
            <FormGroup row>
              {serviceWorkTypeOptions.map((option) => (
                <FormControlLabel
                  key={option.value}
                  control={(
                    <Checkbox
                      checked={values.workTypes.includes(option.value)}
                      onChange={() => toggleWorkType(option.value)}
                    />
                  )}
                  label={option.label}
                />
              ))}
            </FormGroup>
            <FormHelperText>Select one or more work categories.</FormHelperText>
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Visit date"
              type="date"
              value={values.date}
              onChange={(event) => change('date', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Start"
              type="time"
              value={values.start}
              onChange={(event) => change('start', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="End"
              type="time"
              value={values.end}
              onChange={(event) => change('end', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>

          <FormControl fullWidth>
            <InputLabel id="service-visit-technician-label">Technician</InputLabel>
            <Select
              labelId="service-visit-technician-label"
              label="Technician"
              value={values.technicianId}
              onChange={(event) => change('technicianId', event.target.value)}
              disabled={techniciansLoading || technicianOptions.length === 0}
            >
              {technicianOptions.map((technician) => (
                <MenuItem key={technician.value} value={String(technician.value)}>
                  {technician.label}
                </MenuItem>
              ))}
            </Select>
            {!techniciansLoading && !error && technicianOptions.length === 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Register an active technician in the Technicians tab before scheduling a visit.
              </Alert>
            )}
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="service-visit-status-label">Status</InputLabel>
            <Select
              labelId="service-visit-status-label"
              label="Status"
              value={values.status}
              onChange={(event) => change('status', event.target.value)}
            >
              <MenuItem value="SCHEDULED">Scheduled</MenuItem>
              <MenuItem value="CONFIRMED">Confirmed</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Visit notes"
            value={values.notes}
            onChange={(event) => change('notes', event.target.value)}
            multiline
            minRows={3}
            inputProps={{ maxLength: 500 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>Schedule visit</Button>
      </DialogActions>
    </Dialog>
  )
}

