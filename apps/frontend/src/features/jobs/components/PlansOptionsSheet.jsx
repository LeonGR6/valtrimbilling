import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { RowActionsMenu, catalogTableSx, visuallyHiddenSx } from '../../../components/common/CatalogPage'
import { plansToCopyFrom } from '../services/planOptionCopy.js'
import PlanToggle from './PlanToggle.jsx'
import { PlanSortableList, SortablePlan } from './PlanSortable.jsx'
import PlanDragPreview from './PlanDragPreview.jsx'
import PlanCard from './PlanCard.jsx'
import { planActions, optionActions } from './planOptionActions.jsx'

export default function PlansOptionsSheet({
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
