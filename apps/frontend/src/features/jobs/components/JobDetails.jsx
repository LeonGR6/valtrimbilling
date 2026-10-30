import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  FigureStrip,
  RowActionsMenu,
  StatusChip,
  catalogTableSx,
  visuallyHiddenSx,
} from '../../../components/common/CatalogPage'
import {
  emptyJobPlan,
  emptyPlanOption,
  getJobOptionCount,
  getJobPlanCount,
  getJobUnitCount,
  getOptionLotDependencies,
  getPlanLotDependencies,
} from '../data/jobs.js'
import {
  createJobPlanSchema,
  planOptionSchema,
} from '../schemas/jobSequenceSheetSchema.js'
import { useJobs } from '../context/useJobs.js'
import { builderJobsPath } from '../utils/jobRoutes.js'
import JobModuleNavigation from './JobModuleNavigation.jsx'
import { CopyOptionsDialog, CopyOptionsPicker } from './CopyPlanOptions.jsx'
import {
  emptyCopySelection,
  plansToCopyFrom,
  selectedCopyOptions,
} from '../services/planOptionCopy.js'
import PlanToggle from './PlanToggle.jsx'
import { PlanSortableList, SortablePlan } from './PlanSortable.jsx'
import { JobContactsGrid } from './JobContacts.jsx'
import JobBillingSetupCard from './JobBillingSetupCard.jsx'
import OptionsBillingNotice from './OptionsBillingNotice.jsx'
import { filterPlansByQuery } from '../utils/planSearch.js'
import BulkPlanOptionsMode from './bulk-edit/BulkPlanOptionsMode.jsx'
import { describeBulkResult } from '../utils/bulkPlanOptions.js'
import { getJobPlanUsage } from '../utils/planUsage.js'

function PlanDialog({ plans, plan, onClose, onSave, submitting }) {
  // A new Plan can start with Options copied from another Plan of the Job.
  const copySources = useMemo(() => (plan ? [] : plansToCopyFrom(plans)), [plan, plans])
  const [copyValue, setCopyValue] = useState(emptyCopySelection)
  const schema = useMemo(
    () => createJobPlanSchema(plans, plan?.id),
    [plan?.id, plans],
  )
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: plan
      ? { code: plan.code, name: plan.name ?? '' }
      : { ...emptyJobPlan },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit((form) => onSave(form, selectedCopyOptions(copySources, copyValue)))}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              {plan ? 'Edit plan' : 'Add plan'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Enter the Plan exactly as it should appear in the Job worksheet.
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" color="primary" label="Plan worksheet" />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  Plan code <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Plan name
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell>
                  <TextField
                    placeholder="Example: 2-ADA"
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    sx={{ '& .MuiInputBase-input': { fontWeight: 800 } }}
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Plan code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Optional descriptive name"
                    {...register('name')}
                    error={Boolean(errors.name)}
                    helperText={errors.name?.message ?? 'Optional'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 100, 'aria-label': 'Plan name' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {copySources.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.25 }}>
              Options
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              If this plan has the same options as another one, copy them instead of
              typing them again. You can choose which ones.
            </Typography>
            <CopyOptionsPicker
              sources={copySources}
              value={copyValue}
              onChange={setCopyValue}
              disabled={submitting}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : plan ? 'Save changes' : 'Add plan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function OptionDialog({ plan, option, onClose, onSave, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(planOptionSchema),
    defaultValues: option
      ? { code: option.code, description: option.description }
      : { ...emptyPlanOption },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              {option ? 'Edit option' : 'Add option'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              This Option will be grouped under Plan{' '}
              <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {plan.code}
              </Box>
              .
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={`Plan ${plan.code}`}
          />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 130, fontWeight: 750, color: 'text.secondary' }}>
                  Parent plan
                </TableCell>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  OPT # <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Option description <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ pt: 2.25 }}>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={plan.code}
                    sx={{ fontWeight: 750 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder={`Example: OPT 1`}
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Option code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Enter the option description, if doesn't exist, put the same as the OPT #."
                    {...register('description')}
                    error={Boolean(errors.description)}
                    helperText={errors.description?.message ?? 'Required'}
                    multiline
                    minRows={2}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 240, 'aria-label': 'Option description' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : option ? 'Save changes' : 'Add option'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// `onMoveUp` / `onMoveDown` are null when the Plans cannot be reordered (a
// search is active) and the matching one is disabled at the top / bottom.
function planActions({
  onEditPlan,
  onDeletePlan,
  onCopyOptions = null,
  onMoveUp = null,
  onMoveDown = null,
  isFirst,
  isLast,
}) {
  const canMove = onMoveUp !== null && onMoveDown !== null
  return [
    ...(canMove ? [
      {
        label: 'Move up',
        icon: <ArrowUpwardRoundedIcon fontSize="small" />,
        onClick: onMoveUp,
        disabled: isFirst,
      },
      {
        label: 'Move down',
        icon: <ArrowDownwardRoundedIcon fontSize="small" />,
        onClick: onMoveDown,
        disabled: isLast,
      },
    ] : []),
    ...(onCopyOptions ? [{
      label: 'Copy options from another plan',
      icon: <ContentCopyRoundedIcon fontSize="small" />,
      onClick: onCopyOptions,
    }] : []),
    {
      label: 'Edit plan',
      icon: <EditOutlinedIcon fontSize="small" />,
      onClick: onEditPlan,
    },
    {
      label: 'Delete plan',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      color: 'error.main',
      onClick: onDeletePlan,
    },
  ]
}

function optionActions({ onEditOption, onDeleteOption }) {
  return [
    {
      label: 'Edit option',
      icon: <EditOutlinedIcon fontSize="small" />,
      onClick: onEditOption,
    },
    {
      label: 'Delete option',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      color: 'error.main',
      onClick: onDeleteOption,
    },
  ]
}

// What follows the pointer while a Plan is dragged.
function PlanDragPreview({ plan }) {
  const count = plan.options?.length ?? 0

  return (
    <Paper
      elevation={6}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        width: 'min(340px, 90vw)',
        bgcolor: 'primary.light',
        border: 1,
        borderColor: 'primary.main',
        cursor: 'grabbing',
      }}
    >
      <DragIndicatorRoundedIcon fontSize="small" color="action" />
      <Typography variant="body2" fontWeight={800}>Plan {plan.code}</Typography>
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {plan.name || `Plan ${plan.code}`}
      </Typography>
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        label={count}
        sx={{ minWidth: 34, fontWeight: 700 }}
      />
    </Paper>
  )
}

function PlanCard({
  plan,
  canManage,
  dragHandle = null,
  expanded = true,
  // False while a Plan is dragged: the Plans fold at once so the list can be measured.
  animate = true,
  onToggle = null,
  onAddOption,
  onEditPlan,
  onDeletePlan,
  planMoves = {},
  onCopyOptions = null,
  onEditOption,
  onDeleteOption,
}) {
  const options = plan.options ?? []

  return (
    <Card component="article" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: 'primary.light',
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {dragHandle}
          {onToggle && (
            <PlanToggle
              plan={plan}
              expanded={expanded}
              onToggle={onToggle}
              controls={`plan-card-${plan.id}`}
            />
          )}
          <Box
            onClick={onToggle ?? undefined}
            sx={{ minWidth: 0, flex: 1, pl: 0.5, cursor: onToggle ? 'pointer' : 'default' }}
          >
            <Typography variant="body2" color="text.secondary">
              Plan{' '}
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>
                {plan.code}
              </Box>
            </Typography>
            <Typography variant="subtitle1" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
              {plan.name || `Plan ${plan.code}`}
            </Typography>
          </Box>
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={plan.optionCount ?? options.length}
            aria-label={`${plan.optionCount ?? options.length} options`}
            sx={{ minWidth: 34, fontWeight: 700, flexShrink: 0 }}
          />
          {canManage && (
            <RowActionsMenu
              label={`Actions for Plan ${plan.code}`}
              items={planActions({ onEditPlan, onDeletePlan, onCopyOptions, ...planMoves })}
            />
          )}
        </Stack>
      </Box>

      <Collapse in={expanded} timeout={animate ? 'auto' : 0} unmountOnExit>
        <Box id={`plan-card-${plan.id}`} sx={{ p: 2 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
          >
            <Typography variant="body2" color="text.secondary">
              {plan.optionCount ?? options.length}{' '}
              {(plan.optionCount ?? options.length) === 1 ? 'option' : 'options'}
              {plan.optionCount != null && plan.optionCount !== options.length
                ? ` (${options.length} shown)`
                : ''}
            </Typography>
            {canManage && options.length > 0 && (
              <Button
                size="small"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={onAddOption}
                disableElevation
                sx={{ whiteSpace: 'nowrap' }}
              >
                Add option
              </Button>
            )}
          </Stack>

          {options.length > 0 ? (
            <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
              {options.map((option) => (
                <Stack
                  key={option.id}
                  direction="row"
                  spacing={1}
                  sx={{ px: 1.5, py: 1.25, alignItems: 'flex-start', justifyContent: 'space-between' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={option.code}
                      sx={{ fontWeight: 700, maxWidth: '100%', mb: 0.5 }}
                    />
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {option.description}
                    </Typography>
                  </Box>
                  {canManage && (
                    <RowActionsMenu
                      label={`Actions for option ${option.code} in Plan ${plan.code}`}
                      items={optionActions({
                        onEditOption: () => onEditOption(option),
                        onDeleteOption: () => onDeleteOption(option),
                      })}
                    />
                  )}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Box
              sx={{
                py: 2.5,
                px: 2,
                textAlign: 'center',
                border: 1,
                borderStyle: 'dashed',
                borderColor: 'divider',
                borderRadius: 1.5,
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ mb: canManage ? 1.5 : 0 }}>
                No options in this plan yet.
              </Typography>
              {canManage && (
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap' }} useFlexGap>
                  <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={onAddOption}>
                    Add first option
                  </Button>
                  {onCopyOptions && (
                    <Button size="small" variant="text" startIcon={<ContentCopyRoundedIcon />} onClick={onCopyOptions}>
                      Copy from another plan
                    </Button>
                  )}
                </Stack>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Card>
  )
}

function PlansOptionsSheet({
  plans,
  canManage,
  reorderable,
  onReorder,
  openPlanIds,
  onOpenPlanIdsChange,
  searching,
  onAddPlan,
  onAddOption,
  copySourcePlans,
  onCopyOptions,
  onEditPlan,
  onDeletePlan,
  onEditOption,
  onDeleteOption,
}) {
  // Copying Options needs another Plan that has some.
  const copyHandlerOf = (plan) => (
    canManage && plansToCopyFrom(copySourcePlans, plan.id).length > 0
      ? () => onCopyOptions(plan)
      : null
  )

  // Plans the person closed, kept apart from the drag: every Plan folds while
  // one is dragged (so the whole list fits on screen) and goes back afterwards.
  const [draggingId, setDraggingId] = useState(null)
  // Plans start closed; the person opens the ones they need. While searching they
  // all open, so the options that matched can be seen.
  const isExpanded = (plan) => draggingId === null
    && (searching || openPlanIds.has(plan.id))

  // A Plan that was dragged somewhere else stays closed: the person opens it
  // again on purpose, once it is where they wanted it.
  const reorderAfterDrag = (planIds, movedId) => {
    onOpenPlanIdsChange((current) => {
      const next = new Set(current)
      next.delete(movedId)
      return next
    })
    onReorder(planIds)
  }

  // Move up / Move down in the Plan's menu: the same reorder without dragging.
  const movesOf = (plan) => {
    if (!reorderable) return {}
    const index = plans.findIndex(({ id }) => id === plan.id)
    const moveTo = (target) => {
      const ids = plans.map(({ id }) => id)
      ids.splice(target, 0, ids.splice(index, 1)[0])
      onReorder(ids)
    }
    return {
      onMoveUp: () => moveTo(index - 1),
      onMoveDown: () => moveTo(index + 1),
      isFirst: index === 0,
      isLast: index === plans.length - 1,
    }
  }

  const toggle = (plan) => {
    onOpenPlanIdsChange((current) => {
      const next = new Set(current)
      if (next.has(plan.id)) next.delete(plan.id)
      else next.add(plan.id)
      return next
    })
  }

  // After a drop the list unfolds again; bring the moved Plan back into view.
  const lastDraggedId = useRef(null)
  const handleDragChange = useCallback((id) => setDraggingId(id), [])
  useEffect(() => {
    if (draggingId !== null) {
      lastDraggedId.current = draggingId
      return undefined
    }

    const movedId = lastDraggedId.current
    if (movedId === null) return undefined

    lastDraggedId.current = null
    const timer = setTimeout(() => {
      const moved = [...document.querySelectorAll(`[data-plan-id="${movedId}"]`)]
        .find((element) => element.offsetParent !== null)
      moved?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 0)
    return () => clearTimeout(timer)
  }, [draggingId])

  return (
    <>
      <Stack spacing={2} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
        <PlanSortableList
          plans={plans}
          onReorder={reorderAfterDrag}
          onDragChange={handleDragChange}
          renderPreview={(plan) => <PlanDragPreview plan={plan} />}
          contextId="plans-mobile"
        >
          {plans.map((plan) => (
            <SortablePlan key={plan.id} plan={plan} disabled={!reorderable}>
              {({ rootProps, handle }) => (
                <Box {...rootProps}>
                  <PlanCard
                    plan={plan}
                    canManage={canManage}
                    dragHandle={handle}
                    expanded={isExpanded(plan)}
                    animate={draggingId === null}
                    onToggle={() => toggle(plan)}
                    onAddOption={() => onAddOption(plan)}
                    onEditPlan={() => onEditPlan(plan)}
                    onDeletePlan={() => onDeletePlan(plan)}
                    planMoves={movesOf(plan)}
                    onCopyOptions={copyHandlerOf(plan)}
                    onEditOption={(option) => onEditOption(plan, option)}
                    onDeleteOption={(option) => onDeleteOption(plan, option)}
                  />
                </Box>
              )}
            </SortablePlan>
          ))}
        </PlanSortableList>
        {canManage && (
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={onAddPlan}>
            Add another plan
          </Button>
        )}
      </Stack>

      {/* Outside the table: the drag library adds <div>s next to its children. */}
      <PlanSortableList
        plans={plans}
        onReorder={reorderAfterDrag}
        onDragChange={handleDragChange}
        renderPreview={(plan) => <PlanDragPreview plan={plan} />}
        contextId="plans-desktop"
      >
      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table
          size="small"
          aria-label="Plans and options worksheet"
          sx={[{ minWidth: 820 }, catalogTableSx]}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 110 }}>Item</TableCell>
              <TableCell sx={{ width: 180 }}>Code</TableCell>
              <TableCell>Name / description</TableCell>
              <TableCell align="center" sx={{ width: 90 }}>Options</TableCell>
              <TableCell align="right" sx={{ width: 210 }}>
                <Box component="span" sx={visuallyHiddenSx}>Actions</Box>
              </TableCell>
            </TableRow>
          </TableHead>
            {plans.map((plan) => {
              const options = plan.options ?? []

              return (
                <SortablePlan key={plan.id} plan={plan} disabled={!reorderable}>
                  {({ rootProps, handle }) => (
                <TableBody {...rootProps}>
                  <TableRow sx={{ bgcolor: 'primary.light' }}>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: -1 }}>
                        {handle}
                        <PlanToggle
                          plan={plan}
                          expanded={isExpanded(plan)}
                          onToggle={() => toggle(plan)}
                        />
                        <Typography variant="body2" fontWeight={700} color="primary.main">
                          Plan
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body1" fontWeight={800}>
                        {plan.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {plan.name || `Plan ${plan.code}`}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={plan.optionCount ?? options.length}
                        sx={{ minWidth: 34, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                        >
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddRoundedIcon />}
                            onClick={() => onAddOption(plan)}
                            disableElevation
                            sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            Add option
                          </Button>
                          <RowActionsMenu
                            label={`Actions for Plan ${plan.code}`}
                            items={planActions({
                              onEditPlan: () => onEditPlan(plan),
                              onDeletePlan: () => onDeletePlan(plan),
                              onCopyOptions: copyHandlerOf(plan),
                              ...movesOf(plan),
                            })}
                          />
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">Read only</Typography>
                      )}
                    </TableCell>
                  </TableRow>

                  {!isExpanded(plan) ? null : options.length > 0 ? options.map((option) => (
                    <TableRow key={option.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pl: 0.5 }}>
                          <Box
                            aria-hidden="true"
                            sx={{ width: 14, height: 14, borderLeft: 1, borderBottom: 1, borderColor: 'divider', mt: -0.5 }}
                          />
                          <Typography variant="body2" color="text.secondary">
                            Option
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                        >
                          {option.code}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {option.description}
                        </Typography>
                      </TableCell>
                      <TableCell />
                      <TableCell align="right">
                        {canManage ? (
                          <RowActionsMenu
                            label={`Actions for option ${option.code} in Plan ${plan.code}`}
                            items={optionActions({
                              onEditOption: () => onEditOption(plan, option),
                              onDeleteOption: () => onDeleteOption(plan, option),
                            })}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">Read only</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'background.default' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No options in this plan yet.
                          </Typography>
                          {canManage && (
                            <Stack direction="row" spacing={0.5}>
                              {copyHandlerOf(plan) && (
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<ContentCopyRoundedIcon />}
                                  onClick={copyHandlerOf(plan)}
                                >
                                  Copy from another plan
                                </Button>
                              )}
                              <Button
                                size="small"
                                variant="text"
                                startIcon={<AddRoundedIcon />}
                                onClick={() => onAddOption(plan)}
                              >
                                Add first option
                              </Button>
                            </Stack>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                  )}
                </SortablePlan>
              )
            })}
          {canManage && (
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} sx={{ bgcolor: 'background.default' }}>
                  <Button size="small" startIcon={<AddRoundedIcon />} onClick={onAddPlan}>
                    Add another plan
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>
      </TableContainer>
      </PlanSortableList>
    </>
  )
}

export default function JobDetails({
  builderId,
  job,
  contacts,
}) {
  const {
    canManageJobs,
    createJobPlan,
    applyPlanOptionChanges,
    updateJobPlan,
    deactivateJobPlan,
    reorderJobPlans,
    createPlanOption,
    createPlanOptions,
    updatePlanOption,
    deactivatePlanOption,
  } = useJobs()
  const [planDialog, setPlanDialog] = useState(null)
  // The bulk mode: Plans and Options edited, deleted and added in a grid, and saved together.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [optionDialog, setOptionDialog] = useState(null)
  const [copyDialog, setCopyDialog] = useState(null)
  // Plans the person has opened; every Plan starts closed.
  const [openPlanIds, setOpenPlanIds] = useState(() => new Set())
  const revealPlan = (planId) => {
    setOpenPlanIds((current) => new Set(current).add(planId))
  }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [query, setQuery] = useState('')
  const canManagePlans = canManageJobs && job.isActive
  const jobPlans = job.sequenceSheet?.plans
  const plans = useMemo(() => jobPlans ?? [], [jobPlans])
  // Which Plans and Options the Lots use: those cannot be deleted in the bulk mode.
  const bulkUsage = useMemo(() => getJobPlanUsage(job), [job])
  // While searching, a plan shows when it matches or when some of its options
  // do; then only the matching options are listed under it.
  const visiblePlans = useMemo(() => filterPlansByQuery(plans, query), [plans, query])
  const deleteDependencies = deleteTarget
    ? deleteTarget.type === 'plan'
      ? getPlanLotDependencies(job, deleteTarget.plan.id)
      : getOptionLotDependencies(job, deleteTarget.option.id)
    : []
  const dependencyPhaseCount = new Set(
    deleteDependencies.map((dependency) => dependency.phaseId),
  ).size
  const deletionBlocked = deleteDependencies.length > 0

  const handlePlanSave = async (form, copiedOptions = []) => {
    setSubmitting(true)
    try {
      if (planDialog?.plan) {
        await updateJobPlan(job.id, planDialog.plan.id, form)
        setNotice({ severity: 'success', message: 'Plan updated.' })
      } else {
        const created = await createJobPlan(job.id, form)
        if (copiedOptions.length === 0) {
          setNotice({ severity: 'success', message: 'Plan added.' })
        } else {
          // The Plan exists by now: a failure here must not look like the Plan was not saved.
          try {
            await createPlanOptions(job.id, created.id, copiedOptions)
            revealPlan(created.id)
            setNotice({
              severity: 'success',
              message: `Plan added with ${copiedOptions.length} ${copiedOptions.length === 1 ? 'option' : 'options'}.`,
            })
          } catch (copyError) {
            setNotice({
              severity: 'warning',
              message: `Plan added, but its options could not be copied: ${copyError.message}`,
            })
          }
        }
      }
      setPlanDialog(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkSave = async (changes, summary) => {
    try {
      const result = await applyPlanOptionChanges(job.id, changes)
      // A few Plans open to show what was added; a long list stays closed.
      const touched = [...new Set([...result.plans.map(({ id }) => id), ...result.optionPlanIds])]
      if (touched.length <= 3) touched.forEach(revealPlan)
      setNotice({
        severity: 'success',
        // The Options already there that the grid left out count with the ones the database skipped.
        message: describeBulkResult({ ...result, optionsSkipped: result.optionsSkipped + summary.optionsSkipped }),
      })
      setBulkOpen(false)
    } catch (bulkError) {
      setNotice({ severity: 'error', message: bulkError.message })
      throw bulkError
    }
  }

  const handleCopyOptions = async (options) => {
    setSubmitting(true)
    try {
      await createPlanOptions(job.id, copyDialog.plan.id, options)
      revealPlan(copyDialog.plan.id)
      setNotice({
        severity: 'success',
        message: `${options.length} ${options.length === 1 ? 'option' : 'options'} copied into Plan ${copyDialog.plan.code}.`,
      })
      setCopyDialog(null)
    } catch (copyError) {
      setNotice({ severity: 'error', message: copyError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReorder = async (planIds) => {
    try {
      await reorderJobPlans(job.id, planIds)
    } catch (reorderError) {
      setNotice({ severity: 'error', message: reorderError.message })
    }
  }

  const handleOptionSave = async (form) => {
    const { plan, option } = optionDialog
    setSubmitting(true)
    try {
      if (option) {
        await updatePlanOption(job.id, plan.id, option.id, form)
      } else {
        await createPlanOption(job.id, plan.id, form)
      }
      revealPlan(plan.id)
      setNotice({
        severity: 'success',
        message: option ? 'Option updated.' : 'Option added.',
      })
      setOptionDialog(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deletionBlocked) {
      setNotice({
        severity: 'error',
        message: 'Reassign or remove the dependent lots before deleting this item.',
      })
      return
    }

    setSubmitting(true)
    try {
      if (deleteTarget.type === 'plan') {
        await deactivateJobPlan(job.id, deleteTarget.plan.id)
        setNotice({ severity: 'success', message: 'Plan deleted.' })
      } else {
        await deactivatePlanOption(
          job.id,
          deleteTarget.plan.id,
          deleteTarget.option.id,
        )
        setNotice({ severity: 'success', message: 'Option deleted.' })
      }
      setDeleteTarget(null)
    } catch (deleteError) {
      setNotice({ severity: 'error', message: deleteError.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        borderless
        breadcrumbs={[
          { label: 'Jobs', to: '/jobs' },
          { label: job.builder, to: builderJobsPath(builderId) },
          { label: `Job ${job.code}` },
        ]}
        title={`Job ${job.code}`}
        titleAdornment={<StatusChip active={job.isActive} />}
        subtitle={`${job.community} · ${job.builder}`}
        meta={(
          <FigureStrip
            label={`Job ${job.code} summary`}
            figures={[
              { label: 'lots', value: getJobUnitCount(job) },
              { label: getJobPlanCount(job) === 1 ? 'plan' : 'plans', value: getJobPlanCount(job) },
              { label: getJobOptionCount(job) === 1 ? 'option' : 'options', value: getJobOptionCount(job) },
            ]}
          />
        )}
        actions={canManagePlans && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<PlaylistAddRoundedIcon />}
              onClick={() => setBulkOpen(true)}
              disabled={bulkOpen}
            >
              Bulk edit
            </Button>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setPlanDialog({ plan: null })}
              disabled={bulkOpen}
              disableElevation
            >
              New plan
            </Button>
          </Stack>
        )}
      />

      <JobModuleNavigation
        active="plans-options"
        builderId={builderId}
        jobId={job.id}
        showBack={false}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {!canManagePlans && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {job.isActive
              ? 'You can review Plans and Options, but your role cannot change them.'
              : 'This Job is inactive. Its Plans, Options and prices are read-only.'}
          </Alert>
        )}

        <Card variant="outlined" sx={{ mb: 2.5 }}>
          <CardContent sx={{ p: '16px 20px !important' }}>
            <Typography component="h2" variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
              Job team
            </Typography>
            <JobContactsGrid contacts={contacts} />
          </CardContent>
        </Card>

        <JobBillingSetupCard job={job} />
        <OptionsBillingNotice job={job} optionCount={getJobOptionCount(job)} sx={{ mb: 2.5 }} />

        {bulkOpen && canManagePlans ? (
          <BulkPlanOptionsMode
            plans={plans}
            usage={bulkUsage}
            onSave={handleBulkSave}
            onClose={() => setBulkOpen(false)}
          />
        ) : (
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
              sx={{
                px: 2.5,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                alignItems: { md: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Typography component="h2" variant="subtitle1" fontWeight={700}>
                  Plans &amp; options
                </Typography>
                <Chip
                  label={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
                  size="small"
                  variant="outlined"
                />
              </Stack>
              {plans.length > 0 && (
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  size="small"
                  placeholder="Search plans or options"
                  sx={{ width: { xs: '100%', md: 320 } }}
                  slotProps={{
                    htmlInput: { 'aria-label': 'Search plans or options' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRoundedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                      endAdornment: query ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            aria-label="Clear search"
                            onClick={() => setQuery('')}
                          >
                            <ClearRoundedIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    },
                  }}
                />
              )}
            </Stack>

            {plans.length === 0 ? (
              <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
                <LayersRoundedIcon color="disabled" sx={{ fontSize: 36, mb: 1 }} aria-hidden="true" />
                <Typography fontWeight={700}>No plans in this job yet</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                  Add the first plan, then organize its options underneath it.
                </Typography>
                {canManagePlans && (
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                    <Button
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={() => setPlanDialog({ plan: null })}
                    >
                      Add plan
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<PlaylistAddRoundedIcon />}
                      onClick={() => setBulkOpen(true)}
                    >
                      Bulk edit
                    </Button>
                  </Stack>
                )}
              </Box>
            ) : visiblePlans.length === 0 ? (
              <CatalogEmptyState
                title="No plans or options found"
                description={`Nothing in Job ${job.code} matches “${query.trim()}”.`}
                action={(
                  <Button size="small" variant="outlined" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                )}
              />
            ) : (
              <PlansOptionsSheet
                plans={visiblePlans}
                canManage={canManagePlans}
                // A filtered list hides Plans, so the order only changes without a search.
                reorderable={canManagePlans && !query.trim() && plans.length > 1}
                onReorder={handleReorder}
                openPlanIds={openPlanIds}
                onOpenPlanIdsChange={setOpenPlanIds}
                searching={Boolean(query.trim())}
                onAddPlan={() => setPlanDialog({ plan: null })}
                onAddOption={(plan) => setOptionDialog({ plan, option: null })}
                copySourcePlans={plans}
                onCopyOptions={(plan) => setCopyDialog({ plan })}
                onEditPlan={(plan) => setPlanDialog({ plan })}
                onDeletePlan={(plan) => setDeleteTarget({ type: 'plan', plan })}
                onEditOption={(plan, option) => setOptionDialog({ plan, option })}
                onDeleteOption={(plan, option) =>
                  setDeleteTarget({ type: 'option', plan, option })
                }
              />
            )}
          </Box>
        )}
      </Box>

      {planDialog && (
        <PlanDialog
          key={planDialog.plan?.id ?? 'new-plan'}
          plans={plans}
          plan={planDialog.plan}
          onClose={() => setPlanDialog(null)}
          onSave={handlePlanSave}
          submitting={submitting}
        />
      )}

      {copyDialog && (
        <CopyOptionsDialog
          key={`copy-${copyDialog.plan.id}`}
          plan={plans.find(({ id }) => id === copyDialog.plan.id) ?? copyDialog.plan}
          sources={plansToCopyFrom(plans, copyDialog.plan.id)}
          onClose={() => setCopyDialog(null)}
          onCopy={handleCopyOptions}
          submitting={submitting}
        />
      )}

      {optionDialog && (
        <OptionDialog
          key={optionDialog.option?.id ?? `new-option-${optionDialog.plan.id}`}
          plan={optionDialog.plan}
          option={optionDialog.option}
          onClose={() => setOptionDialog(null)}
          onSave={handleOptionSave}
          submitting={submitting}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={submitting ? undefined : () => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {deletionBlocked
            ? deleteTarget?.type === 'plan'
              ? 'Plan is in use'
              : 'Option is in use'
            : deleteTarget?.type === 'plan'
              ? 'Delete plan?'
              : 'Delete option?'}
        </DialogTitle>
        <DialogContent>
          {deletionBlocked ? (
            <Stack spacing={2}>
              <Alert severity="warning">
                {deleteTarget?.type === 'plan'
                  ? `Plan ${deleteTarget.plan.code} cannot be deleted because ${deleteDependencies.length} ${deleteDependencies.length === 1 ? 'lot depends' : 'lots depend'} on it across ${dependencyPhaseCount} ${dependencyPhaseCount === 1 ? 'phase' : 'phases'}.`
                  : `${deleteTarget.option.code} cannot be deleted because it is selected for ${deleteDependencies.length} ${deleteDependencies.length === 1 ? 'lot' : 'lots'} across ${dependencyPhaseCount} ${dependencyPhaseCount === 1 ? 'phase' : 'phases'}.`}
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Reassign or remove these dependencies from Sequence Sheets before deleting it.
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {deleteDependencies.slice(0, 6).map((dependency) => (
                  <Chip
                    key={`${dependency.phaseId}-${dependency.lotId}`}
                    size="small"
                    variant="outlined"
                    label={`Phase ${dependency.phaseName} · Lot ${dependency.lotNumber}`}
                  />
                ))}
                {deleteDependencies.length > 6 && (
                  <Chip
                    size="small"
                    label={`+${deleteDependencies.length - 6} more`}
                  />
                )}
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {deleteTarget?.type === 'plan'
                ? `Plan ${deleteTarget.plan.code} and all of its options will be removed from Job ${job.code}.`
                : deleteTarget
                  ? `${deleteTarget.option.code} will be removed from Plan ${deleteTarget.plan.code}.`
                  : ''}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            color="inherit"
            onClick={() => setDeleteTarget(null)}
            disabled={submitting}
          >
            {deletionBlocked ? 'Close' : 'Cancel'}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disableElevation
            disabled={deletionBlocked || submitting}
          >
            {submitting ? 'Deleting...' : 'Delete'}
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
