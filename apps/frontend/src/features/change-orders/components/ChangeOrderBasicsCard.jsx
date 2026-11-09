import { useMemo, useRef } from 'react'
import { Box, Button, Chip, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

import DateField from '../../../components/common/DateField.jsx'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { changeOrderStatuses } from '../data/changeOrders.js'
import { jobChoiceLabel, jobsOfBuilder } from '../utils/jobChoices.js'
import Field from './ChangeOrderField.jsx'

// Columns of the card on a wide card; every field says how many it spans.
const WIDE = '@container (min-width: 640px)'
const span = (columns) => ({ [WIDE]: { gridColumn: `span ${columns}` } })

/**
 * Who the Extra / CO is for (the Builder, and the Job with its Community), why it is asked and when.
 * `errors` has the message of each field that must be fixed ({ requestedBy: '...' }); only Admin can save it
 * already approved (`canApprove`). The Internal # box says `numberPlaceholder` (the number the Extra /
 * CO will get) when it is emptied. With `statusLocked` the status is only shown: an existing one is
 * moved from its own page.
 */
export default function ChangeOrderBasicsCard({
  values,
  onChange,
  errors = {},
  canApprove = true,
  numberPlaceholder = '',
  statusLocked = false,
}) {
  const { builders } = useBuilders()
  const { jobs } = useJobs()
  const fileInput = useRef(null)

  // The Jobs the selected Builder has; each one says its Community, which is not asked apart.
  const jobOptions = useMemo(() => jobsOfBuilder(jobs, values.builderId), [jobs, values.builderId])
  const selectedJob = jobOptions.find((job) => String(job.id) === String(values.jobId))

  const handleBuilderChange = (event) => {
    // A different Builder makes the previous Job and Community meaningless.
    onChange({ builderId: event.target.value, community: '', jobId: '' })
  }

  // The Community comes with the Job; a different Job also starts the lots it reaches over.
  const handleJobChange = (event) => {
    const job = jobOptions.find((item) => String(item.id) === String(event.target.value))
    onChange({
      jobId: job ? job.id : '',
      community: job ? job.community : '',
      lotIds: new Set(),
      recordIds: new Set(),
      planIds: new Set(),
      lineOverrides: {},
    })
  }

  // With no Job to choose from, the reason is more useful than "Select the Job / Community."
  const jobHelper = !values.builderId ? 'Choose the Builder first.'
    : jobOptions.length === 0 ? 'This Builder has no Jobs.'
      : errors.jobId

  // The Add button is disabled until attachments can be stored: nothing picked would be saved.
  const handleFilesPicked = (event) => {
    const picked = [...event.target.files].map((file) => file.name)
    onChange({ attachments: [...values.attachments, ...picked] })
    event.target.value = ''
  }

  const removeAttachment = (index) => onChange({
    attachments: values.attachments.filter((_, position) => position !== index),
  })

  // A new Extra / CO is saved as Draft or Pending; Approved is for Admin.
  const statuses = changeOrderStatuses.filter((status) => canApprove || status.value !== 'APPROVED')

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      {/* Columns follow the width of the section, which shrinks when the recent list is beside it. */}
      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: '1fr',
          [WIDE]: { gridTemplateColumns: 'repeat(4, 1fr)' },
        }}
      >
        <Field label="Internal CO / Extra #">
          <TextField
            fullWidth
            size="small"
            placeholder={numberPlaceholder || 'E-2026-0047'}
            value={values.internalNumber}
            onChange={(event) => onChange({ internalNumber: event.target.value })}
            error={Boolean(errors.internalNumber)}
            helperText={errors.internalNumber}
          />
        </Field>

        {/* The number the Builder gave for the extra, as it is on their PO or CO; the internal number is the first box. */}
        <Field label="PO / CO #" sx={span(2)}>
          <TextField
            fullWidth
            size="small"
            placeholder="1277447-000"
            value={values.poCoNumber}
            onChange={(event) => onChange({ poCoNumber: event.target.value })}
            error={Boolean(errors.poCoNumber)}
            helperText={errors.poCoNumber}
          />
        </Field>

        <Field label="Status">
          <TextField
            select
            fullWidth
            size="small"
            value={values.status}
            onChange={(event) => onChange({ status: event.target.value })}
            disabled={statusLocked}
            helperText={statusLocked ? 'Changed from its page' : undefined}
          >
            {(statusLocked ? changeOrderStatuses : statuses).map((status) => (
              <MenuItem key={status.value} value={status.value}>{status.label}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Builder" required>
          <TextField
            select
            fullWidth
            size="small"
            value={values.builderId}
            onChange={handleBuilderChange}
            error={Boolean(errors.builderId)}
            helperText={errors.builderId}
          >
            {builders.map((builder) => (
              <MenuItem key={builder.id} value={builder.id}>{builder.name}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Job / Community" required sx={span(3)}>
          <TextField
            select
            fullWidth
            size="small"
            disabled={jobOptions.length === 0}
            value={selectedJob ? selectedJob.id : ''}
            onChange={handleJobChange}
            error={Boolean(errors.jobId)}
            helperText={jobHelper}
            slotProps={{ htmlInput: { 'aria-label': 'Job / Community' } }}
          >
            {jobOptions.map((job) => (
              <MenuItem key={job.id} value={job.id}>{jobChoiceLabel(job)}</MenuItem>
            ))}
          </TextField>
        </Field>

        <Field label="Requested By" required sx={span(2)}>
          <TextField
            fullWidth
            size="small"
            placeholder="Carlos Ramirez"
            value={values.requestedBy}
            onChange={(event) => onChange({ requestedBy: event.target.value })}
            error={Boolean(errors.requestedBy)}
            helperText={errors.requestedBy}
          />
        </Field>

        <Field label="Request Date">
          <DateField
            size="small"
            value={values.requestDate}
            onChange={(requestDate) => onChange({ requestDate })}
          />
        </Field>

        <Field label="Needed By Date">
          <DateField
            size="small"
            value={values.neededByDate}
            onChange={(neededByDate) => onChange({ neededByDate })}
            error={Boolean(errors.neededByDate)}
            helperText={errors.neededByDate}
          />
        </Field>

        <Field label="Attachments" sx={span(4)}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {values.attachments.map((name, index) => (
              <Chip
                key={`${name}-${index}`}
                icon={<InsertDriveFileOutlinedIcon />}
                label={name}
                onDelete={() => removeAttachment(index)}
              />
            ))}
            <Tooltip title="Attachments cannot be saved yet">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  disabled
                  onClick={() => fileInput.current?.click()}
                  sx={{ borderStyle: 'dashed', borderRadius: 4 }}
                >
                  Add
                </Button>
              </span>
            </Tooltip>
            {values.attachments.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Not available yet.
              </Typography>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={handleFilesPicked}
            />
          </Stack>
        </Field>
      </Box>
    </Box>
  )
}
