import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { RowActionsMenu } from '../../../components/common/CatalogPage'
import PlanToggle from './PlanToggle.jsx'
import { planActions, optionActions } from './planOptionActions.jsx'

export default function PlanCard({
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
