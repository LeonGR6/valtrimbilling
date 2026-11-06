import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Stack } from '@mui/material'

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
import ChangeOrderFormSection from './ChangeOrderFormSection.jsx'
import ChangeOrderSaveBar from './ChangeOrderSaveBar.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'
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
  const { job, lines, places, amounts } = useChangeOrderCoverage(values)
  // Nothing is marked until the person tries to save; after that, it follows what they fix.
  const [attempted, setAttempted] = useState(false)
  // Each failed save brings the list of what to fix into view: the bar is the only thing always on screen.
  const [failedSaves, setFailedSaves] = useState(0)
  const problemsRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // What is still missing, always: the steps and the bar follow it; the messages wait for a save.
  const allProblems = useMemo(
    () => changeOrderProblems(values, { lines, places }),
    [values, lines, places],
  )
  const problems = useMemo(() => (attempted ? allProblems : []), [attempted, allProblems])
  const fieldErrors = useMemo(() => problemsByField(problems), [problems])

  const problemFields = new Set(allProblems.map((problem) => problem.field))
  const hasLines = lines.length + places.length > 0
  const requestDone = !['builderId', 'community', 'title', 'requestedBy', 'internalNumber', 'neededByDate']
    .some((field) => problemFields.has(field))
  const whereDone = Boolean(job) && hasLines
  const chargedDone = whereDone && !problemFields.has('lines')

  useEffect(() => {
    if (failedSaves === 0) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    problemsRef.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [failedSaves])

  const handleChange = (changes) => {
    setSaveError('')
    if ('internalNumber' in changes) setNumberEdited(true)
    setValues((current) => ({ ...current, ...changes }))
  }

  const handleSave = async () => {
    setAttempted(true)
    if (changeOrderProblems(values, { lines, places }).length > 0) {
      setFailedSaves((count) => count + 1)
      return
    }

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
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
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
        subtitle={editing ? undefined : 'Extra work a builder asks for, priced lot by lot.'}
      />

      <Box
        sx={{
          flex: 1,
          p: { xs: 2.5, md: 4 },
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: editing
            ? 'minmax(0, 1fr)'
            : { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 300px' },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {!canEdit && (
            <Alert severity="info">{noPermission}</Alert>
          )}
          {saveError && <Alert severity="error">{saveError}</Alert>}
          {problems.length > 0 && (
            <Alert severity="error" aria-label="What to fix" ref={problemsRef} sx={{ scrollMarginTop: 16 }}>
              Fix this before saving:
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
                ))}
              </Box>
            </Alert>
          )}

          <ChangeOrderFormSection
            step={1}
            title="Request"
            hint="Who it is for and who asked for it."
            done={requestDone}
            attention={attempted && !requestDone}
          >
            <ChangeOrderBasicsCard
              values={shownValues}
              onChange={handleChange}
              errors={fieldErrors}
              canApprove={canApprove}
              numberPlaceholder={suggestedNumber}
              statusLocked={editing}
            />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            step={2}
            title="Where the work is"
            hint="The Job and the lots it reaches."
            done={whereDone}
            attention={attempted && !whereDone}
          >
            <ChangeOrderCoverageCard values={values} onChange={handleChange} errors={fieldErrors} />
          </ChangeOrderFormSection>

          <ChangeOrderFormSection
            step={3}
            title="What is charged"
            hint="The Scope of Work and the Amount of each line."
            done={chargedDone}
            attention={attempted && !chargedDone}
          >
            <ChangeOrderLinesCard values={values} onChange={handleChange} />
          </ChangeOrderFormSection>
        </Stack>

        {!editing && (
          <Box sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
            <RecentChangeOrdersCard />
          </Box>
        )}
      </Box>

      <ChangeOrderSaveBar
        amounts={amounts}
        problemCount={allProblems.length}
        attempted={attempted}
        saving={saving}
        canEdit={canEdit}
        noPermission={noPermission}
        saveLabel={saveLabel}
        onSave={handleSave}
        onCancel={() => navigate(editing ? detailPath : '/change-orders')}
      />
    </Box>
  )
}
