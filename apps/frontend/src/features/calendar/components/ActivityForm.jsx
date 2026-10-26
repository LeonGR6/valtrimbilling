import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Divider,
  ListSubheader,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DateField from '../../../components/common/DateField.jsx'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded'
import { getBuilderDateConfiguration } from '../../builders/data/builders.js'
import {
  activityTypeMap,
  getActivityTone,
  getLotsLabel,
} from '../data/calendarEvents.js'
import DrawerHeader from './DrawerHeader.jsx'
import {
  DateOwnerSelector,
  OptionCheckbox,
  SplitScheduleEditor,
  StageCard,
} from './ProductionFormControls.jsx'
import {
  createDefaultSplitParts,
  findJobBuilder,
  getPhasePatch,
  formatPhaseBuilding,
} from './calendarSchedulerUtils.js'
import {
  existingPhaseEvents,
  formatEventDay,
  sortPhasesForScheduling,
} from '../utils/phaseCalendarCoverage.js'
import {
  calculateProductionDates,
  calculateShutterDate,
  getProductionDateCascade,
} from '../utils/calendarDateRules.js'

function AutoField({ label, value }) {
  return (
    <Box className="production-summary__field">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={700}>{value || 'Unassigned'}</Typography>
    </Box>
  )
}

function ProductionSummary({ draft }) {
  return (
    <Paper variant="outlined" className="production-summary">
      <Box className="production-summary__heading">
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>Loaded from Job #{draft.jobCode}</Typography>
          <Typography variant="caption" color="text.secondary">These fields update automatically with the selected phase.</Typography>
        </Box>
        <Chip size="small" color="success" variant="outlined" label={`${draft.lotNumbers.length} lots`} />
      </Box>
      <Box className="production-summary__grid">
        <AutoField label="Builder" value={draft.builder} />
        <AutoField label="Community" value={draft.community} />
        {draft.building && <AutoField label="Building" value={draft.building} />}
        <AutoField label="Lot range" value={getLotsLabel(draft.lotStart, draft.lotEnd, draft.lotNumbers)} />
        <AutoField label="Foreman / Supervisor" value={draft.foreman} />
        <AutoField label="Jobsite Superintendent" value={draft.superintendent} />
      </Box>
      <Box className="production-summary__lots" aria-label="Lots loaded from selected phase">
        {draft.lotNumbers.map((lot) => <Chip key={lot} size="small" label={`Lot ${lot}`} />)}
      </Box>
    </Paper>
  )
}

export default function ActivityForm({
  jobs,
  builders = [],
  people = [],
  builderContacts = [],
  events = [],
  dateMove = null,
  phaseStatusOf = () => null,
  onOpenExisting,
  draft,
  isEditing,
  activeActivityType,
  formError,
  onChange,
  onClose,
  onSave,
  saving = false,
}) {
  const selectedJob = jobs.find((job) => job.id === Number(draft.jobId)) ?? null
  const builderDateConfiguration = getBuilderDateConfiguration(findJobBuilder(selectedJob, builders))
  const phases = (selectedJob?.sequenceSheet?.phases ?? []).filter(
    (phase) => (phase.lots ?? []).some((lot) => !lot.isUtilityBuilding),
  )
  // Phases that still have no events come first; the ones already on the
  // Calendar follow, marked, so it is clear what is left to schedule.
  const { pending: pendingPhases, scheduled: scheduledPhases } = sortPhasesForScheduling(
    phases,
    (phase) => phaseStatusOf(selectedJob, phase),
  )
  const selectedPhase = phases.find((phase) => phase.id === Number(draft.phaseId)) ?? null
  const selectedPhaseEvents = selectedJob && selectedPhase
    ? existingPhaseEvents(events, selectedJob.id, selectedPhase.id)
    : []
  const selectedPhaseIsScheduled = !isEditing && Boolean(selectedPhase) && (
    phaseStatusOf(selectedJob, selectedPhase) === 'scheduled' || selectedPhaseEvents.length > 0
  )
  const totalLots = draft.lotNumbers.length
  const phaseLabel = (phase) => (
    `${formatPhaseBuilding(phase.name, phase.building)} · ${
      (phase.lots ?? []).filter((lot) => !lot.isUtilityBuilding).length
    } lots`
  )
  const phaseOption = (phase, scheduled) => {
    const first = scheduled && selectedJob
      ? existingPhaseEvents(events, selectedJob.id, phase.id)[0]
      : null

    return (
      <MenuItem key={phase.id} value={phase.id}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ width: '100%', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>{phaseLabel(phase)}</span>
          {scheduled && (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={first
                ? `Scheduled · ${activityTypeMap[first.type]?.shortLabel ?? first.type} ${formatEventDay(first.date)}`
                : 'Scheduled'}
            />
          )}
        </Stack>
      </MenuItem>
    )
  }
  const activeType = activityTypeMap[activeActivityType] ?? null

  const changeJob = (jobId) => {
    const job = jobs.find((item) => item.id === Number(jobId)) ?? null
    const dateConfiguration = getBuilderDateConfiguration(findJobBuilder(job, builders))
    const automaticDates = job ? calculateProductionDates(draft.extDate, dateConfiguration) : {}
    onChange({
      ...getPhasePatch(job, null, people, builderContacts),
      jobId: job?.id ?? '',
      ...automaticDates,
      dmShutters: false,
      shutterDate: '',
    })
  }

  const changePhase = (phaseId) => {
    const phase = phases.find((item) => item.id === Number(phaseId)) ?? null
    onChange(getPhasePatch(selectedJob, phase, people, builderContacts))
  }

  const toggleSplit = (prefix, checked, dateOwner) => {
    const partsField = `${prefix}SplitParts`
    onChange({
      [`${prefix}SplitPhase`]: checked,
      [partsField]: checked ? createDefaultSplitParts(draft, dateOwner) : [],
    })
  }

  return (
    <Box component="form" className="activity-drawer__layout" onSubmit={onSave}>
      <DrawerHeader
        eyebrow={dateMove
          ? 'CONFIRM DATE CHANGE'
          : isEditing ? `CONFIGURE ${activeType?.shortLabel ?? 'EVENT'}` : 'NEW PRODUCTION ACTIVITY'}
        title={isEditing ? `${activeType?.label ?? 'Event'} options` : 'Schedule production'}
        onClose={onClose}
      />

      <Box className="activity-drawer__scroll">
        {formError && <Alert severity="error">{formError}</Alert>}

        {dateMove && (
          <Alert severity="warning" icon={<EventRepeatRoundedIcon />}>
            <AlertTitle>Confirm the new date</AlertTitle>
            {dateMove.changes.map((change) => (
              <Box key={change.label} component="div" sx={{ fontWeight: 600 }}>
                {change.label}: {formatEventDay(change.from, true)} → {formatEventDay(change.to, true)}
              </Box>
            ))}
            <Box component="div" sx={{ mt: 0.75 }}>
              Nothing changes until you press “Confirm date change”. Adjust anything
              below first if you need to, or close this panel to keep the original dates.
            </Box>
          </Alert>
        )}

        {!isEditing && (
          <Box className="activity-form__section">
            <Box className="activity-form__heading">
              <Box>
                <Typography variant="subtitle2" fontWeight={800}>Job and phase</Typography>
                <Typography variant="caption" color="text.secondary">Choose these two fields; project and staff data load automatically.</Typography>
              </Box>
            </Box>
            <Box className="activity-form__grid">
              <TextField
                select
                label="Job"
                value={draft.jobId}
                onChange={(event) => changeJob(event.target.value)}
                required
                fullWidth
              >
                <MenuItem value="">Select a job</MenuItem>
                {jobs.map((job) => (
                  <MenuItem key={job.id} value={job.id}>
                    #{job.code} · {job.community} · {job.builder}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Phase"
                value={draft.phaseId}
                onChange={(event) => changePhase(event.target.value)}
                disabled={!selectedJob || phases.length === 0}
                required
                fullWidth
                slotProps={{
                  select: {
                    renderValue: (value) => {
                      const phase = phases.find((item) => item.id === Number(value))
                      return phase ? phaseLabel(phase) : ''
                    },
                  },
                }}
              >
                <MenuItem value="">Select a phase</MenuItem>
                {scheduledPhases.length > 0 && pendingPhases.length > 0 && (
                  <ListSubheader>Not scheduled yet</ListSubheader>
                )}
                {pendingPhases.map((phase) => phaseOption(phase, false))}
                {scheduledPhases.length > 0 && (
                  <ListSubheader>Already on the calendar</ListSubheader>
                )}
                {scheduledPhases.map((phase) => phaseOption(phase, true))}
              </TextField>
            </Box>
            {selectedPhaseIsScheduled && (
              <Alert
                severity="info"
                action={onOpenExisting && selectedPhaseEvents[0] && (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => onOpenExisting(selectedPhaseEvents[0].eventId)}
                  >
                    Open existing
                  </Button>
                )}
              >
                <AlertTitle>This phase already has events on the calendar</AlertTitle>
                {selectedPhaseEvents.length > 0
                  ? selectedPhaseEvents
                    .map((item) => `${activityTypeMap[item.type]?.shortLabel ?? item.type} ${formatEventDay(item.date)}${item.count > 1 ? ` (+${item.count - 1})` : ''}`)
                    .join(' · ')
                  : 'It is already scheduled.'}
                {' '}Open them to edit instead of creating the same events again.
              </Alert>
            )}
            {selectedJob && phases.length === 0 && (
              <Alert severity="warning">This job has no phases yet. Add a phase and its lots in Sequence Sheets first.</Alert>
            )}
          </Box>
        )}

        {draft.phaseId && <ProductionSummary draft={draft} />}

        <Divider />

        <Box className="activity-form__section">
          <Box className="activity-form__heading">
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>
                {isEditing ? `${activeType?.label ?? 'Event'} configuration` : 'Production dates'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {isEditing
                  ? `Update the date and options for this ${activeType?.shortLabel ?? ''} event.`
                  : 'Choose EXT; the builder rule automatically schedules DM and HW.'}
              </Typography>
              <Typography variant="caption" color="primary.main" fontWeight={700} sx={{ display: 'block' }}>
                {builderDateConfiguration.extToDmWeeks} {' '}
                {builderDateConfiguration.extToDmWeeks === 1 ? 'week' : 'weeks'} EXT → DM · {' '}
                {builderDateConfiguration.dmToHwWeeks} {' '}
                {builderDateConfiguration.dmToHwWeeks === 1 ? 'week' : 'weeks'} DM → HW · {' '}
                Configured U.S. holidays excluded
              </Typography>
              {draft.dmShutters && (
                <Typography variant="caption" color="primary.main" fontWeight={700} sx={{ display: 'block' }}>
                  Shutter: {builderDateConfiguration.shutterBeforeDmWeeks} {' '}
                  {builderDateConfiguration.shutterBeforeDmWeeks === 1 ? 'week' : 'weeks'} before DM
                </Typography>
              )}
            </Box>
            <Chip
              size="small"
              label={isEditing ? activeType?.shortLabel : '3 events'}
              color="primary"
              variant="outlined"
            />
          </Box>

          <Stack spacing={1.5}>
            {(!isEditing || activeActivityType === 'EXT') && (
              <StageCard
                activityType="EXT"
                tone={getActivityTone('EXT', draft.extOrderMaterial)}
                date={draft.extDate}
                dateOwner={draft.extDateOwner}
                note={draft.extDateNote}
                onDateChange={(value) => onChange(getProductionDateCascade(
                  draft,
                  'EXT',
                  value,
                  builderDateConfiguration,
                ))}
                onDateOwnerChange={(value) => onChange({ extDateOwner: value })}
                onNoteChange={(value) => onChange({ extDateNote: value })}
              >
                {isEditing && (
                  <Box className="activity-options-card">
                    <OptionCheckbox
                      checked={draft.extOrderMaterial}
                      label="Order Material"
                      description="Mark the EXT event yellow when material must be ordered."
                      onChange={(checked) => onChange({ extOrderMaterial: checked })}
                    />
                    <OptionCheckbox
                      checked={draft.extInstallOnly}
                      label="Install only"
                      description="Add a separate EXT install-only event."
                      onChange={(checked) => onChange({
                        extInstallOnly: checked,
                        extInstallDate: checked ? draft.extInstallDate : '',
                        extInstallDateOwner: checked
                          ? (draft.extInstallDateOwner || draft.extDateOwner)
                          : '',
                        extInstallDateNote: checked ? draft.extInstallDateNote : '',
                      })}
                    />
                    {draft.extInstallOnly && (
                      <Box className="activity-option-date-group">
                        <DateField
                          label="EXT install-only date"
                          value={draft.extInstallDate}
                          onChange={(date) => onChange({ extInstallDate: date })}
                          fullWidth
                          required
                          size="small"
                          className="activity-option-date"
                        />
                        <DateOwnerSelector
                          value={draft.extInstallDateOwner}
                          onChange={(value) => onChange({ extInstallDateOwner: value })}
                          label="EXT install-only date ownership"
                          compact
                        />
                        <TextField
                          label="EXT install-only date note (optional)"
                          value={draft.extInstallDateNote}
                          onChange={(event) => onChange({ extInstallDateNote: event.target.value })}
                          slotProps={{ htmlInput: { maxLength: 100 } }}
                          helperText={`${draft.extInstallDateNote.length}/100`}
                          multiline
                          minRows={2}
                          fullWidth
                          size="small"
                          className="date-note-field"
                        />
                      </Box>
                    )}
                  </Box>
                )}
              </StageCard>
            )}

            {draft.dmShutters && isEditing && activeActivityType === 'SHUTTER' && (
              <StageCard
                activityType="SHUTTER"
                tone="shutter"
                date={draft.shutterDate}
                dateOwner={draft.shutterDateOwner}
                note={draft.shutterDateNote}
                onDateChange={(value) => onChange(getProductionDateCascade(
                  draft,
                  'SHUTTER',
                  value,
                  builderDateConfiguration,
                ))}
                onDateOwnerChange={(value) => onChange({ shutterDateOwner: value })}
                onNoteChange={(value) => onChange({ shutterDateNote: value })}
              />
            )}

            {(!isEditing || activeActivityType === 'DM') && (
              <StageCard
                activityType="DM"
                tone="dm"
                date={draft.dmDate}
                dateOwner={draft.dmDateOwner}
                note={draft.dmDateNote}
                onDateChange={(value) => onChange(getProductionDateCascade(
                  draft,
                  'DM',
                  value,
                  builderDateConfiguration,
                ))}
                onDateOwnerChange={(value) => onChange({ dmDateOwner: value })}
                onNoteChange={(value) => onChange({ dmDateNote: value })}
              >
                {isEditing && (
                  <>
                    <Box className="activity-options-card">
                      <OptionCheckbox
                        checked={draft.dmInstallOnly}
                        label="Install only"
                        description="Add a separate DM install-only event."
                        onChange={(checked) => onChange({
                          dmInstallOnly: checked,
                          dmInstallDate: checked ? draft.dmInstallDate : '',
                          dmInstallDateOwner: checked
                            ? (draft.dmInstallDateOwner || draft.dmDateOwner)
                            : '',
                          dmInstallDateNote: checked ? draft.dmInstallDateNote : '',
                        })}
                      />
                      {draft.dmInstallOnly && (
                        <Box className="activity-option-date-group">
                          <DateField
                            label="DM install-only date"
                            value={draft.dmInstallDate}
                            onChange={(date) => onChange({ dmInstallDate: date })}
                            fullWidth
                            required
                            size="small"
                            className="activity-option-date"
                          />
                          <DateOwnerSelector
                            value={draft.dmInstallDateOwner}
                            onChange={(value) => onChange({ dmInstallDateOwner: value })}
                            label="DM install-only date ownership"
                            compact
                          />
                          <TextField
                            label="DM install-only date note (optional)"
                            value={draft.dmInstallDateNote}
                            onChange={(event) => onChange({ dmInstallDateNote: event.target.value })}
                            slotProps={{ htmlInput: { maxLength: 100 } }}
                            helperText={`${draft.dmInstallDateNote.length}/100`}
                            multiline
                            minRows={2}
                            fullWidth
                            size="small"
                            className="date-note-field"
                          />
                        </Box>
                      )}
                      <OptionCheckbox
                        checked={draft.dmBaseboardInstall}
                        label="Baseboard install"
                        description="Add a separate DM baseboard install event."
                        onChange={(checked) => onChange({
                          dmBaseboardInstall: checked,
                          dmBaseboardInstallDate: checked ? draft.dmBaseboardInstallDate : '',
                          dmBaseboardInstallDateOwner: checked
                            ? (draft.dmBaseboardInstallDateOwner || draft.dmDateOwner)
                            : '',
                          dmBaseboardInstallDateNote: checked ? draft.dmBaseboardInstallDateNote : '',
                        })}
                      />
                      {draft.dmBaseboardInstall && (
                        <Box className="activity-option-date-group">
                          <DateField
                            label="DM baseboard install date"
                            value={draft.dmBaseboardInstallDate}
                            onChange={(date) => onChange({ dmBaseboardInstallDate: date })}
                            fullWidth
                            required
                            size="small"
                            className="activity-option-date"
                          />
                          <DateOwnerSelector
                            value={draft.dmBaseboardInstallDateOwner}
                            onChange={(value) => onChange({ dmBaseboardInstallDateOwner: value })}
                            label="DM baseboard install date ownership"
                            compact
                          />
                          <TextField
                            label="DM baseboard install date note (optional)"
                            value={draft.dmBaseboardInstallDateNote}
                            onChange={(event) => onChange({ dmBaseboardInstallDateNote: event.target.value })}
                            slotProps={{ htmlInput: { maxLength: 100 } }}
                            helperText={`${draft.dmBaseboardInstallDateNote.length}/100`}
                            multiline
                            minRows={2}
                            fullWidth
                            size="small"
                            className="date-note-field"
                          />
                        </Box>
                      )}
                      <OptionCheckbox
                        checked={draft.dmSplitPhase}
                        disabled={totalLots < 2}
                        label="Split phase"
                        description="Schedule groups of lots on different dates."
                        onChange={(checked) => toggleSplit('dm', checked, draft.dmDateOwner)}
                      />
                      <OptionCheckbox
                        checked={draft.dmShutters}
                        label="Shutter"
                        description={`Create a Shutter event ${builderDateConfiguration.shutterBeforeDmWeeks} ${builderDateConfiguration.shutterBeforeDmWeeks === 1 ? 'week' : 'weeks'} before DM.`}
                        onChange={(checked) => onChange({
                          dmShutters: checked,
                          shutterDate: checked
                            ? calculateShutterDate(draft.dmDate, builderDateConfiguration)
                            : draft.shutterDate,
                          shutterDateOwner: checked
                            ? (draft.shutterDateOwner || draft.dmDateOwner)
                            : draft.shutterDateOwner,
                        })}
                      />
                    </Box>
                    {draft.dmSplitPhase && (
                      <SplitScheduleEditor
                        activityType="DM"
                        parts={draft.dmSplitParts}
                        totalLots={totalLots}
                        lotNumbers={draft.lotNumbers}
                        onChange={(parts) => onChange({ dmSplitParts: parts })}
                        onReset={() => onChange({
                          dmSplitParts: createDefaultSplitParts(draft, draft.dmDateOwner),
                        })}
                      />
                    )}
                  </>
                )}
              </StageCard>
            )}

            {(!isEditing || activeActivityType === 'HW') && (
              <StageCard
                activityType="HW"
                tone="hw"
                date={draft.hwDate}
                dateOwner={draft.hwDateOwner}
                note={draft.hwDateNote}
                onDateChange={(value) => onChange(getProductionDateCascade(
                  draft,
                  'HW',
                  value,
                  builderDateConfiguration,
                ))}
                onDateOwnerChange={(value) => onChange({ hwDateOwner: value })}
                onNoteChange={(value) => onChange({ hwDateNote: value })}
              >
                {isEditing && (
                  <>
                    <Box className="activity-options-card">
                      <OptionCheckbox
                        checked={draft.hwSplitPhase}
                        disabled={totalLots < 2}
                        label="Split phase"
                        description="Schedule groups of lots on different dates."
                        onChange={(checked) => toggleSplit('hw', checked, draft.hwDateOwner)}
                      />
                      <OptionCheckbox
                        checked={draft.hwLockUp}
                        label="Lock up"
                        description="Add a separate Hardware lock-up event."
                        onChange={(checked) => onChange({
                          hwLockUp: checked,
                          hwLockUpDate: checked ? draft.hwLockUpDate : '',
                          hwLockUpDateOwner: checked
                            ? (draft.hwLockUpDateOwner || draft.hwDateOwner)
                            : '',
                          hwLockUpDateNote: checked ? draft.hwLockUpDateNote : '',
                        })}
                      />
                      {draft.hwLockUp && (
                        <Box className="activity-option-date-group">
                          <DateField
                            label="Hardware lock-up date"
                            value={draft.hwLockUpDate}
                            onChange={(date) => onChange({ hwLockUpDate: date })}
                            fullWidth
                            required
                            size="small"
                            className="activity-option-date"
                          />
                          <DateOwnerSelector
                            value={draft.hwLockUpDateOwner}
                            onChange={(value) => onChange({ hwLockUpDateOwner: value })}
                            label="Hardware lock-up date ownership"
                            compact
                          />
                          <TextField
                            label="Hardware lock-up date note (optional)"
                            value={draft.hwLockUpDateNote}
                            onChange={(event) => onChange({ hwLockUpDateNote: event.target.value })}
                            slotProps={{ htmlInput: { maxLength: 100 } }}
                            helperText={`${draft.hwLockUpDateNote.length}/100`}
                            multiline
                            minRows={2}
                            fullWidth
                            size="small"
                            className="date-note-field"
                          />
                        </Box>
                      )}
                    </Box>
                    {draft.hwSplitPhase && (
                      <SplitScheduleEditor
                        activityType="HW"
                        parts={draft.hwSplitParts}
                        totalLots={totalLots}
                        lotNumbers={draft.lotNumbers}
                        onChange={(parts) => onChange({ hwSplitParts: parts })}
                        onReset={() => onChange({
                          hwSplitParts: createDefaultSplitParts(draft, draft.hwDateOwner),
                        })}
                      />
                    )}
                  </>
                )}
              </StageCard>
            )}
          </Stack>
        </Box>

        <Box className="activity-form__section">
          <TextField
            label="General production notes"
            value={draft.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            multiline
            rows={3}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </Box>

        <Alert severity="info" icon={<EventAvailableRoundedIcon />}>
          {isEditing
            ? `Only the selected ${activeType?.shortLabel ?? ''} event is being configured.`
            : 'All events are all-day. Open DM later to enable Shutter and configure its event.'}
        </Alert>
      </Box>

      <Box className="activity-drawer__footer">
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={saving} disableElevation>
          {saving
            ? 'Saving...'
            : dateMove
            ? 'Confirm date change'
            : isEditing
            ? `Save ${activeType?.shortLabel ?? 'event'}`
            : 'Create 3 events'}
        </Button>
      </Box>
    </Box>
  )
}
