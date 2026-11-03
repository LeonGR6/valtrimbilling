import { useEffect, useMemo, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
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
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { priorityOptions } from '../data/customerService.js'
import {
  buildCustomerServiceBuilderOptions,
  customerServiceJobCoordinatesValue,
  resolveCustomerServiceBuilder,
  resolveCustomerServiceJob,
} from '../data/customerServiceJobCatalog.js'
import {
  extractCustomerServiceEmailText,
  extractCustomerServicePdf,
} from '../services/customerServicePdfExtraction.js'
import {
  buildPrototypeSourceDocument,
  calculateGeneralFixDuration,
  calculatePrototypeDueDate,
  canSavePartialImportedRequest,
  completedRequestEditSchema,
  createRequestedWorkItem,
  findDuplicateRequestedWorkItemDescriptions,
  hasNewRequestSource,
  isRequestPlanningLocked,
  importedRequestDraftSchema,
  importedRequestStandardEditSchema,
  maxRequestedWorkItemDescriptionCharacters,
  maxRequestedWorkItems,
  newRequestDraftSchema,
  newRequestPrototypeSchema,
  parsePrototypeCoordinates,
  prototypeServiceTaskOptions,
  prototypeWorkTypeOptions,
  requestAdministrativeEditSchema,
  renumberRequestedWorkItems,
  requestToPrototypeFormValues,
  serviceKindOptions,
  summarizeNewRequestFormErrors,
  validatePrototypeSourcePdf,
} from '../utils/newRequestPrototype.js'
import {
  hasCustomGeneralFixDuration,
  missingRequestPlanningValues,
  planningForTask,
} from '../utils/customerServicePlanning.js'
import {
  buildNewRequestDraftFromPdf,
  customerServicePdfExcludedWorkItems,
  customerServicePdfRequestedWorkItems,
  pdfExtractionConfidenceLabel,
} from '../utils/pdfExtraction.js'
import {
  customerServiceTimeZone,
  formatLongDate,
  formatUsDateInput,
  getCustomerServiceClock,
  parseUsDateInput,
} from '../utils/dates.js'
import { createCustomerServiceSubmissionKey } from '../utils/customerServiceIntake.js'
import {
  buildRequestReviewSummary,
  effectiveRequestWorkflowStage,
  isRequestOverdue,
  requestWorkflowStages,
} from '../utils/requestInbox.js'

function SectionHeading({ title, description }) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={800}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      )}
    </Box>
  )
}

function ReviewCheck({ check }) {
  const Icon = check.complete ? CheckCircleRoundedIcon : ErrorOutlineRoundedIcon

  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
      <Icon
        color={check.complete ? 'success' : 'warning'}
        fontSize="small"
        sx={{ mt: 0.25, flexShrink: 0 }}
      />
      <Box>
        <Typography variant="body2" fontWeight={800}>
          {check.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {check.complete ? check.completeDetail : check.incompleteDetail}
        </Typography>
      </Box>
    </Stack>
  )
}

function SelectField({
  control,
  name,
  label,
  options,
  error,
  helperText,
  onValueChange,
  disabled = false,
  readOnly = false,
  required = false,
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControl error={Boolean(error)} fullWidth required={required}>
          <InputLabel id={`new-request-${name}-label`} required={required}>{label}</InputLabel>
          <Select
            {...field}
            labelId={`new-request-${name}-label`}
            label={label}
            disabled={readOnly || disabled}
            onChange={(event) => {
              field.onChange(event)
              onValueChange?.(event.target.value)
            }}
          >
            {field.value && !options.some((option) => option.value === field.value) && (
              <MenuItem value={field.value} disabled>{field.value} · needs review</MenuItem>
            )}
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{error?.message ?? helperText ?? ' '}</FormHelperText>
        </FormControl>
      )}
    />
  )
}

function ControlledTextField({
  control,
  name,
  error,
  helperText,
  onValueChange,
  slotProps,
  readOnly = false,
  ...props
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const { ref, ...controlledField } = field
        const hasValue = field.value !== '' && field.value !== null && field.value !== undefined
        const inputLabelSlotProps = typeof slotProps?.inputLabel === 'object'
          ? slotProps.inputLabel
          : {}

        return (
          <TextField
            {...props}
            {...controlledField}
            value={field.value ?? ''}
            onChange={(event) => {
              field.onChange(event)
              onValueChange?.(event.target.value)
            }}
            inputRef={ref}
            error={Boolean(error)}
            helperText={error?.message ?? helperText ?? ' '}
            slotProps={{
              ...slotProps,
              htmlInput: {
                ...slotProps?.htmlInput,
                ...(readOnly ? { readOnly: true } : {}),
              },
              inputLabel: {
                ...inputLabelSlotProps,
                ...(hasValue || props.type === 'date' || props.type === 'number'
                  ? { shrink: true }
                  : {}),
              },
            }}
          />
        )
      }}
    />
  )
}

function ControlledUsDateField({
  control,
  name,
  error,
  helperText,
  onValueChange,
  readOnly = false,
  ...props
}) {
  const nativePickerRef = useRef(null)

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const { ref, ...controlledField } = field
        const displayValue = formatUsDateInput(field.value)
        const pickerValue = parseUsDateInput(displayValue) === field.value ? field.value : ''

        const updateValue = (value) => {
          field.onChange(value)
          onValueChange?.(value)
        }

        const openPicker = () => {
          if (readOnly) return
          if (typeof nativePickerRef.current?.showPicker === 'function') {
            nativePickerRef.current.showPicker()
          } else {
            nativePickerRef.current?.click()
          }
        }

        return (
          <Box sx={{ position: 'relative' }}>
            <TextField
              {...props}
              {...controlledField}
              value={displayValue}
              onChange={(event) => {
                const displayDate = event.target.value
                updateValue(parseUsDateInput(displayDate) || displayDate)
              }}
              inputRef={ref}
              error={Boolean(error)}
              helperText={error?.message ?? helperText ?? ' '}
              placeholder="MM/DD/YYYY"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="Choose reported date"
                        disabled={readOnly}
                        edge="end"
                        onClick={openPicker}
                      >
                        <CalendarMonthRoundedIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  inputMode: 'numeric',
                  maxLength: 10,
                  ...(readOnly ? { readOnly: true } : {}),
                },
                inputLabel: { shrink: true },
              }}
            />
            <input
              ref={nativePickerRef}
              aria-hidden="true"
              tabIndex={-1}
              type="date"
              value={pickerValue}
              onChange={(event) => updateValue(event.target.value)}
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clipPath: 'inset(50%)',
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
          </Box>
        )
      }}
    />
  )
}

function formatPdfSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MAX_EMAIL_TEXT_CHARACTERS = 50_000

const reportedAtSourceLabels = {
  EMAIL_SENT: 'Original email date',
  ORDER_DATE: 'PDF Order Date',
  SCHEDULED_DATE: 'Source Scheduled Date',
  MANUAL: 'Manual or default date',
}

function describedRequestedWorkItemCount(items) {
  return items.filter((item) => item.description.trim()).length
}

function requestFormDefaults(request, now) {
  if (!request) {
    return {
      reportedAt: getCustomerServiceClock(now).date,
      priority: 'MEDIUM',
      builderName: '',
      jobId: '',
      community: '',
      lotNumber: '',
      address: '',
      coordinates: '',
      contactName: '',
      contactPhoneCountry: 'US',
      contactPhone: '',
      contactEmail: '',
      additionalContacts: [],
      additionalContactName: '',
      additionalContactPhoneCountry: 'US',
      additionalContactPhone: '',
      additionalContactEmail: '',
      serviceKind: '',
      workType: '',
      serviceTask: '',
      requestedWorkItems: [createRequestedWorkItem()],
      estimatedDurationMinutes: '',
      crewSize: '',
      internalNotes: '',
      sourceEmailFrom: '',
      sourceEmailSubject: '',
    }
  }

  return requestToPrototypeFormValues(request)
}

export default function NewRequestPrototypeDialog({
  request = null,
  emailImport = null,
  recoveryRequest = null,
  currentUserName,
  onClose,
  onCreate,
  onSave,
  onMarkReady,
  onEdit,
  onViewSource,
  onOpenProposal,
  readOnly = false,
}) {
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const {
    builders,
    loading: buildersLoading,
    error: buildersError,
    refreshBuilders,
  } = useBuilders()
  const {
    jobs,
    loading: jobsLoading,
    error: jobsError,
    refreshJobs,
  } = useJobs()
  const now = useMemo(() => new Date(), [])
  const isEditMode = Boolean(request)
  const isRecoveryUpload = Boolean(emailImport?.requestId)
  const isReadOnlyMode = isEditMode && readOnly
  const planningLocked = isRequestPlanningLocked(request)
  const isFormDataReadOnly = isReadOnlyMode || planningLocked || isRecoveryUpload
  const workflowStage = request ? effectiveRequestWorkflowStage(request) : 'NEEDS_REVIEW'
  const isCompleted = workflowStage === 'COMPLETED'
  const workflow = requestWorkflowStages[workflowStage] ?? requestWorkflowStages.NEEDS_REVIEW
  const canSaveIncomplete = !request || ['NEEDS_REVIEW', 'READY_TO_PROPOSE'].includes(workflowStage)
  const canSavePartialImport = Boolean(emailImport) || canSavePartialImportedRequest(request)
  const requestReview = useMemo(
    () => (request ? buildRequestReviewSummary(request) : null),
    [request],
  )
  const builderOptions = useMemo(
    () => buildCustomerServiceBuilderOptions(builders, jobs),
    [builders, jobs],
  )
  const catalogLoading = buildersLoading || jobsLoading
  const catalogError = buildersError || jobsError
  const defaultValues = useMemo(() => {
    if (!emailImport) return requestFormDefaults(request, now)
    return {
      ...requestFormDefaults(recoveryRequest, now),
      ...(!recoveryRequest && { reportedAt: '' }),
      sourceEmailFrom: emailImport.originalSender ?? '', sourceEmailSubject: emailImport.originalSubject ?? '',
    }
  }, [emailImport, now, recoveryRequest, request])
  const initialRequestedWorkItems = defaultValues.requestedWorkItems
  const [sourceInputMode, setSourceInputMode] = useState(
    request?.sourceEmail?.body ? 'EMAIL_TEXT' : 'PDF',
  )
  const [sourcePdf, setSourcePdf] = useState(null)
  const [sourceEmailText, setSourceEmailText] = useState(request?.sourceEmail?.body ?? '')
  const [sourceExtractionError, setSourceExtractionError] = useState('')
  const [saveError, setSaveError] = useState('')
  const saveErrorRef = useRef(null)
  const [savedSubmission, setSavedSubmission] = useState(null)
  const [retryingSave, setRetryingSave] = useState(false)
  useEffect(() => {
    if (!saveError) return
    saveErrorRef.current?.scrollIntoView({ block: 'nearest' })
    saveErrorRef.current?.focus()
  }, [saveError])
  const [sourceExtraction, setSourceExtraction] = useState(null)
  const [reportedAtSource, setReportedAtSource] = useState(
    request?.reportedAtSource ?? 'MANUAL',
  )
  const [isExtractingSource, setIsExtractingSource] = useState(false)
  const [isPdfDragging, setIsPdfDragging] = useState(false)
  const [pdfAutofillReview, setPdfAutofillReview] = useState(null)
  const [expandedWorkItemIndex, setExpandedWorkItemIndex] = useState(0)
  const [isDurationManuallyOverridden, setIsDurationManuallyOverridden] = useState(
    () => isEditMode && hasCustomGeneralFixDuration(defaultValues),
  )
  const planningAutofillRequestRef = useRef(null)
  const planningSuggestionsApplied = useMemo(() => Boolean(request)
    && !isFormDataReadOnly && workflowStage === 'NEEDS_REVIEW'
    && Object.keys(missingRequestPlanningValues(defaultValues,
      request.sourceDocument?.extraction?.structuredData?.serviceItems ?? [])).length > 0,
  [defaultValues, isFormDataReadOnly, request, workflowStage])
  const [reapplyExtractedDataStatus, setReapplyExtractedDataStatus] = useState('idle')
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false)
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false)
  const [canUndoExtractedDataReset, setCanUndoExtractedDataReset] = useState(false)
  const [showValidationSummary, setShowValidationSummary] = useState(false)
  const [valtrimItemsConfirmed, setValtrimItemsConfirmed] = useState(
    Boolean(request?.review?.valtrimItemsConfirmed),
  )
  const [approving, setApproving] = useState(false)
  const approvalPendingRef = useRef(false)
  const approveRequest = async () => {
    if (approvalPendingRef.current || !onMarkReady || !valtrimItemsConfirmed) return
    approvalPendingRef.current = true
    setApproving(true)
    setSaveError(null)
    try {
      await onMarkReady(request, { valtrimItemsConfirmed })
    } catch (error) {
      setSaveError(error.message || 'The request could not be approved. Try again.')
    } finally {
      approvalPendingRef.current = false
      setApproving(false)
    }
  }
  const [includedExcludedItems, setIncludedExcludedItems] = useState([])
  const [submissionKey] = useState(createCustomerServiceSubmissionKey)
  const extractionRequestRef = useRef(0)
  const reapplyExtractedDataTimerRef = useRef(null)
  const extractedDataResetSnapshotRef = useRef(null)
  const reportedAtManuallyChangedRef = useRef(false)
  const workItemDescriptionRefs = useRef(new Map())
  const workItemsSectionRef = useRef(null)
  const addWorkItemButtonRef = useRef(null)

  useEffect(() => () => {
    extractionRequestRef.current += 1
    window.clearTimeout(reapplyExtractedDataTimerRef.current)
  }, [])

  const {
    control,
    getValues,
    handleSubmit,
    clearErrors,
    setError,
    setFocus,
    setValue,
    trigger,
    formState: { errors, isDirty, isSubmitting, isValid },
  } = useForm({
    resolver: zodResolver(isCompleted ? completedRequestEditSchema
      : planningLocked ? requestAdministrativeEditSchema
      : canSavePartialImport ? importedRequestDraftSchema
      : request?.emailImportId ? importedRequestStandardEditSchema
      : canSaveIncomplete ? newRequestDraftSchema : newRequestPrototypeSchema),
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  })
  const saving = isSubmitting || retryingSave || approving

  const {
    append: appendRequestedWorkItem,
    replace: replaceRequestedWorkItems,
  } = useFieldArray({
    control,
    name: 'requestedWorkItems',
    keyName: 'fieldKey',
  })
  const {
    fields: additionalCustomerFields,
    append: appendAdditionalCustomer,
    remove: removeAdditionalCustomer,
  } = useFieldArray({ control, name: 'additionalContacts', keyName: 'fieldKey' })

  const selectedBuilder = useWatch({ control, name: 'builderName' })
  const selectedJobId = useWatch({ control, name: 'jobId' })
  const selectedCommunity = useWatch({ control, name: 'community' })
  const lotNumberValue = useWatch({ control, name: 'lotNumber' })
  const selectedServiceTask = useWatch({ control, name: 'serviceTask' })
  const reportedAtValue = useWatch({ control, name: 'reportedAt' })
  const addressValue = useWatch({ control, name: 'address' })
  const coordinatesValue = useWatch({ control, name: 'coordinates' })
  const requestedWorkItems = useWatch({
    control,
    name: 'requestedWorkItems',
    defaultValue: initialRequestedWorkItems,
  })
  const coordinates = parsePrototypeCoordinates(coordinatesValue)
  const describedWorkItemCount = describedRequestedWorkItemCount(requestedWorkItems)
  const suggestedGeneralFixDuration = calculateGeneralFixDuration(describedWorkItemCount)
  useEffect(() => {
    if (!request || isFormDataReadOnly || workflowStage !== 'NEEDS_REVIEW'
      || planningAutofillRequestRef.current === request.id) return
    planningAutofillRequestRef.current = request.id
    const patch = missingRequestPlanningValues(getValues(),
      request.sourceDocument?.extraction?.structuredData?.serviceItems ?? [])
    if (!Object.keys(patch).length) return
    Object.entries(patch).forEach(([field, value]) => {
      setValue(field, value, { shouldDirty: true, shouldValidate: true })
    })
  }, [getValues, isFormDataReadOnly, request, setValue, workflowStage])
  let dueOnPreview = ''
  try {
    dueOnPreview = calculatePrototypeDueDate(reportedAtValue)
  } catch {
    // The form validation owns the visible error for incomplete or invalid dates.
  }
  const duplicateRequestedWorkItems = useMemo(
    () => findDuplicateRequestedWorkItemDescriptions(requestedWorkItems),
    [requestedWorkItems],
  )
  const visibleErrors = showValidationSummary ? errors : {}
  const validationErrorSummary = summarizeNewRequestFormErrors(visibleErrors)
  const builderSelectOptions = builderOptions
  const selectedBuilderOption = resolveCustomerServiceBuilder(
    selectedBuilder,
    builderOptions,
  ).match
  const jobOptions = (selectedBuilderOption?.jobs ?? []).map((job) => ({
    value: job.id,
    label: job.label,
  }))
  const selectedJob = selectedBuilderOption
    ? selectedBuilderOption.jobs.find(
      (job) => String(job.id) === String(selectedJobId),
    ) ?? resolveCustomerServiceJob(
      selectedCommunity,
      selectedBuilderOption,
      builderOptions,
    ).match
    : null

  useEffect(() => {
    if (!selectedBuilderOption || selectedBuilderOption.value === selectedBuilder) return
    setValue('builderName', selectedBuilderOption.value, { shouldDirty: false })
  }, [selectedBuilder, selectedBuilderOption, setValue])

  useEffect(() => {
    if (!selectedJob || String(selectedJob.id) === String(selectedJobId)) return
    setValue('jobId', selectedJob.id, { shouldDirty: false })
  }, [selectedJob, selectedJobId, setValue])
  const sourceConfidenceLabel = sourceExtraction
    ? pdfExtractionConfidenceLabel(sourceExtraction.pages)
    : ''
  const excludedSourceItems = useMemo(() => {
    if (!sourceExtraction) return []
    const includedSourceIndexes = new Set(
      includedExcludedItems.map((item) => item.sourceIndex),
    )
    return customerServicePdfExcludedWorkItems(sourceExtraction.structuredData)
      .filter((item) => !includedSourceIndexes.has(item.sourceIndex))
  }, [includedExcludedItems, sourceExtraction])
  const isAutofillApplying = isExtractingSource || reapplyExtractedDataStatus === 'loading'
  const hasSource = hasNewRequestSource({ sourceInputMode, sourcePdf, sourceEmailText })
  const hasUnsavedChanges = !isReadOnlyMode && (isDirty || (!isEditMode && (
    Boolean(sourcePdf)
    || Boolean(sourceEmailText.trim())
    || Boolean(sourceExtraction)
  )))
  const locationValidationReadyRef = useRef(false)
  useEffect(() => {
    if (!locationValidationReadyRef.current) {
      locationValidationReadyRef.current = true
      return
    }
    void trigger(['address', 'coordinates'])
  }, [addressValue, coordinatesValue, lotNumberValue, selectedCommunity, trigger])

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined

    const preventUnsavedPageExit = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnsavedPageExit)
    return () => window.removeEventListener('beforeunload', preventUnsavedPageExit)
  }, [hasUnsavedChanges])

  const applyPdfStructuredData = (structuredData, { forceReportedOn = false } = {}) => {
    const draft = buildNewRequestDraftFromPdf(structuredData, {
      builderOptions,
    })

    const extractedFieldDefaults = {
      builderName: '',
      jobId: '',
      community: '',
      lotNumber: '',
      address: '',
      coordinates: '',
      contactName: '',
      contactPhoneCountry: 'US',
      contactPhone: '',
      contactEmail: '',
      additionalContacts: [],
      additionalContactName: '',
      additionalContactPhoneCountry: 'US',
      additionalContactPhone: '',
      additionalContactEmail: '',
      serviceKind: '',
      workType: '',
      serviceTask: '',
      estimatedDurationMinutes: '',
      crewSize: '',
      ...(!emailImport && sourceInputMode === 'PDF'
        ? { sourceEmailFrom: '', sourceEmailSubject: '' }
        : {}),
    }
    const extractedValues = { ...extractedFieldDefaults, ...draft.values }
    if (emailImport) {
      delete extractedValues.sourceEmailFrom
      delete extractedValues.sourceEmailSubject
    }
    const shouldApplyReportedOn = Boolean(draft.values.reportedAt)
      && (forceReportedOn || !reportedAtManuallyChangedRef.current)
    if (!shouldApplyReportedOn) delete extractedValues.reportedAt

    Object.entries(extractedValues).forEach(([name, value]) => {
      setValue(name, value, { shouldDirty: true, shouldValidate: true })
    })
    if (shouldApplyReportedOn) {
      setReportedAtSource(draft.reportedAtSource)
      reportedAtManuallyChangedRef.current = false
    }
    setIsDurationManuallyOverridden(false)
    const extractedItems = customerServicePdfRequestedWorkItems(structuredData)
    replaceRequestedWorkItems(extractedItems)
    setIncludedExcludedItems([])
    void trigger('requestedWorkItems')
    setExpandedWorkItemIndex(extractedItems.length > 0 ? 0 : null)
    setPdfAutofillReview(draft)
    return draft
  }

  const cancelReapplyExtractedDataFeedback = () => {
    window.clearTimeout(reapplyExtractedDataTimerRef.current)
    reapplyExtractedDataTimerRef.current = null
    setReapplyExtractedDataStatus('idle')
  }

  const clearExtractedDataResetSnapshot = () => {
    extractedDataResetSnapshotRef.current = null
    setCanUndoExtractedDataReset(false)
  }

  const reapplyExtractedData = () => {
    if (!sourceExtraction || reapplyExtractedDataStatus === 'loading') return

    const currentValues = getValues()
    extractedDataResetSnapshotRef.current = {
      values: {
        ...currentValues,
        requestedWorkItems: currentValues.requestedWorkItems.map((item) => ({ ...item })),
        additionalContacts: currentValues.additionalContacts.map((contact) => ({ ...contact })),
      },
      expandedWorkItemIndex,
      isDurationManuallyOverridden,
      includedExcludedItems: includedExcludedItems.map((item) => ({ ...item })),
      reportedAtSource,
      reportedAtManuallyChanged: reportedAtManuallyChangedRef.current,
    }
    setCanUndoExtractedDataReset(true)
    setResetConfirmationOpen(false)
    window.clearTimeout(reapplyExtractedDataTimerRef.current)
    setReapplyExtractedDataStatus('loading')
    reapplyExtractedDataTimerRef.current = window.setTimeout(() => {
      applyPdfStructuredData(sourceExtraction.structuredData, { forceReportedOn: true })
      setReapplyExtractedDataStatus('success')
      reapplyExtractedDataTimerRef.current = window.setTimeout(() => {
        setReapplyExtractedDataStatus('idle')
        reapplyExtractedDataTimerRef.current = null
      }, 2500)
    }, 450)
  }

  const undoExtractedDataReset = () => {
    const snapshot = extractedDataResetSnapshotRef.current
    if (!snapshot || reapplyExtractedDataStatus === 'loading') return

    window.clearTimeout(reapplyExtractedDataTimerRef.current)
    Object.entries(snapshot.values).forEach(([name, value]) => {
      if (name === 'requestedWorkItems') return
      setValue(name, value, { shouldDirty: true, shouldValidate: true })
    })
    replaceRequestedWorkItems(snapshot.values.requestedWorkItems)
    setExpandedWorkItemIndex(snapshot.expandedWorkItemIndex)
    setIsDurationManuallyOverridden(snapshot.isDurationManuallyOverridden)
    setIncludedExcludedItems(snapshot.includedExcludedItems)
    setReportedAtSource(snapshot.reportedAtSource)
    reportedAtManuallyChangedRef.current = snapshot.reportedAtManuallyChanged
    extractedDataResetSnapshotRef.current = null
    setCanUndoExtractedDataReset(false)
    setReapplyExtractedDataStatus('undone')
    void trigger()
    reapplyExtractedDataTimerRef.current = window.setTimeout(() => {
      setReapplyExtractedDataStatus('idle')
      reapplyExtractedDataTimerRef.current = null
    }, 2500)
  }

  const extractSourcePdf = async (file) => {
    cancelReapplyExtractedDataFeedback()
    clearExtractedDataResetSnapshot()
    const requestId = extractionRequestRef.current + 1
    extractionRequestRef.current = requestId
    setIsExtractingSource(true)
    setSourceExtractionError('')
    setSourceExtraction(null)
    setIncludedExcludedItems([])

    try {
      const extraction = await extractCustomerServicePdf(file)
      if (extractionRequestRef.current !== requestId) return
      setSourceExtraction(extraction)
      applyPdfStructuredData(extraction.structuredData)
    } catch (error) {
      if (extractionRequestRef.current !== requestId) return
      setSourceExtractionError(error.message || 'The PDF extraction failed.')
    } finally {
      if (extractionRequestRef.current === requestId) setIsExtractingSource(false)
    }
  }

  const extractSourceEmailText = async () => {
    cancelReapplyExtractedDataFeedback()
    const normalizedText = sourceEmailText.trim()
    if (!normalizedText) {
      setSourceExtractionError('Paste the email text to analyze.')
      return
    }
    if (sourceEmailText.length > MAX_EMAIL_TEXT_CHARACTERS) {
      setSourceExtractionError('The email text must be 50,000 characters or fewer.')
      return
    }
    clearExtractedDataResetSnapshot()

    const requestId = extractionRequestRef.current + 1
    extractionRequestRef.current = requestId
    setIsExtractingSource(true)
    setSourceExtractionError('')
    setSourceExtraction(null)
    setIncludedExcludedItems([])

    try {
      const extraction = await extractCustomerServiceEmailText({
        text: normalizedText,
        from: getValues('sourceEmailFrom'),
        subject: getValues('sourceEmailSubject'),
      })
      if (extractionRequestRef.current !== requestId) return
      setSourceExtraction(extraction)
      applyPdfStructuredData(extraction.structuredData)
    } catch (error) {
      if (extractionRequestRef.current !== requestId) return
      setSourceExtractionError(error.message || 'The email analysis failed.')
    } finally {
      if (extractionRequestRef.current === requestId) setIsExtractingSource(false)
    }
  }

  const changeSourceInputMode = (_event, nextMode) => {
    if (isAutofillApplying || !nextMode || nextMode === sourceInputMode) return
    extractionRequestRef.current += 1
    cancelReapplyExtractedDataFeedback()
    clearExtractedDataResetSnapshot()
    setSourceInputMode(nextMode)
    setSourceExtractionError('')
    setSourceExtraction(null)
    setPdfAutofillReview(null)
    setIncludedExcludedItems([])
    setIsExtractingSource(false)
  }

  const acceptSourcePdf = (files) => {
    if (isAutofillApplying) return
    const selectedFiles = [...(files ?? [])]
    if (selectedFiles.length !== 1) {
      setSourceExtractionError('Drop one PDF file at a time.')
      return
    }

    const [file] = selectedFiles
    const validationError = validatePrototypeSourcePdf(file)
    if (validationError) {
      setSourceExtractionError(validationError)
      return
    }

    setSourcePdf(file)
    setSourceExtractionError('')
    setSourceExtraction(null)
    setPdfAutofillReview(null)
    setIncludedExcludedItems([])
    if (!isRecoveryUpload) void extractSourcePdf(file)
  }

  const submit = async (values) => {
    if (isReadOnlyMode) return

    setSaveError('')
    if (isRecoveryUpload && !sourcePdf) {
      setSaveError('Choose the recovery PDF to complete its pending upload. The request already exists.')
      return
    }

    // Administrative saves must not revalidate or normalize locked legacy Job,
    // location or contact fields. The server enforces the same field whitelist.
    if (isEditMode && planningLocked) {
      try { await onSave(values) }
      catch (error) { setSaveError(error?.message || 'The changes could not be saved. Try again.') }
      return
    }

    if (!selectedBuilderOption && (!canSavePartialImport || values.builderName || values.jobId)) {
      setError('builderName', {
        type: 'validate',
        message: 'Choose a registered Builder.',
      })
      setShowValidationSummary(true)
      setFocus('builderName')
      return
    }

    const submittedJob = selectedBuilderOption?.jobs.find(
      (job) => String(job.id) === String(values.jobId),
    )
    if (!submittedJob && (!canSavePartialImport || values.jobId || values.builderName)) {
      setError('jobId', {
        type: 'validate',
        message: 'Choose a registered Project / Job for this Builder.',
      })
      setShowValidationSummary(true)
      setFocus('jobId')
      return
    }

    const attachments = sourceInputMode === 'PDF' && sourcePdf ? [sourcePdf.name] : []
    const submittedValues = {
      ...values,
      builderName: selectedBuilderOption?.value ?? '',
      jobId: submittedJob?.id ?? '',
      community: submittedJob?.name ?? '',
      reportedAtSource,
      ...(!isEditMode && {
        sourceDocument: buildPrototypeSourceDocument({
          sourceInputMode,
          sourcePdf,
          sourceEmailText,
          sourceExtraction,
        }),
      }),
      extractionReviewNotes: isEditMode
        ? request.extractionReviewNotes ?? []
        : pdfAutofillReview?.reviewNotes ?? [],
      sourceEmailBody: isEditMode
        ? request.sourceEmail?.body ?? ''
        : sourceInputMode === 'EMAIL_TEXT' ? sourceEmailText.trim() : '',
    }

    if (isEditMode) {
      try { await onSave(submittedValues) }
      catch (error) { setSaveError(error?.message || 'The changes could not be saved. Try again.') }
      return
    }

    try {
      await onCreate(submittedValues, attachments, submissionKey)
    } catch (error) {
      if (error.savedIdentity) setSavedSubmission({ values: submittedValues, attachments })
      setSaveError(error?.message || 'The request could not be saved. Try again.')
    }
  }

  const retrySavedSubmission = async () => {
    if (saving) return
    setRetryingSave(true)
    setSaveError('')
    try {
      await onCreate(savedSubmission.values, savedSubmission.attachments, submissionKey)
    } catch (error) {
      setSaveError(error?.message || 'The saved request could not be completed. Try again.')
    } finally {
      setRetryingSave(false)
    }
  }

  const focusValidationError = (validationError) => {
    if (Number.isInteger(validationError?.itemIndex)) {
      const item = requestedWorkItems[validationError.itemIndex]
      if (!item) return

      setExpandedWorkItemIndex(validationError.itemIndex)
      window.setTimeout(() => {
        const input = workItemDescriptionRefs.current.get(item.id)
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        input?.focus()
      }, fullScreen ? 250 : 0)
      return
    }

    if (validationError?.fieldName) {
      setFocus(validationError.fieldName)
      window.setTimeout(() => {
        document.activeElement?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      }, 0)
      return
    }

    const target = addWorkItemButtonRef.current?.disabled
      ? workItemsSectionRef.current
      : addWorkItemButtonRef.current ?? workItemsSectionRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus()
  }

  const handleInvalidSubmit = (formErrors) => {
    const summary = summarizeNewRequestFormErrors(formErrors)
    setShowValidationSummary(true)
    focusValidationError(summary[0])
  }

  const updateRequestedWorkItem = (itemIndex, values) => {
    if (isFormDataReadOnly) return
    const nextItems = requestedWorkItems.map((item, index) => (
      index === itemIndex ? { ...item, ...values } : item
    ))
    Object.entries(values).forEach(([name, value]) => {
      setValue(`requestedWorkItems.${itemIndex}.${name}`, value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    })
    if (Object.hasOwn(values, 'description')) {
      if (selectedServiceTask === 'GENERAL_FIX' && !isDurationManuallyOverridden) {
        setValue(
          'estimatedDurationMinutes',
          calculateGeneralFixDuration(describedRequestedWorkItemCount(nextItems)),
          { shouldDirty: true, shouldValidate: true },
        )
      }
    }
  }

  const addRequestedWorkItem = () => {
    if (isFormDataReadOnly) return
    if (requestedWorkItems.length >= maxRequestedWorkItems) return

    appendRequestedWorkItem(createRequestedWorkItem({
      itemNumber: requestedWorkItems.length + 1,
    }), { shouldFocus: false })
    setExpandedWorkItemIndex(requestedWorkItems.length)
    void trigger('requestedWorkItems')
  }

  const includeExcludedSourceItem = (sourceItem) => {
    if (requestedWorkItems.length >= maxRequestedWorkItems) return

    const workItem = createRequestedWorkItem({
      itemNumber: requestedWorkItems.length + 1,
      description: sourceItem.description || sourceItem.requestedAction,
    })
    const nextItems = [...requestedWorkItems, workItem]
    appendRequestedWorkItem(workItem, { shouldFocus: false })
    setIncludedExcludedItems((current) => [
      ...current,
      { sourceIndex: sourceItem.sourceIndex, workItemId: workItem.id },
    ])
    setExpandedWorkItemIndex(requestedWorkItems.length)
    if (selectedServiceTask === 'GENERAL_FIX' && !isDurationManuallyOverridden) {
      setValue(
        'estimatedDurationMinutes',
        calculateGeneralFixDuration(describedRequestedWorkItemCount(nextItems)),
        { shouldDirty: true, shouldValidate: true },
      )
    }
    void trigger('requestedWorkItems')
  }

  const removeRequestedWorkItem = (itemIndex) => {
    if (isFormDataReadOnly) return
    if (requestedWorkItems.length <= 1) return

    const removedItemId = requestedWorkItems[itemIndex]?.id
    const nextItems = renumberRequestedWorkItems(
      requestedWorkItems.filter((_, index) => index !== itemIndex),
    )
    replaceRequestedWorkItems(nextItems)
    setIncludedExcludedItems((current) => (
      current.filter((item) => item.workItemId !== removedItemId)
    ))
    void trigger('requestedWorkItems')
    setExpandedWorkItemIndex((currentIndex) => {
      if (nextItems.length === 0) return null
      if (currentIndex === itemIndex) return Math.min(itemIndex, nextItems.length - 1)
      if (currentIndex > itemIndex) return currentIndex - 1
      return currentIndex
    })
    if (selectedServiceTask === 'GENERAL_FIX' && !isDurationManuallyOverridden) {
      setValue(
        'estimatedDurationMinutes',
        calculateGeneralFixDuration(describedRequestedWorkItemCount(nextItems)),
        { shouldDirty: true, shouldValidate: true },
      )
    }
  }

  const requestClose = () => {
    if (saving || isAutofillApplying) return
    if (savedSubmission) {
      onClose()
      return
    }
    if (hasUnsavedChanges) {
      setCloseConfirmationOpen(true)
      return
    }
    onClose()
  }

  const discardChangesAndClose = () => {
    setCloseConfirmationOpen(false)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      component={isReadOnlyMode ? 'div' : 'form'}
      onSubmit={isReadOnlyMode
        ? undefined
        : (event) => {
          if (saving) { event.preventDefault(); return }
          if (savedSubmission) {
            event.preventDefault()
            void retrySavedSubmission()
          } else void handleSubmit(submit, handleInvalidSubmit)(event)
        }}
      fullWidth
      fullScreen={fullScreen}
      maxWidth="md"
      noValidate
      aria-labelledby="request-form-title"
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
          <Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography id="request-form-title" variant="h6" fontWeight={800}>
                {isReadOnlyMode
                  ? `View request · ${request.requestNumber}`
                  : isEditMode ? `${isCompleted ? 'Edit internal notes' : planningLocked ? 'Edit priority & notes' : 'Edit request'} · ${request.requestNumber}`
                  : emailImport ? isRecoveryUpload ? `Complete recovery PDF · ${recoveryRequest?.requestNumber ?? ''}` : 'Recover email import' : 'New request'}
              </Typography>
              <Chip
                size="small"
                icon={<ScienceOutlinedIcon />}
                label={!isEditMode || !isReadOnlyMode || request?.prototypeOnly === false
                  ? 'Supabase-backed'
                  : 'Frontend simulation'}
                color="info"
                variant="outlined"
              />
              {(isReadOnlyMode || planningLocked) && (
                <Chip
                  size="small"
                  label={workflow.label}
                  color={workflow.color === 'neutral' ? 'default' : workflow.color}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {isEditMode
                ? isReadOnlyMode
                  ? onEdit
                    ? planningLocked
                      ? isCompleted
                        ? 'View the completed request. Only internal notes can be edited.'
                        : 'View the saved request. Only priority and internal notes can be edited.'
                      : 'Review the saved request. Select Edit request to complete or correct its information.'
                    : 'View the saved request. Request information is read-only in this workspace.'
                  : 'Saves changes to this same request and preserves its folio and original source.'
                : 'Saves the request in Supabase and privately retains its optional source PDF.'}
            </Typography>
          </Box>
          <IconButton
            aria-label={isReadOnlyMode
              ? 'Close request view'
              : isEditMode ? 'Close request editor' : 'Close new request'}
            onClick={requestClose}
            disabled={saving || isAutofillApplying}
            edge="end"
          >
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        {emailImport && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            {isRecoveryUpload
              ? 'This request already exists. Its saved fields are locked; choose the same recovery PDF to complete its upload. No second request will be created.'
              : 'Recovery of the same email import. Upload a valid PDF to extract its data or complete the form manually. A homeowner name and one described item are required; missing information can be completed in Needs review.'}
            {' '}The original email, rejected files and analysis are not replaced. Saving does not approve the request.
            {isRecoveryUpload && recoveryRequest?.sourceDocument?.recoveryPdf?.originalFilename
              && ` Pending PDF: ${recoveryRequest.sourceDocument.recoveryPdf.originalFilename}.`}
          </Alert>
        )}
        {saveError && (
          <Alert ref={saveErrorRef} tabIndex={-1} severity="error" variant="outlined" sx={{ mb: 2 }}>
            {saveError}
            {savedSubmission && ' The saved fields are locked while you retry. You may close this dialog; the request remains saved.'}
            {savedSubmission?.values.sourceDocument?.sourceType === 'PDF'
              && ' The original PDF can also be retried from its source viewer during this session.'}
          </Alert>
        )}
        <Box
          component="fieldset"
          disabled={isAutofillApplying || saving || Boolean(savedSubmission)}
          inert={saving || Boolean(savedSubmission) || undefined}
          aria-busy={isAutofillApplying || saving}
          aria-readonly={isReadOnlyMode}
          sx={{
            border: 0,
            p: 0,
            m: 0,
            minWidth: 0,
            ...(isReadOnlyMode && { '& .MuiFormHelperText-root': { display: 'none' } }),
            '& .MuiFormLabel-asterisk': { color: 'error.main' },
            ...(isFormDataReadOnly && {
              '& .MuiOutlinedInput-root': { bgcolor: 'action.hover' },
              '& .MuiInputBase-input.Mui-disabled': {
                WebkitTextFillColor: (theme) => theme.palette.text.primary,
              },
              '& .MuiInputLabel-root.Mui-disabled': { color: 'text.secondary' },
            }),
          }}
        >
          <Stack spacing={3}>
          {!isReadOnlyMode && canSaveIncomplete && (
            <Alert severity="info" variant="outlined">
              {canSavePartialImport ? 'Imported request: save requires the homeowner name and at least one described work item. Missing date, Job or contact details can be completed during review. Supplied values must still be valid.' : <>Save requires Reported on, Builder, Project / Job, coordinates, customer name,
              email or phone, and at least one described work item. Service task, duration and
              crew can still be completed during review.</>}
              {workflowStage === 'READY_TO_PROPOSE'
                && ' Changes to location, work items, duration or crew will require a new review.'}
            </Alert>
          )}
          {!isEditMode && !hasSource && (
            <Alert severity="warning" variant="outlined">
              No PDF or email text added. After saving, these cannot be added to this request.
              Later edits must be completed manually.
            </Alert>
          )}
          {isReadOnlyMode && workflowStage === 'READY_TO_PROPOSE' && (
            <Alert severity="success" variant="outlined">
              Ready to propose. Review completed
              {request.review?.completedBy ? ` by ${request.review.completedBy}` : ''}
              {request.review?.completedAt
                ? ` on ${new Date(request.review.completedAt).toLocaleString('en-US', {
                  timeZone: customerServiceTimeZone, timeZoneName: 'short',
                })}` : ''}.
              {' '}No appointment has been proposed or scheduled yet.
            </Alert>
          )}
          {isReadOnlyMode && workflowStage === 'NEEDS_CONTACT' && (
            <Alert severity="warning" variant="outlined">
              Contact the customer before continuing with a new proposal.
              {request.review?.completedAt && ' Request review is already complete.'}
              {request.customerAvailabilityNotes && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {request.customerAvailabilityNotes}
                </Typography>
              )}
            </Alert>
          )}
          {isReadOnlyMode && workflowStage === 'AWAITING_CUSTOMER' && (
            <Alert severity="info" variant="outlined">
              A proposal has been sent. The appointment is not confirmed until the customer accepts it.
            </Alert>
          )}
          {isReadOnlyMode && isRequestOverdue(request) && (
            <Alert severity="warning" variant="outlined">
              The target date has passed. This is an overdue alert, not a change to the request's workflow stage.
              {workflowStage === 'OVERDUE' && ' This older record needs its original workflow stage reviewed.'}
            </Alert>
          )}
          {isReadOnlyMode && onViewSource && (
            <Button
              variant="outlined"
              startIcon={<AttachFileRoundedIcon />}
              onClick={() => onViewSource(request)}
              sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
            >
              View source & extraction
            </Button>
          )}
          {!isReadOnlyMode && showValidationSummary && validationErrorSummary.length > 0 && (
            <Alert severity="error" variant="outlined">
              <Typography variant="body2" fontWeight={800}>
                Review {validationErrorSummary.length}{' '}
                {validationErrorSummary.length === 1 ? 'field' : 'fields'} before saving the request.
              </Typography>
              <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                {validationErrorSummary.map((validationError) => (
                  <Box component="li" key={validationError.key}>
                    <Button
                      type="button"
                      color="error"
                      size="small"
                      onClick={() => focusValidationError(validationError)}
                      sx={{
                        minWidth: 0,
                        p: 0,
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        textTransform: 'none',
                      }}
                    >
                      {validationError.label}: {validationError.message}
                    </Button>
                  </Box>
                ))}
              </Box>
              <Typography variant="caption">
                Select any message to go directly to that field.
              </Typography>
            </Alert>
          )}
          {planningLocked && (
            <Alert severity="info" variant="outlined">
              This request already has a proposal or confirmed appointment. Its property,
              customer, work items, duration, crew and source are locked to preserve the planning.
              {!isReadOnlyMode && (isCompleted
                ? ' Only Internal notes can be edited.'
                : ' Only Priority and Internal notes can be edited.')}
              {' '}Operational changes require a replan workflow, which is not implemented yet.
            </Alert>
          )}
          {isReadOnlyMode && workflowStage === 'NEEDS_REVIEW' && requestReview && (
            <Box
              sx={{
                border: 1,
                borderColor: requestReview.isComplete ? 'success.main' : 'warning.main',
                borderRadius: 2,
                bgcolor: 'background.paper',
                p: { xs: 2, sm: 2.5 },
              }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}
              >
                <SectionHeading
                  title="Review request"
                  description="Validate the request before it moves to proposal planning."
                />
                <Chip
                  size="small"
                  color={requestReview.isComplete ? 'success' : 'warning'}
                  label={`${requestReview.completedCount} of ${requestReview.checks.length} checks complete`}
                  sx={{ flexShrink: 0 }}
                />
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                  mt: 2,
                }}
              >
                {requestReview.checks.map((check) => (
                  <ReviewCheck key={check.id} check={check} />
                ))}
              </Box>

              {requestReview.warnings.length > 0 ? (
                <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                  <Typography variant="body2" fontWeight={800}>
                    AI extraction review
                  </Typography>
                  <Typography variant="body2">
                    Review these notes against the source. They do not automatically block approval.
                  </Typography>
                  <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                    {requestReview.warnings.map((warning) => (
                      <Typography component="li" variant="body2" key={warning}>
                        {warning}
                      </Typography>
                    ))}
                  </Box>
                </Alert>
              ) : (
                <Alert severity="success" variant="outlined" sx={{ mt: 2 }}>
                  No AI extraction warnings are recorded for this request.
                </Alert>
              )}

              <FormControlLabel
                sx={{ mt: 1.5, alignItems: 'flex-start' }}
                control={(
                  <Checkbox
                    checked={valtrimItemsConfirmed}
                    onChange={(event) => setValtrimItemsConfirmed(event.target.checked)}
                  />
                )}
                label={(
                  <Box sx={{ pt: 0.75 }}>
                    <Typography variant="body2" fontWeight={800}>
                      I confirmed that the requested work items belong to Valtrim.
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Items assigned to another vendor must not be included in this request.
                    </Typography>
                  </Box>
                )}
              />

              {!requestReview.isComplete && (
                <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>
                  Select Edit request to complete the pending information, then save and review again.
                </Alert>
              )}

              <Button
                type="button"
                variant="contained"
                color="success"
                startIcon={<FactCheckRoundedIcon />}
                disabled={saving || !requestReview.isComplete || !valtrimItemsConfirmed || !onMarkReady}
                onClick={approveRequest}
                sx={{ mt: 2 }}
              >
                {approving ? 'Approving…' : 'Mark ready to propose'}
              </Button>
              {!valtrimItemsConfirmed && requestReview.isComplete && (
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                  Confirm the Valtrim work items above to enable approval.
                </Typography>
              )}
            </Box>
          )}
          <Box>
            <SectionHeading
              title="Request"
              description={isReadOnlyMode
                ? 'Request identity, ownership and priority.'
                : planningLocked
                ? isCompleted
                  ? 'Only internal notes can be edited. The completed service record stays unchanged.'
                  : 'Only priority and internal notes can be edited. Planning stays unchanged.'
                : isEditMode
                ? 'Edit the operational details without changing the request identity.'
                : 'The request starts in Needs review. The five-business-day period is calculated from Reported on; Created on is recorded when the request is saved.'}
            />
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              <TextField
                label="Request number"
                value={isEditMode ? request.requestNumber : recoveryRequest?.requestNumber ?? 'Assigned when created'}
                helperText={isEditMode
                  ? 'The request number cannot be changed.'
                  : 'The server assigns the folio when this request is saved.'}
                fullWidth
                slotProps={{ htmlInput: { readOnly: true } }}
              />
              <ControlledUsDateField
                control={control}
                name="reportedAt"
                label="Reported on"
                error={visibleErrors.reportedAt}
                helperText={visibleErrors.reportedAt?.message ?? (canSavePartialImport && !reportedAtValue
                  ? 'Date pending. Review the original source; no deadline is calculated until a date is provided.'
                  : `${reportedAtSourceLabels[reportedAtSource] ?? reportedAtSourceLabels.MANUAL}. Use MM/DD/YYYY. Five business days start after this date.${dueOnPreview ? ` Due on: ${formatLongDate(dueOnPreview)}.` : ''}`)}
                fullWidth
                required={!canSavePartialImport}
                readOnly={isFormDataReadOnly}
                onValueChange={() => {
                  setReportedAtSource('MANUAL')
                  reportedAtManuallyChangedRef.current = true
                }}
              />
              <TextField
                label="Coordinator"
                value={request?.emailImportId || emailImport
                  ? request?.coordinatorName || 'Not assigned'
                  : request?.coordinatorName || currentUserName || 'Signed-in user'}
                helperText={request?.emailImportId || emailImport
                  ? 'Created by the import process. No coordinator is assigned automatically.'
                  : 'Taken from the authenticated account.'}
                fullWidth
                slotProps={{ htmlInput: { readOnly: true } }}
              />
              <SelectField
                control={control}
                name="priority"
                label="Priority"
                options={priorityOptions}
                error={visibleErrors.priority}
                readOnly={isReadOnlyMode || isCompleted || isRecoveryUpload}
              />
            </Box>
          </Box>

          <Divider />

          <Box>
            <SectionHeading
              title="Property"
              description={!isFormDataReadOnly && canSaveIncomplete
                ? 'Builder and Project / Job come from the registered Supabase catalog. The selected Job supplies its Community coordinates.'
                : 'Project / Job and coordinates identify the service location.'}
            />
            {catalogLoading && (
              <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                Loading registered Builders and Jobs…
              </Alert>
            )}
            {catalogError && (
              <Alert
                severity="error"
                variant="outlined"
                sx={{ mt: 2 }}
                action={(
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      void Promise.allSettled([refreshBuilders(), refreshJobs()])
                    }}
                  >
                    Retry
                  </Button>
                )}
              >
                The registered Builder and Job catalog could not be loaded.
              </Alert>
            )}
            {!catalogLoading && !catalogError && builderOptions.length === 0 && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                No active Builders are registered in Supabase.
              </Alert>
            )}
            {!catalogLoading
              && !catalogError
              && selectedBuilderOption
              && selectedBuilderOption.jobs.length === 0 && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                This Builder has no active Jobs registered in Supabase.
              </Alert>
            )}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
              <SelectField
                control={control}
                name="builderName"
                label="Builder"
                options={builderSelectOptions}
                error={visibleErrors.builderName}
                helperText={catalogLoading
                  ? 'Loading registered Builders…'
                  : 'Only active Builders registered in Supabase are available.'}
                required={!canSavePartialImport}
                onValueChange={() => {
                  clearErrors(['builderName', 'jobId', 'community', 'coordinates'])
                  setValue('jobId', '', { shouldDirty: true })
                  setValue('community', '', { shouldDirty: true, shouldValidate: true })
                  setValue('coordinates', '', { shouldDirty: true, shouldValidate: true })
                }}
                disabled={catalogLoading || Boolean(catalogError) || builderOptions.length === 0}
                readOnly={isFormDataReadOnly}
              />
              <SelectField
                control={control}
                name="jobId"
                label="Project / Job"
                options={jobOptions}
                error={visibleErrors.jobId ?? visibleErrors.community}
                helperText={selectedBuilderOption
                  ? 'Only active Jobs registered for the selected Builder are available.'
                  : 'Select a registered Builder first.'}
                required={!canSavePartialImport}
                onValueChange={(value) => {
                  const job = selectedBuilderOption?.jobs.find(
                    (option) => String(option.id) === String(value),
                  )
                  clearErrors(['jobId', 'community', 'coordinates'])
                  setValue('community', job?.name ?? '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                  setValue('coordinates', customerServiceJobCoordinatesValue(job), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
                disabled={catalogLoading
                  || Boolean(catalogError)
                  || !selectedBuilderOption
                  || selectedBuilderOption.jobs.length === 0}
                readOnly={isFormDataReadOnly}
              />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <ControlledTextField
                control={control}
                name="lotNumber"
                label="Lot #"
                error={visibleErrors.lotNumber}
                helperText={visibleErrors.lotNumber?.message ?? (canSaveIncomplete
                ? 'Optional property reference within the selected Job.'
                  : 'Optional')}
                sx={{ width: { xs: '100%', md: 200 }, flexShrink: 0 }}
                readOnly={isFormDataReadOnly}
              />
              <ControlledTextField
                control={control}
                name="address"
                label="Address"
                error={visibleErrors.address}
                helperText={visibleErrors.address?.message ?? (canSaveIncomplete
                  ? 'Optional when the Job or source already identifies the property.'
                  : 'Optional when coordinates are provided.')}
                fullWidth
                readOnly={isFormDataReadOnly}
              />
            </Stack>
            <ControlledTextField
              control={control}
              name="coordinates"
              label="Coordinates"
              error={visibleErrors.coordinates}
              helperText={visibleErrors.coordinates?.message ?? (selectedJob
                ? customerServiceJobCoordinatesValue(selectedJob)
                  ? 'Loaded from the selected registered Project / Job.'
                  : 'This Job has no valid Community coordinates. Correct the Job before continuing.'
                : 'Select a registered Project / Job to load its coordinates.')}
              placeholder="33.97788205770745, -117.34520765941319"
              fullWidth
              required={!canSavePartialImport}
              sx={{ mt: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              readOnly={isFormDataReadOnly || Boolean(selectedJob)}
            />
            {coordinates && (
              <Alert
                severity="success"
                variant="outlined"
                action={(
                  <Button
                    size="small"
                    component="a"
                    href={`https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<MapOutlinedIcon />}
                  >
                    Open Maps
                  </Button>
                )}
                sx={{ mt: 1 }}
              >
                Coordinates recognized: {coordinates.latitude}, {coordinates.longitude}
              </Alert>
            )}
          </Box>

          <Divider />

          <Box>
            <SectionHeading title="Customer" />
            {!isFormDataReadOnly && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                <Box component="span" sx={{ color: 'error.main' }}>*</Box>{' '}
                {canSavePartialImport
                  ? 'Homeowner name is required. Phone or Email can be completed before approval.'
                  : 'Customer name and either Phone or Email are required.'}
              </Typography>
            )}
            <Stack spacing={1} sx={{ mt: 2 }}>
              <ControlledTextField
                control={control}
                name="contactName"
                label="Customer name"
                error={visibleErrors.contactName}
                helperText={visibleErrors.contactName?.message ?? ' '}
                fullWidth
                required
                readOnly={isFormDataReadOnly}
              />
              <FormPhoneInput
                control={control}
                name="contactPhone"
                label="Phone"
                error={visibleErrors.contactPhone}
                helperText={visibleErrors.contactPhone?.message ?? 'U.S. or Mexico phone number'}
                disabled={isFormDataReadOnly}
              />
              <ControlledTextField
                control={control}
                name="contactEmail"
                label="Email"
                type="email"
                error={visibleErrors.contactEmail}
                helperText={visibleErrors.contactEmail?.message ?? ' '}
                fullWidth
                readOnly={isFormDataReadOnly}
              />
              {additionalCustomerFields.map((customer, customerIndex) => (
                <Box
                  key={customer.fieldKey}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    p: 2,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                  >
                    <Typography variant="subtitle2" fontWeight={800}>
                      Customer {customerIndex + 2}
                    </Typography>
                    {!isFormDataReadOnly && <Button
                      type="button"
                      size="small"
                      color="error"
                      onClick={() => removeAdditionalCustomer(customerIndex)}
                    >
                      Remove
                    </Button>}
                  </Stack>
                  <Stack spacing={1}>
                    <ControlledTextField
                      control={control}
                      name={`additionalContacts.${customerIndex}.name`}
                      label="Customer name"
                      error={visibleErrors.additionalContacts?.[customerIndex]?.name}
                      helperText={visibleErrors.additionalContacts?.[customerIndex]?.name?.message ?? ' '}
                      fullWidth
                      readOnly={isFormDataReadOnly}
                    />
                    <FormPhoneInput
                      control={control}
                      name={`additionalContacts.${customerIndex}.phone`}
                      label="Phone"
                      error={visibleErrors.additionalContacts?.[customerIndex]?.phone}
                      helperText={visibleErrors.additionalContacts?.[customerIndex]?.phone?.message ?? 'U.S. or Mexico phone number'}
                      disabled={isFormDataReadOnly}
                    />
                    <ControlledTextField
                      control={control}
                      name={`additionalContacts.${customerIndex}.email`}
                      label="Email"
                      type="email"
                      error={visibleErrors.additionalContacts?.[customerIndex]?.email}
                      helperText={visibleErrors.additionalContacts?.[customerIndex]?.email?.message ?? ' '}
                      fullWidth
                      readOnly={isFormDataReadOnly}
                    />
                  </Stack>
                </Box>
              ))}
              {!isFormDataReadOnly && additionalCustomerFields.length < 2 && (
                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => appendAdditionalCustomer({ name: '', phoneCountry: 'US', phone: '', email: '' })}
                  sx={{
                    alignSelf: 'flex-start',
                    width: { xs: '100%', sm: 'auto' },
                    minWidth: { sm: 230 },
                  }}
                >
                  Add another customer
                </Button>
              )}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <SectionHeading
              title="Service request"
              description={isFormDataReadOnly
                ? 'Service classification, requested work and planning requirements.'
                : 'Choose a common task to load its planning time and crew. Both values remain editable.'}
            />
            {planningSuggestionsApplied && isDirty && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                Missing service details were suggested from the work and selected task. Review and save the changes.
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
              <SelectField
                control={control}
                name="serviceKind"
                label="Service kind"
                options={serviceKindOptions}
                error={visibleErrors.serviceKind}
                readOnly={isFormDataReadOnly}
              />
              <SelectField
                control={control}
                name="workType"
                label="Work type"
                options={prototypeWorkTypeOptions}
                error={visibleErrors.workType}
                helperText="Choose Multiple work types when the included items belong to different categories."
                readOnly={isFormDataReadOnly}
              />
            </Stack>
            <Box sx={{ mt: 1 }}>
              <SelectField
                control={control}
                name="serviceTask"
                label="Service task"
                options={prototypeServiceTaskOptions}
                error={visibleErrors.serviceTask}
                onValueChange={(value) => {
                  const planning = planningForTask(value, describedWorkItemCount)
                  setIsDurationManuallyOverridden(false)
                  setValue('estimatedDurationMinutes', planning.estimatedDurationMinutes ?? '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                  setValue('crewSize', planning.crewSize ?? '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
                readOnly={isFormDataReadOnly}
              />
            </Box>
            <Box ref={workItemsSectionRef} tabIndex={-1} sx={{ mt: 0.5, mb: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle2" fontWeight={800}>
                  Work items
                </Typography>
                <Chip
                  label={`${requestedWorkItems.length} ${requestedWorkItems.length === 1 ? 'item' : 'items'}`}
                  size="small"
                  variant="outlined"
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {isFormDataReadOnly
                  ? 'Repairs or replacements included in this request.'
                  : 'Add each repair or replacement as a separate item.'}
              </Typography>
            </Box>
            {fullScreen ? (
              <Stack spacing={1.25} aria-label="Requested work items">
                {requestedWorkItems.map((item, itemIndex) => {
                  const itemDescriptionError = visibleErrors.requestedWorkItems?.[itemIndex]?.description
                  const itemHasError = Boolean(itemDescriptionError)

                  return (
                    <Accordion
                      key={item.id}
                      expanded={expandedWorkItemIndex === itemIndex}
                      onChange={(_, isExpanded) => {
                        setExpandedWorkItemIndex(isExpanded ? itemIndex : null)
                      }}
                      disableGutters
                      elevation={0}
                      sx={{
                        border: 1,
                        borderColor: itemHasError ? 'error.main' : 'divider',
                        borderRadius: 1.5,
                        '&::before': { display: 'none' },
                        '&:not(:last-of-type)': { borderRadius: 1.5 },
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandMoreRoundedIcon />}
                        aria-controls={`work-item-${itemIndex}-content`}
                        id={`work-item-${itemIndex}-header`}
                      >
                        <Box sx={{ minWidth: 0, width: '100%', pr: 1 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography
                              variant="subtitle2"
                              fontWeight={800}
                              color={itemHasError ? 'error.main' : 'text.primary'}
                            >
                              Item #{item.itemNumber}
                            </Typography>
                            {item.materialRequired && (
                              <Chip label="Material" size="small" variant="outlined" />
                            )}
                            {item.chargeable && (
                              <Chip label="Chargeable" size="small" variant="outlined" />
                            )}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {item.description || 'Description pending'}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails id={`work-item-${itemIndex}-content`}>
                        <TextField
                          label="Work description"
                          required
                          value={item.description}
                          inputRef={(node) => {
                            if (node) workItemDescriptionRefs.current.set(item.id, node)
                            else workItemDescriptionRefs.current.delete(item.id)
                          }}
                          onChange={(event) => updateRequestedWorkItem(itemIndex, {
                            description: event.target.value,
                          })}
                          error={itemHasError}
                          helperText={itemDescriptionError?.message ?? `${item.description.length.toLocaleString('en-US')} / ${maxRequestedWorkItemDescriptionCharacters.toLocaleString('en-US')}`}
                          multiline
                          minRows={3}
                          size="small"
                          fullWidth
                          slotProps={{
                            htmlInput: {
                              maxLength: maxRequestedWorkItemDescriptionCharacters,
                              ...(isFormDataReadOnly ? { readOnly: true } : {}),
                            },
                          }}
                        />
                        <Stack
                          direction="row"
                          sx={{ mt: 0.5, flexWrap: 'wrap', columnGap: 2 }}
                        >
                          <FormControlLabel
                            control={(
                              <Checkbox
                                checked={item.materialRequired}
                                onChange={(event) => updateRequestedWorkItem(itemIndex, {
                                  materialRequired: event.target.checked,
                                })}
                                size="small"
                                disabled={isFormDataReadOnly}
                              />
                            )}
                            label="Material needed"
                          />
                          <FormControlLabel
                            control={(
                              <Checkbox
                                checked={item.chargeable}
                                onChange={(event) => updateRequestedWorkItem(itemIndex, {
                                  chargeable: event.target.checked,
                                })}
                                size="small"
                                disabled={isFormDataReadOnly}
                              />
                            )}
                            label="Chargeable"
                          />
                        </Stack>
                        {!isFormDataReadOnly && (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                          <Button
                            type="button"
                            color="error"
                            size="small"
                            startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                            onClick={() => removeRequestedWorkItem(itemIndex)}
                            disabled={requestedWorkItems.length <= 1}
                          >
                            Delete item
                          </Button>
                        </Box>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            ) : (
              <TableContainer
                sx={{
                  border: 1,
                  borderColor: visibleErrors.requestedWorkItems ? 'error.main' : 'divider',
                  borderRadius: 1,
                  maxHeight: 460,
                }}
              >
                <Table stickyHeader size="small" aria-label="Requested work items">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 90 }}>Item #</TableCell>
                      <TableCell>Work description</TableCell>
                      <TableCell align="center" sx={{ width: 100 }}>Material</TableCell>
                      <TableCell align="center" sx={{ width: 110 }}>Chargeable</TableCell>
                      {!isFormDataReadOnly && (
                        <TableCell align="center" sx={{ width: 70 }}>Actions</TableCell>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {requestedWorkItems.map((item, itemIndex) => {
                      const itemDescriptionError = visibleErrors.requestedWorkItems?.[itemIndex]?.description

                      return (
                        <TableRow key={item.id}>
                          <TableCell>{item.itemNumber}</TableCell>
                          <TableCell>
                            <TextField
                              value={item.description}
                              inputRef={(node) => {
                                if (node) workItemDescriptionRefs.current.set(item.id, node)
                                else workItemDescriptionRefs.current.delete(item.id)
                              }}
                              onChange={(event) => updateRequestedWorkItem(itemIndex, {
                                description: event.target.value,
                              })}
                              aria-label={`Work description for item ${item.itemNumber}`}
                              required
                              error={Boolean(itemDescriptionError)}
                              helperText={itemDescriptionError?.message ?? `${item.description.length.toLocaleString('en-US')} / ${maxRequestedWorkItemDescriptionCharacters.toLocaleString('en-US')}`}
                              multiline
                              minRows={2}
                              size="small"
                              fullWidth
                              slotProps={{
                                htmlInput: {
                                  maxLength: maxRequestedWorkItemDescriptionCharacters,
                                  ...(isFormDataReadOnly ? { readOnly: true } : {}),
                                },
                              }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={item.materialRequired}
                              onChange={(event) => updateRequestedWorkItem(itemIndex, {
                                materialRequired: event.target.checked,
                              })}
                              slotProps={{ input: {
                                'aria-label': `Material required for item ${item.itemNumber}`,
                              } }}
                              disabled={isFormDataReadOnly}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Checkbox
                              checked={item.chargeable}
                              onChange={(event) => updateRequestedWorkItem(itemIndex, {
                                chargeable: event.target.checked,
                              })}
                              slotProps={{ input: {
                                'aria-label': `Chargeable item ${item.itemNumber}`,
                              } }}
                              disabled={isFormDataReadOnly}
                            />
                          </TableCell>
                          {!isFormDataReadOnly && <TableCell align="center">
                            <IconButton
                              color="error"
                              size="small"
                              aria-label={`Delete item ${item.itemNumber}`}
                              onClick={() => removeRequestedWorkItem(itemIndex)}
                              disabled={requestedWorkItems.length <= 1}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </TableCell>}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <FormHelperText error={Boolean(visibleErrors.requestedWorkItems)} sx={{ mx: 1.75 }}>
              {visibleErrors.requestedWorkItems?.message ?? ' '}
            </FormHelperText>
            {!isFormDataReadOnly && duplicateRequestedWorkItems.length > 0 && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
                Possible duplicate descriptions in{' '}
                {duplicateRequestedWorkItems.map((entry) => (
                  `items ${entry.itemNumbers.join(', ')}`
                )).join('; ')}. Review them before creating the request. This warning does not block submission.
              </Alert>
            )}
            {!isFormDataReadOnly && <Button
              ref={addWorkItemButtonRef}
              type="button"
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={addRequestedWorkItem}
              disabled={requestedWorkItems.length >= maxRequestedWorkItems}
              sx={{ mb: 2 }}
            >
              Add work item
            </Button>}
            {!isFormDataReadOnly && requestedWorkItems.length >= maxRequestedWorkItems && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1.5, mb: 2 }}>
                Maximum of {maxRequestedWorkItems} work items reached.
              </Typography>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <ControlledTextField
                control={control}
                name="estimatedDurationMinutes"
                label="Estimated duration (minutes)"
                type="number"
                error={visibleErrors.estimatedDurationMinutes}
                helperText={visibleErrors.estimatedDurationMinutes?.message ?? (
                  planningLocked ? 'Locked · existing planning is preserved'
                  : selectedServiceTask === 'GENERAL_FIX'
                    ? isDurationManuallyOverridden
                      ? `Manual duration · ${suggestedGeneralFixDuration} minutes suggested for ${describedWorkItemCount} described ${describedWorkItemCount === 1 ? 'item' : 'items'}`
                      : `${suggestedGeneralFixDuration} minutes for ${describedWorkItemCount} described ${describedWorkItemCount === 1 ? 'item' : 'items'} · updates automatically`
                    : 'Suggested by the selected task · editable'
                )}
                onValueChange={() => {
                  if (selectedServiceTask === 'GENERAL_FIX') {
                    setIsDurationManuallyOverridden(true)
                  }
                }}
                fullWidth
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { min: 15, max: 720, step: 1 },
                }}
                readOnly={isFormDataReadOnly}
              />
              <ControlledTextField
                control={control}
                name="crewSize"
                label="Crew required"
                type="number"
                error={visibleErrors.crewSize}
                helperText={visibleErrors.crewSize?.message ?? (planningLocked
                  ? 'Locked · existing planning is preserved' : 'Suggested by the selected task · editable')}
                fullWidth
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { min: 1, max: 10, step: 1 },
                }}
                readOnly={isFormDataReadOnly}
              />
            </Stack>
            {!isFormDataReadOnly && selectedServiceTask === 'GENERAL_FIX' && isDurationManuallyOverridden && (
              <Button
                type="button"
                size="small"
                onClick={() => {
                  setValue('estimatedDurationMinutes', suggestedGeneralFixDuration, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                  setIsDurationManuallyOverridden(false)
                }}
                sx={{ mt: -0.5, mb: 0.5 }}
              >
                Use suggested duration ({suggestedGeneralFixDuration} min)
              </Button>
            )}
            <ControlledTextField
              control={control}
              name="internalNotes"
              label="Internal notes"
              error={visibleErrors.internalNotes}
              helperText={visibleErrors.internalNotes?.message ?? 'Optional · not shown to the customer'}
              fullWidth
              sx={{ mt: 1 }}
              readOnly={isReadOnlyMode}
            />
            {!isReadOnlyMode && <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              Duration and crew are used for Valtrim route planning. The customer still receives a
              two-hour proposal and can accept it or reject it and request another date.
            </Alert>}
          </Box>

          <Divider />

          <Box>
            <SectionHeading
              title="Source email"
              description="Keep the original service email with the request, as in the current process."
            />
            <Stack spacing={1} sx={{ mt: 2 }}>
              {!isEditMode && !emailImport && (
                <ToggleButtonGroup
                  value={sourceInputMode}
                  exclusive
                  onChange={changeSourceInputMode}
                  aria-label="Source email input method"
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                >
                  <ToggleButton value="PDF">Upload PDF</ToggleButton>
                  <ToggleButton value="EMAIL_TEXT">Email text</ToggleButton>
                </ToggleButtonGroup>
              )}
              <ControlledTextField
                control={control}
                name="sourceEmailFrom"
                label="From"
                type="email"
                error={visibleErrors.sourceEmailFrom}
                helperText={visibleErrors.sourceEmailFrom?.message ?? 'Optional'}
                fullWidth
                readOnly={isFormDataReadOnly || isEditMode || Boolean(emailImport)}
              />
              <ControlledTextField
                control={control}
                name="sourceEmailSubject"
                label="Subject"
                error={visibleErrors.sourceEmailSubject}
                helperText={visibleErrors.sourceEmailSubject?.message ?? 'Optional'}
                fullWidth
                readOnly={isFormDataReadOnly || isEditMode || Boolean(emailImport)}
              />
              {isEditMode ? (
                <Stack spacing={1}>
                  {!isReadOnlyMode && onViewSource && (
                    <Button
                      variant="outlined"
                      startIcon={<AttachFileRoundedIcon />}
                      onClick={() => onViewSource(request)}
                      sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
                    >
                      View source & extraction
                    </Button>
                  )}
                  {!isReadOnlyMode && (
                    <Alert severity="info" variant="outlined">
                      {planningLocked
                        ? 'The source and its metadata are locked to preserve the original reference.'
                        : 'The original source and its metadata are preserved while editing. The PDF, original email, From and Subject cannot be replaced here.'}
                    </Alert>
                  )}
                  {request.sourceEmail?.attachmentNames?.length > 0 ? (
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {request.sourceEmail.attachmentNames.map((name) => (
                        <Chip
                          key={name}
                          size="small"
                          icon={<PictureAsPdfRoundedIcon />}
                          label={name}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Chip
                      size="small"
                      icon={<AttachFileRoundedIcon />}
                      label={`${request.sourceEmail?.attachmentCount ?? 0} original attachment${request.sourceEmail?.attachmentCount === 1 ? '' : 's'}`}
                      variant="outlined"
                      sx={{ alignSelf: 'flex-start' }}
                    />
                  )}
                  {request.sourceEmail?.body && (
                    <Accordion disableGutters elevation={0}>
                      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                        <Typography variant="body2" fontWeight={800}>
                          View original email content
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {request.sourceEmail.body}
                        </Typography>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Stack>
              ) : sourceInputMode === 'PDF' ? (
                <Box
                  aria-label="Source email PDF drop zone"
                  onDragEnter={(event) => {
                    event.preventDefault()
                    if (isAutofillApplying) return
                    setIsPdfDragging(true)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = isAutofillApplying ? 'none' : 'copy'
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setIsPdfDragging(false)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (isAutofillApplying) return
                    setIsPdfDragging(false)
                    acceptSourcePdf(event.dataTransfer.files)
                  }}
                  sx={{
                    border: 2,
                    borderStyle: 'dashed',
                    borderColor: sourceExtractionError
                      ? 'error.main'
                      : isPdfDragging ? 'primary.main' : 'divider',
                    borderRadius: 2,
                    bgcolor: isPdfDragging ? 'action.hover' : 'background.paper',
                    p: { xs: 2, sm: 3 },
                    textAlign: 'center',
                    transition: 'border-color 120ms ease, background-color 120ms ease',
                  }}
                >
                  <PictureAsPdfRoundedIcon color={isPdfDragging ? 'primary' : 'action'} />
                  <Typography fontWeight={800} sx={{ mt: 0.75 }}>
                    Drop the source email PDF here
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    One PDF only · maximum 10 MB
                  </Typography>
                  <Button
                    component="label"
                    aria-label={sourcePdf ? 'Replace source email PDF' : 'Choose source email PDF'}
                    size="small"
                    variant="outlined"
                    startIcon={<AttachFileRoundedIcon />}
                    sx={{ mt: 1.5 }}
                  >
                    {sourcePdf ? 'Replace PDF' : 'Choose PDF'}
                    <input
                      hidden
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(event) => {
                        acceptSourcePdf(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </Button>
                </Box>
              ) : (
                <Stack spacing={1}>
                  <TextField
                    label="Email content"
                    value={sourceEmailText}
                    onChange={(event) => {
                      setSourceEmailText(event.target.value)
                      setSourceExtractionError('')
                    }}
                    placeholder="Paste the body of the service email here…"
                    error={sourceEmailText.length > MAX_EMAIL_TEXT_CHARACTERS}
                    helperText={`${sourceEmailText.length.toLocaleString()} / ${MAX_EMAIL_TEXT_CHARACTERS.toLocaleString()} characters`}
                    multiline
                    minRows={8}
                    maxRows={18}
                    fullWidth
                  />
                  <Button
                    type="button"
                    variant="outlined"
                    startIcon={<ScienceOutlinedIcon />}
                    disabled={isExtractingSource || !sourceEmailText.trim()}
                    onClick={() => void extractSourceEmailText()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Analyze and fill form
                  </Button>
                </Stack>
              )}
              {isExtractingSource && (
                <Alert
                  severity="info"
                  variant="outlined"
                  icon={<CircularProgress size={20} />}
                >
                  {sourceInputMode === 'PDF'
                    ? 'Uploading the PDF and extracting its text with Mistral OCR. Form fields are temporarily locked to protect your changes…'
                    : 'Analyzing the email text with Mistral. Form fields are temporarily locked to protect your changes…'}
                </Alert>
              )}
              {sourceExtractionError && (
                <Alert
                  severity="error"
                  variant="outlined"
                  action={sourceInputMode === 'PDF'
                    && sourcePdf
                    && !sourceExtraction
                    && !isExtractingSource ? (
                    <Button
                      type="button"
                      color="inherit"
                      size="small"
                      onClick={() => void extractSourcePdf(sourcePdf)}
                    >
                      Retry
                    </Button>
                  ) : undefined}
                >
                  {sourceExtractionError}
                </Alert>
              )}
              {sourceInputMode === 'PDF' && sourcePdf && (
                <Chip
                  icon={<PictureAsPdfRoundedIcon />}
                  label={`${sourcePdf.name} · ${formatPdfSize(sourcePdf.size)}`}
                  color="success"
                  variant="outlined"
                  onDelete={() => {
                    extractionRequestRef.current += 1
                    cancelReapplyExtractedDataFeedback()
                    clearExtractedDataResetSnapshot()
                    setSourcePdf(null)
                    setSourceExtractionError('')
                    setSourceExtraction(null)
                    setPdfAutofillReview(null)
                    setIncludedExcludedItems([])
                    setIsExtractingSource(false)
                  }}
                  sx={{
                    alignSelf: 'flex-start',
                    maxWidth: '100%',
                    '& .MuiChip-label': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                />
              )}
              {sourceExtraction && (
                <Stack spacing={1}>
                  <Alert severity="success" variant="outlined">
                    {sourceExtraction.sourceType === 'EMAIL_TEXT' ? (
                      'Email text analyzed successfully'
                    ) : (
                      <>
                        PDF extracted successfully · {sourceExtraction.pageCount}{' '}
                        {sourceExtraction.pageCount === 1 ? 'page' : 'pages'}
                        {sourceConfidenceLabel ? ` · ${sourceConfidenceLabel}` : ''}
                      </>
                    )}
                  </Alert>
                  <Alert severity="info" variant="outlined">
                    Structured data ready · {sourceExtraction.structuredData.contacts.length}{' '}
                    {sourceExtraction.structuredData.contacts.length === 1 ? 'contact' : 'contacts'}
                    {' · '}{pdfAutofillReview?.relevantServiceItemCount ?? 0}{' '}
                    {(pdfAutofillReview?.relevantServiceItemCount ?? 0) === 1
                      ? 'applicable service item loaded'
                      : 'applicable service items loaded'}
                    {' · '}{pdfAutofillReview?.reviewNotes.length ?? 0}{' '}
                    {(pdfAutofillReview?.reviewNotes.length ?? 0) === 1
                      ? 'review note'
                      : 'review notes'}
                  </Alert>
                  {pdfAutofillReview && (
                    <Alert
                      severity={pdfAutofillReview.missingFields.length > 0 ? 'warning' : 'success'}
                      variant="outlined"
                    >
                      <Typography variant="body2" fontWeight={800}>
                        Form fields were filled from the{' '}
                        {sourceExtraction.sourceType === 'EMAIL_TEXT' ? 'email text' : 'PDF'}.
                        {' '}Review them before creating the request.
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        All applicable service items were loaded into this request. You can review,
                        edit, add, or remove them in Requested work items.
                      </Typography>
                      {pdfAutofillReview.otherVendorCount > 0 && (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {pdfAutofillReview.otherVendorCount}{' '}
                          {pdfAutofillReview.otherVendorCount === 1 ? 'item was' : 'items were'}
                          {' '}excluded because another vendor is explicitly assigned.
                        </Typography>
                      )}
                      {pdfAutofillReview.missingFields.length > 0 && (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          Still required: {pdfAutofillReview.missingFields.join(', ')}.
                        </Typography>
                      )}
                    </Alert>
                  )}
                  {pdfAutofillReview?.reviewNotes.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                      <Typography variant="body2" fontWeight={800}>
                        Coordinator review
                      </Typography>
                      <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                        {pdfAutofillReview.reviewNotes.map((note) => (
                          <Typography component="li" variant="body2" key={note}>
                            {note}
                          </Typography>
                        ))}
                      </Box>
                    </Alert>
                  )}
                  {(excludedSourceItems.length > 0 || includedExcludedItems.length > 0) && (
                    <Accordion
                      disableGutters
                      elevation={0}
                      sx={{
                        border: 1,
                        borderColor: 'warning.main',
                        borderRadius: 1,
                        '&::before': { display: 'none' },
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={800}>
                            Items assigned to another vendor
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {excludedSourceItems.length} excluded by default
                            {includedExcludedItems.length > 0
                              ? ` · ${includedExcludedItems.length} manually included`
                              : ''}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={1.25}>
                          <Alert severity="warning" variant="outlined">
                            These items are not part of Valtrim's request unless the coordinator
                            reviews one and includes it manually.
                          </Alert>
                          {excludedSourceItems.map((item) => (
                            <Box
                              key={item.sourceIndex}
                              sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                p: 1.5,
                              }}
                            >
                              <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={1}
                                sx={{
                                  justifyContent: 'space-between',
                                  alignItems: { xs: 'stretch', sm: 'flex-start' },
                                }}
                              >
                                <Box sx={{ minWidth: 0 }}>
                                  <Stack
                                    direction="row"
                                    spacing={0.75}
                                    useFlexGap
                                    sx={{ flexWrap: 'wrap', mb: 0.5 }}
                                  >
                                    <Chip size="small" label={`Source item ${item.sourceItemNumber}`} />
                                    <Chip
                                      size="small"
                                      color="warning"
                                      variant="outlined"
                                      label={item.assignedVendor}
                                    />
                                  </Stack>
                                  <Typography variant="body2">
                                    {item.description || item.requestedAction || 'No description provided'}
                                  </Typography>
                                  {item.location && (
                                    <Typography variant="caption" color="text.secondary">
                                      Location: {item.location}
                                    </Typography>
                                  )}
                                </Box>
                                <Button
                                  type="button"
                                  size="small"
                                  variant="outlined"
                                  startIcon={<AddRoundedIcon />}
                                  disabled={requestedWorkItems.length >= maxRequestedWorkItems}
                                  onClick={() => includeExcludedSourceItem(item)}
                                  sx={{ flexShrink: 0, alignSelf: { sm: 'center' } }}
                                >
                                  Include item
                                </Button>
                              </Stack>
                            </Box>
                          ))}
                          {excludedSourceItems.length === 0 && (
                            <Alert severity="success" variant="outlined">
                              All originally excluded items have been reviewed and included.
                            </Alert>
                          )}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  )}
                  {pdfAutofillReview && (
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
                    >
                      <Button
                        type="button"
                        color="warning"
                        variant="contained"
                        size="small"
                        startIcon={reapplyExtractedDataStatus === 'loading'
                          ? <CircularProgress color="inherit" size={16} />
                          : <RestartAltRoundedIcon />}
                        disabled={reapplyExtractedDataStatus === 'loading'}
                        onClick={() => setResetConfirmationOpen(true)}
                      >
                        {reapplyExtractedDataStatus === 'loading'
                          ? 'Resetting…'
                          : 'Reset to extracted data'}
                      </Button>
                      {canUndoExtractedDataReset && (
                        <Button
                          type="button"
                          color="info"
                          variant="outlined"
                          size="small"
                          startIcon={<UndoRoundedIcon />}
                          onClick={undoExtractedDataReset}
                        >
                          Undo reset
                        </Button>
                      )}
                      {reapplyExtractedDataStatus === 'success' && (
                        <Chip color="success" label="Extracted data restored" size="small" />
                      )}
                      {reapplyExtractedDataStatus === 'undone' && (
                        <Chip color="info" label="Previous edits restored" size="small" />
                      )}
                    </Stack>
                  )}
                  <Accordion
                    disableGutters
                    elevation={0}
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      '&::before': { display: 'none' },
                    }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Box>
                        <Typography variant="body2" fontWeight={800}>
                          Technical details
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Source text and structured JSON for troubleshooting
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={1}>
                        <TextField
                          label={sourceExtraction.sourceType === 'EMAIL_TEXT'
                            ? 'Analyzed email text'
                            : 'Extracted PDF text'}
                          value={sourceExtraction.text}
                          helperText="Reference only · the mapped fields above remain editable and nothing is saved yet."
                          multiline
                          minRows={6}
                          maxRows={14}
                          fullWidth
                          slotProps={{ htmlInput: { readOnly: true } }}
                        />
                        <TextField
                          label="Structured source data"
                          value={JSON.stringify(sourceExtraction.structuredData, null, 2)}
                          helperText="Reference only · use this JSON to verify the automatic mapping."
                          multiline
                          minRows={8}
                          maxRows={18}
                          fullWidth
                          slotProps={{ htmlInput: { readOnly: true } }}
                        />
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                </Stack>
              )}
            </Stack>
          </Box>
          </Stack>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {!isReadOnlyMode && <Typography
          variant="caption"
          color={showValidationSummary && validationErrorSummary.length > 0
            ? 'error.main'
            : isValid ? 'success.main' : 'text.secondary'}
          sx={{ mr: 'auto' }}
        >
          {showValidationSummary && validationErrorSummary.length > 0
            ? `${validationErrorSummary.length} ${validationErrorSummary.length === 1 ? 'field needs' : 'fields need'} attention.`
            : isValid
              ? canSaveIncomplete ? 'Ready to save for review; remaining planning can be completed later.' : 'Ready to save.'
              : 'Select Save to check the information entered.'}
        </Typography>}
        {isReadOnlyMode && onEdit && (
          <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => onEdit(request)}
            disabled={saving || isAutofillApplying}>
            {isCompleted ? 'Edit internal notes' : planningLocked ? 'Edit priority & notes' : 'Edit request'}
          </Button>
        )}
        {isReadOnlyMode && workflowStage === 'READY_TO_PROPOSE' && onOpenProposal && (
          <Button variant="contained" onClick={() => onOpenProposal(request)} disabled={saving || isAutofillApplying}>
            Open Proposal Workspace
          </Button>
        )}
        <Button
          color="inherit"
          onClick={requestClose}
          disabled={saving || isAutofillApplying}
          sx={{ ml: isReadOnlyMode ? 'auto' : undefined }}
        >
          {isReadOnlyMode || savedSubmission ? 'Close' : 'Cancel'}
        </Button>
        {!isReadOnlyMode && <Button
          type="submit"
          variant="contained"
          disabled={saving || isAutofillApplying}
        >
          {saving ? 'Saving…' : savedSubmission ? 'Retry saved request' : isEditMode ? 'Save changes' : 'Save for review'}
        </Button>}
      </DialogActions>

      <Dialog
        open={resetConfirmationOpen}
        onClose={() => setResetConfirmationOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="confirm-extracted-data-reset-title"
      >
        <DialogTitle id="confirm-extracted-data-reset-title">
          Reset to extracted data?
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Extracted values and work items will replace the corresponding edits currently in the
            form. You can use Undo reset afterward to restore this version.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            color="inherit"
            onClick={() => setResetConfirmationOpen(false)}
          >
            Keep my edits
          </Button>
          <Button
            type="button"
            color="warning"
            variant="contained"
            startIcon={<RestartAltRoundedIcon />}
            onClick={reapplyExtractedData}
          >
            Reset form
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={closeConfirmationOpen}
        onClose={() => setCloseConfirmationOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="confirm-new-request-close-title"
      >
        <DialogTitle id="confirm-new-request-close-title">
          {isEditMode ? 'Discard changes?' : 'Discard this request?'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            {isEditMode
              ? 'This form has unsaved changes. Closing it will restore the request to the version shown before editing.'
              : 'This form has unsaved changes. Closing it will discard your field edits, work items, uploaded source, and extracted OCR information.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            color="inherit"
            onClick={() => setCloseConfirmationOpen(false)}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            color="error"
            variant="contained"
            onClick={discardChangesAndClose}
          >
            Discard changes
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
