import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { getJobPlanCount } from '../../jobs/data/jobs.js'
import { createPhaseByLotSchema } from '../schemas/phaseByLotSchema.js'
import { formatPhase } from '../utils/phaseBuildingCodes.js'
import { addLotRanges, lotNumbersOfRanges } from '../utils/lotRange.js'
import PriorChangeOrderNotice from '../../change-orders/components/PriorChangeOrderNotice.jsx'
import LotRangeField from './LotRangeField.jsx'
import UtilityRowEditor from './UtilityRowEditor.jsx'
import LotEditor from './LotEditor.jsx'

const emptyLot = {
  lotNumber: '',
  utilityName: '',
  planId: '',
  elevation: '',
  reverse: false,
  optionIds: [],
  optionDetails: {},
  isUtilityBuilding: false,
}

const emptyUtilityRow = {
  ...emptyLot,
  isUtilityBuilding: true,
}

export default function PhaseDialog({
  job,
  phase,
  utilityBuildingEnabled,
  utilityBuildingRequired,
  onClose,
  onSave,
}) {
  // The chips of the Lots to add, what is being typed after them, and what is wrong with it.
  const [lotRanges, setLotRanges] = useState([])
  const [lotRangeInput, setLotRangeInput] = useState('')
  const [lotRangeError, setLotRangeError] = useState('')
  const schema = useMemo(
    () => createPhaseByLotSchema(job, phase?.id, utilityBuildingRequired),
    [job, phase?.id, utilityBuildingRequired],
  )
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: phase
      ? {
          phaseName: phase.name,
          building: phase.building,
          lots: (phase.lots ?? []).map((lot) => ({
            id: lot.id,
            lotNumber: lot.lotNumber,
            utilityName: lot.utilityName ?? '',
            planId: lot.planId,
            elevation: lot.elevation ?? '',
            reverse: lot.reverse ?? false,
            optionIds: [...(lot.optionIds ?? [])],
            optionDetails: structuredClone(lot.optionDetails ?? {}),
            isUtilityBuilding: Boolean(lot.isUtilityBuilding),
          })),
        }
      : {
          phaseName: '',
          building: '',
          lots: utilityBuildingRequired
            ? [{ ...emptyLot }, { ...emptyUtilityRow }]
            : [{ ...emptyLot }],
        },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'lots',
    keyName: 'fieldKey',
  })
  const hasPlans = (job.sequenceSheet?.plans?.length ?? 0) > 0
  // The Lots being added or edited, to tell if an Extra / CO was made for any of them before they existed.
  const typedLotNumbers = (useWatch({ control, name: 'lots' }) ?? [])
    .filter((lot) => !lot.isUtilityBuilding)
    .map((lot) => lot.lotNumber?.trim())
    .filter(Boolean)

  // What the Phase already holds and how many Lots it can still take. An empty first row is not a Lot:
  // the new ones take its place.
  const lotRangeContext = () => {
    const currentLots = getValues('lots') ?? []
    const ordinaryLots = currentLots.filter((lot) => !lot.isUtilityBuilding)
    const initialEmptyLot = ordinaryLots.length === 1 ? ordinaryLots[0] : null
    const hasReplaceableInitialLot = Boolean(
      initialEmptyLot
      && !initialEmptyLot.lotNumber?.trim()
      && !initialEmptyLot.planId
      && !initialEmptyLot.reverse
      && (initialEmptyLot.optionIds?.length ?? 0) === 0,
    )

    return {
      currentLots,
      initialEmptyLotIndex: hasReplaceableInitialLot ? currentLots.indexOf(initialEmptyLot) : -1,
      capacity: hasReplaceableInitialLot
        ? Math.max(500 - currentLots.length + 1, 0)
        : Math.max(500 - currentLots.length, 0),
      existing: new Set(
        currentLots
          .filter((lot) => !lot.isUtilityBuilding)
          .map((lot) => lot.lotNumber?.trim().toUpperCase())
          .filter(Boolean),
      ),
    }
  }

  const addLotRange = () => {
    const context = lotRangeContext()

    if (context.capacity === 0) {
      setLotRangeError('A phase can contain up to 500 lots.')
      return
    }

    // What is typed and not yet a chip is added too.
    const batch = addLotRanges(lotRanges, lotRangeInput, context)
    if (batch.error) {
      setLotRangeError(batch.error)
      return
    }

    const lotNumbers = lotNumbersOfRanges(batch.ranges)
    if (lotNumbers.length === 0) {
      setLotRangeError('Type one or more lots or ranges.')
      return
    }

    const generatedLots = lotNumbers.map((lotNumber) => ({
      ...emptyLot,
      lotNumber,
    }))

    if (context.initialEmptyLotIndex >= 0) {
      replace(context.currentLots.flatMap((lot, index) =>
        index === context.initialEmptyLotIndex ? generatedLots : [lot]))
    } else {
      append(generatedLots)
    }

    setLotRanges([])
    setLotRangeInput('')
    setLotRangeError('')
  }

  return (
    <Dialog
      open
      onClose={isSubmitting ? undefined : onClose}
      fullWidth
      maxWidth="lg"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
      slotProps={{
        paper: {
          sx: {
            maxHeight: { xs: '100%', sm: 'calc(100% - 48px)' },
            m: { xs: 0, sm: 3 },
            borderRadius: { xs: 0, sm: 2 },
          },
        },
      }}
    >
      <DialogTitle sx={{ pr: 7, pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={750}>
          {phase ? `Edit ${formatPhase(phase.name)}` : 'Create Phase'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {phase
            ? `Update its Lot and Utility Building assignments for Job #${job.code}.`
            : `Add Lots and, when enabled, Utility Building rows to Job #${job.code}.`}
        </Typography>
        <IconButton
          onClick={onClose}
          disabled={isSubmitting}
          aria-label={phase ? 'Close edit phase dialog' : 'Close create phase dialog'}
          sx={{ position: 'absolute', right: 16, top: 14 }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.5}>
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              bgcolor: 'action.hover',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="overline" color="text.secondary" fontWeight={700}>
                  Sequence Sheet · Job #{job.code}
                </Typography>
                <Typography fontWeight={750}>
                  {job.community} · {job.builder}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getJobPlanCount(job)} plans available
                </Typography>
              </Box>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'flex-start' } }}
              >
                <TextField
                  label="Phase number / code"
                  placeholder="Example: 3"
                  {...register('phaseName')}
                  error={Boolean(errors.phaseName)}
                  helperText={errors.phaseName?.message ?? 'Enter only the number or code'}
                  sx={{ minWidth: { sm: 280 } }}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">Phase</InputAdornment>,
                    },
                    htmlInput: { maxLength: 40 },
                  }}
                />
                <TextField
                  label="Building number / code (optional)"
                  placeholder="Example: 3 or C5"
                  {...register('building')}
                  error={Boolean(errors.building)}
                  helperText={errors.building?.message ?? 'Only the number or code. Leave empty if this phase has no building.'}
                  sx={{ minWidth: { sm: 190 } }}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">Building</InputAdornment>,
                    },
                    htmlInput: { maxLength: 50 },
                  }}
                />
                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => append({ ...emptyLot })}
                  sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
                >
                  Add lot
                </Button>
                {utilityBuildingEnabled && (
                  <Button
                    type="button"
                    variant="outlined"
                    color="primary"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => append({ ...emptyUtilityRow })}
                    sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
                  >
                    Add Utility
                  </Button>
                )}
              </Stack>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ alignItems: { sm: 'flex-start' } }}
            >
              <Box sx={{ flex: { sm: '0 1 220px' } }}>
                <Typography variant="subtitle2" fontWeight={750}>
                  Add lots or lot ranges
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Assign a plan, Reverse and options to each lot.
                </Typography>
              </Box>
              <LotRangeField
                sx={{ flex: 1, minWidth: 0, width: { xs: '100%', sm: 'auto' } }}
                ranges={lotRanges}
                onRangesChange={setLotRanges}
                typed={lotRangeInput}
                onTypedChange={setLotRangeInput}
                error={lotRangeError}
                onErrorChange={setLotRangeError}
                getContext={lotRangeContext}
                onSubmit={addLotRange}
              />
              <Button
                type="button"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={addLotRange}
                disableElevation
                sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
              >
                Add lots
              </Button>
            </Stack>
            {utilityBuildingEnabled && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {utilityBuildingRequired
                  ? 'Utility Building is active for this Job. Every Phase must include at least one named Utility row with a Plan; Reverse is optional.'
                  : 'Utility rows use only the full Plan Price and may be marked Reverse. They do not count as Lots or appear in Lot ranges, and cannot include Options or Hardware.'}
              </Alert>
            )}
          </Box>

          <PriorChangeOrderNotice jobId={job.id} lotNumbers={typedLotNumbers} />

          {!hasPlans && (
            <Alert severity="warning">
              This Job has no plans yet. Add at least one plan from Jobs before saving a phase.
            </Alert>
          )}

          {(errors.lots?.message || errors.lots?.root?.message) && (
            <Alert severity="error">
              {errors.lots.message ?? errors.lots.root.message}
            </Alert>
          )}

          <Stack spacing={2}>
            {fields.map((field, index) => field.isUtilityBuilding ? (
              <UtilityRowEditor
                key={field.fieldKey}
                index={index}
                job={job}
                control={control}
                register={register}
                errors={errors}
                remove={remove}
                canRemove={fields.length > 1}
              />
            ) : (
              <LotEditor
                key={field.fieldKey}
                fieldId={field.fieldKey}
                index={index}
                job={job}
                control={control}
                register={register}
                errors={errors}
                setValue={setValue}
                remove={remove}
                canRemove={fields.length > 1}
              />
            ))}
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Button color="inherit" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disableElevation
          disabled={!hasPlans || isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {isSubmitting ? 'Saving…' : phase ? 'Save changes' : 'Create phase'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
