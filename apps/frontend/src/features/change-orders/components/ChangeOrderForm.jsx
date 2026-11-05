import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Stack, Tooltip } from '@mui/material'

import { CatalogPageHeader } from '../../../components/common/CatalogPage'
import { useAuth } from '../../auth/context/useAuth.js'
import { emptyChangeOrder } from '../data/changeOrders.js'
import { useChangeOrderCoverage } from '../hooks/useChangeOrderCoverage.js'
import {
  canApproveChangeOrders,
  canEditChangeOrders,
  changeOrderProblems,
  problemsByField,
  toCreateChangeOrderRpc,
  toUpdateChangeOrderRpc,
  withSuggestedNumber,
} from '../services/changeOrderRecord.js'
import { createChangeOrder, updateChangeOrder } from '../services/changeOrderRepository.js'
import { useNextChangeOrderNumber } from '../hooks/useChangeOrderData.js'
import ChangeOrderBasicsCard from './ChangeOrderBasicsCard.jsx'
import ChangeOrderCoverageCard from './ChangeOrderCoverageCard.jsx'
import ChangeOrderLinesCard from './ChangeOrderLinesCard.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'
import ChangeOrderSummaryCard from './ChangeOrderSummaryCard.jsx'
import RecentChangeOrdersCard from './RecentChangeOrdersCard.jsx'

// The button saves the Extra / CO with the status chosen in the first card.
const SAVE_LABELS = {
  DRAFT: 'Save Draft',
  PENDING: 'Submit for Approval',
  APPROVED: 'Save as Approved',
}

/**
 * The form of an Extra / CO, to create one (`mode` 'create') or to change a Draft or Pending one
 * (`mode` 'edit', with the Extra / CO it opens with in `initialValues`). Editing saves the same
 * fields; its status is moved from the Extra / CO page, not here.
 */
export default function ChangeOrderForm({
  mode = 'create',
  changeOrderId = null,
  number = '',
  initialValues = emptyChangeOrder,
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const editing = mode === 'edit'
  const canEdit = canEditChangeOrders(profile?.role)
  const canApprove = canApproveChangeOrders(profile?.role)
  const detailPath = `/change-orders/${changeOrderId}`

  const [values, setValues] = useState(initialValues)
  // The Internal # box of a new one starts with the number it will get; once touched, it is theirs.
  const suggestedNumber = useNextChangeOrderNumber(canEdit && !editing)
  const [numberEdited, setNumberEdited] = useState(false)
  const shownValues = useMemo(
    () => (editing ? values : withSuggestedNumber(values, suggestedNumber, numberEdited)),
    [editing, values, suggestedNumber, numberEdited],
  )
  const { lines, places } = useChangeOrderCoverage(values)
  // Nothing is marked until the person tries to save; after that, it follows what they fix.
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const problems = useMemo(
    () => (attempted ? changeOrderProblems(values, { lines, places }) : []),
    [attempted, values, lines, places],
  )
  const fieldErrors = useMemo(() => problemsByField(problems), [problems])

  const handleChange = (changes) => {
    setSaveError('')
    if ('internalNumber' in changes) setNumberEdited(true)
    setValues((current) => ({ ...current, ...changes }))
  }

  const handleSave = async () => {
    setAttempted(true)
    if (changeOrderProblems(values, { lines, places }).length > 0) return

    setSaving(true)
    setSaveError('')
    try {
      if (editing) {
        await updateChangeOrder(toUpdateChangeOrderRpc(changeOrderId, values, { lines, places }))
        navigate(detailPath)
      } else {
        const createdId = await createChangeOrder(
          toCreateChangeOrderRpc(values, { lines, places, status: values.status }),
        )
        navigate(`/change-orders/${createdId}`)
      }
    } catch (error) {
      setSaveError(error.message)
      setSaving(false)
    }
  }

  const saveLabel = editing ? 'Save changes' : (SAVE_LABELS[values.status] ?? 'Save')
  const noPermission = editing
    ? 'Your role can look at Extras / Change Orders but not change them.'
    : 'Your role can look at Extras / Change Orders but not create them.'

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        breadcrumbs={editing
          ? [
            { label: 'Extra / Change Orders', to: '/change-orders' },
            { label: number, to: detailPath },
            { label: 'Edit' },
          ]
          : [
            { label: 'Extra / Change Orders', to: '/change-orders' },
            { label: 'New' },
          ]}
        title={editing ? `Edit ${number}` : 'New Extra / Change Order'}
        titleAdornment={<ChangeOrderStatusChip status={values.status} />}
        actions={(
          <>
            <Tooltip title={canEdit ? '' : noPermission}>
              <span>
                <Button
                  variant="contained"
                  disableElevation
                  disabled={!canEdit || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : saveLabel}
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="outlined"
              color="inherit"
              disabled={saving}
              onClick={() => navigate(editing ? detailPath : '/change-orders')}
            >
              Cancel
            </Button>
          </>
        )}
      />

      <Box
        sx={{
          p: { xs: 2.5, md: 4 },
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 360px' },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {!canEdit && (
            <Alert severity="info">{noPermission}</Alert>
          )}
          {saveError && <Alert severity="error">{saveError}</Alert>}
          {problems.length > 0 && (
            <Alert severity="error" aria-label="What to fix">
              Fix this before saving:
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
                ))}
              </Box>
            </Alert>
          )}
          <ChangeOrderBasicsCard
            values={shownValues}
            onChange={handleChange}
            errors={fieldErrors}
            canApprove={canApprove}
            numberPlaceholder={suggestedNumber}
            statusLocked={editing}
          />
          <ChangeOrderCoverageCard values={values} onChange={handleChange} errors={fieldErrors} />
          <ChangeOrderLinesCard values={values} onChange={handleChange} />
        </Stack>

        <Stack spacing={3} sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
          <ChangeOrderSummaryCard values={shownValues} />
          {!editing && <RecentChangeOrdersCard />}
        </Stack>
      </Box>
    </Box>
  )
}
