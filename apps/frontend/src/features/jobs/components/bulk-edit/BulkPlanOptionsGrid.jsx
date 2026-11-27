import { memo, useCallback, useRef } from 'react'
import { styled } from '@mui/material/styles'
import {
  BULK_COLUMNS,
  MAX_OPTION_CODE,
  MAX_OPTION_DESCRIPTION,
  MAX_PLAN_CODE,
  MAX_PLAN_NAME,
  isBlankRow,
  parseSpreadsheetText,
} from '../../utils/bulkPlanOptions.js'

const COLUMN_LABELS = {
  plan: 'Plan',
  code: 'OPT #',
  description: 'Description',
  planName: 'Plan name',
}
const MAX_LENGTH = {
  plan: MAX_PLAN_CODE,
  code: MAX_OPTION_CODE,
  description: MAX_OPTION_DESCRIPTION,
  planName: MAX_PLAN_NAME,
}
const COLUMN_WIDTHS = { plan: 150, code: 150, planName: 210 }
const COLUMN_COUNT = 7

// The grid can hold hundreds of rows, each with several cells: they are plain elements styled once
// here, not a component with its own styles per cell, so opening it or pasting a whole sheet stays
// quick.
const GridRoot = styled('div')(({ theme }) => ({
  overflowX: 'auto',
  '& table': {
    width: '100%',
    minWidth: 920,
    borderCollapse: 'collapse',
    fontSize: 14,
    tableLayout: 'fixed',
  },
  '& th': {
    padding: theme.spacing(0.75, 1.5),
    textAlign: 'left',
    fontWeight: 750,
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.action.hover,
  },
  '& th .bulk-optional': {
    marginLeft: theme.spacing(0.75),
    fontSize: 12,
    fontWeight: 400,
    color: theme.palette.text.disabled,
  },
  '& td': {
    padding: theme.spacing(0.25, 0.5),
    verticalAlign: 'middle',
  },
  '& tbody tr': { borderBottom: `1px solid ${theme.palette.divider}` },
  '& tbody tr:hover': { backgroundColor: theme.palette.action.hover },
  '& td:first-of-type': { borderLeft: '4px solid transparent' },
  '& tr.bulk-error td:first-of-type': { borderLeftColor: theme.palette.error.main },
  '& tr.bulk-edited td:first-of-type': { borderLeftColor: theme.palette.warning.main },
  '& tr.bulk-plan': {
    backgroundColor: theme.palette.action.hover,
    borderTop: `2px solid ${theme.palette.divider}`,
  },
  '& tbody tr.bulk-plan:first-of-type': { borderTop: 0 },
  '& tr.bulk-starts td': { borderTop: `2px solid ${theme.palette.divider}` },
  '& tr.bulk-deleted input.bulk-cell': {
    textDecoration: 'line-through',
    opacity: 0.55,
  },
  '& tr.bulk-deleted td.bulk-inherited': { opacity: 0.4 },
  '& tr.bulk-section': { backgroundColor: 'transparent' },
  '& tr.bulk-section td': {
    padding: theme.spacing(1.5, 2),
    color: theme.palette.text.secondary,
    fontSize: 13,
    fontWeight: 700,
    borderLeft: 0,
    borderTop: `2px solid ${theme.palette.divider}`,
  },
  '& tr.bulk-section td span': { fontWeight: 400, marginLeft: theme.spacing(1) },
  '& .bulk-number': {
    textAlign: 'right',
    color: theme.palette.text.disabled,
    fontVariantNumeric: 'tabular-nums',
  },
  '& .bulk-set-apart': {
    borderLeft: `1px solid ${theme.palette.divider}`,
    paddingLeft: theme.spacing(1.5),
  },
  '& td.bulk-check-cell': { textAlign: 'center' },
  '& input.bulk-check': { width: 16, height: 16, cursor: 'pointer', accentColor: theme.palette.primary.main },
  '& input.bulk-check:disabled': { cursor: 'not-allowed' },
  '& .bulk-muted': { color: theme.palette.text.secondary, fontSize: 13, padding: theme.spacing(0, 1) },
  '& td.bulk-inherited': { color: theme.palette.text.primary, fontWeight: 600, fontSize: 13 },
  '& td.bulk-inherited span': { opacity: 0.4, padding: theme.spacing(0, 1) },
  '& input.bulk-cell': {
    width: '100%',
    boxSizing: 'border-box',
    padding: theme.spacing(0.75, 1),
    border: 0,
    borderRadius: theme.shape.borderRadius,
    background: 'transparent',
    color: theme.palette.text.primary,
    font: 'inherit',
    outline: 0,
  },
  '& input.bulk-cell--plan': { fontWeight: 800 },
  '& input.bulk-cell::placeholder': {
    color: theme.palette.text.primary,
    opacity: 0.4,
    fontWeight: 400,
  },
  // A blank Plan cell shows the Plan it takes from above, a little faded.
  '& input.bulk-cell--inherits::placeholder': { opacity: 0.55, fontWeight: 600 },
  '& input.bulk-cell:focus': {
    backgroundColor: theme.palette.action.hover,
    boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
  },
  '& input.bulk-cell:disabled': { cursor: 'default' },
  '& .bulk-result': {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    fontSize: 12,
    lineHeight: 1.4,
    color: theme.palette.text.secondary,
  },
  '& .bulk-result svg': { width: 16, height: 16, flexShrink: 0, fill: 'currentColor' },
  '& .bulk-result--error': { color: theme.palette.error.main, alignItems: 'flex-start' },
  '& .bulk-result--ok': { color: theme.palette.success.main },
  '& .bulk-result--edit': { color: theme.palette.warning.main },
  '& .bulk-result--delete': { color: theme.palette.error.main },
  '& .bulk-tag': {
    padding: '0 8px',
    borderRadius: 10,
    border: `1px solid ${theme.palette.primary.main}`,
    color: theme.palette.primary.main,
    lineHeight: '18px',
    whiteSpace: 'nowrap',
  },
  '& button.bulk-icon': {
    width: 28,
    height: 28,
    padding: 0,
    display: 'grid',
    placeItems: 'center',
    border: 0,
    borderRadius: '50%',
    background: 'transparent',
    color: theme.palette.text.secondary,
    cursor: 'pointer',
    opacity: 0,
  },
  '& button.bulk-icon svg': { width: 18, height: 18, fill: 'currentColor' },
  '& tr:hover button.bulk-icon, & tr:focus-within button.bulk-icon, & button.bulk-icon:focus-visible, & button.bulk-icon--always': {
    opacity: 1,
  },
  '& button.bulk-icon:hover': { backgroundColor: theme.palette.action.selected },
  '& button.bulk-icon:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
  [theme.breakpoints.down('md')]: {
    '& button.bulk-icon': { opacity: 1 },
  },
}))

const svg = (path) => function Icon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
}
const CheckIcon = svg('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z')
const ErrorIcon = svg('M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z')
const CloseIcon = svg('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z')
const UndoIcon = svg('M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z')
const LockIcon = svg('M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z')

function usedText(count) {
  return `Used by ${count} ${count === 1 ? 'lot' : 'lots'}`
}

function ExistingResult({ result, usedBy }) {
  if (result.status === 'error') {
    return (
      <div className="bulk-result bulk-result--error" role="alert">
        <ErrorIcon />
        <span>{result.message}</span>
      </div>
    )
  }
  if (result.status === 'edited') {
    return (
      <div className="bulk-result bulk-result--edit">
        <span>Edited</span>
        {result.was && <span className="bulk-muted" style={{ padding: 0 }}>was {result.was}</span>}
      </div>
    )
  }
  if (result.status === 'delete') return <div className="bulk-result bulk-result--delete">Will be deleted</div>
  if (result.status === 'delete-with-plan') return <div className="bulk-result">Deleted with its Plan</div>
  if (usedBy > 0) {
    return <div className="bulk-result"><LockIcon />{usedText(usedBy)}</div>
  }
  return null
}

function AddedResult({ result }) {
  if (result.status === 'empty') return null

  if (result.status === 'error') {
    return (
      <div className="bulk-result bulk-result--error" role="alert">
        <ErrorIcon />
        <span>{result.message}</span>
      </div>
    )
  }
  if (result.status === 'skip') return <div className="bulk-result">Already there, skipped</div>

  return (
    <div className="bulk-result">
      {result.creates && <span className="bulk-tag">New plan</span>}
      {result.status === 'option' ? (
        <span className="bulk-result bulk-result--ok"><CheckIcon />New option</span>
      ) : !result.creates ? (
        <span>Plan already in the Job</span>
      ) : null}
    </div>
  )
}

function CellInput({ column, value, rowIndex, label, onChange, onKeyDown, onPaste, disabled, placeholder, invalid, inherits }) {
  return (
    <input
      className={`bulk-cell bulk-cell--${column}${inherits ? ' bulk-cell--inherits' : ''}`}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-cell={`${rowIndex}:${BULK_COLUMNS.indexOf(column)}`}
      // A little over the limit, so a long value shows its error instead of being cut.
      maxLength={MAX_LENGTH[column] + 20}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      onKeyDown={(event) => onKeyDown(event, rowIndex, BULK_COLUMNS.indexOf(column))}
      onPaste={onPaste ? (event) => onPaste(event, rowIndex, BULK_COLUMNS.indexOf(column)) : undefined}
    />
  )
}

const sameResult = (previous, next) => (
  previous.status === next.status && previous.message === next.message && previous.was === next.was
  && previous.planCode === next.planCode && previous.creates === next.creates
)

// A Plan of the Job (its code and name), then its Options, then the rows added.
const ExistingRow = memo(function ExistingRow({
  row, result, index, planCode, selected, usedBy, onChange, onToggle, onRestore, onKeyDown,
}) {
  const isPlan = row.kind === 'plan'
  const removed = result.status === 'delete' || result.status === 'delete-with-plan'
  const hasError = result.status === 'error'
  const className = [
    isPlan ? 'bulk-plan' : '',
    removed ? 'bulk-deleted' : '',
    hasError ? 'bulk-error' : '',
    result.status === 'edited' ? 'bulk-edited' : '',
  ].filter(Boolean).join(' ')
  const subject = isPlan ? `Plan ${row.original.plan}` : `option ${row.original.code} of Plan ${planCode}`
  const canRestore = result.status === 'edited' || result.status === 'error' || result.status === 'delete'
  const locked = usedBy > 0

  return (
    <tr className={className}>
      <td className="bulk-check-cell" style={{ width: 44 }}>
        <input
          type="checkbox"
          className="bulk-check"
          checked={selected}
          disabled={locked || removed}
          onChange={() => onToggle(row.id)}
          aria-label={`Select ${subject}`}
          title={locked ? `${usedText(usedBy)}: it cannot be deleted` : undefined}
        />
      </td>
      {isPlan ? (
        <>
          <td>
            <CellInput
              column="plan"
              value={row.plan}
              rowIndex={index}
              label={`Plan code of ${subject}`}
              invalid={hasError}
              disabled={removed}
              onChange={(event) => onChange(row.id, 'plan', event.target.value)}
              onKeyDown={onKeyDown}
            />
          </td>
          <td />
          <td><span className="bulk-muted">{row.optionCount} {row.optionCount === 1 ? 'option' : 'options'}</span></td>
          <td className="bulk-set-apart">
            <CellInput
              column="planName"
              value={row.planName}
              rowIndex={index}
              label={`Plan name of ${subject}`}
              invalid={hasError}
              disabled={removed}
              onChange={(event) => onChange(row.id, 'planName', event.target.value)}
              onKeyDown={onKeyDown}
            />
          </td>
        </>
      ) : (
        <>
          <td className="bulk-inherited"><span>{planCode}</span></td>
          <td>
            <CellInput
              column="code"
              value={row.code}
              rowIndex={index}
              label={`OPT # of ${subject}`}
              invalid={hasError}
              disabled={removed}
              onChange={(event) => onChange(row.id, 'code', event.target.value)}
              onKeyDown={onKeyDown}
            />
          </td>
          <td>
            <CellInput
              column="description"
              value={row.description}
              rowIndex={index}
              label={`Description of ${subject}`}
              invalid={hasError}
              disabled={removed}
              onChange={(event) => onChange(row.id, 'description', event.target.value)}
              onKeyDown={onKeyDown}
            />
          </td>
          <td className="bulk-set-apart" />
        </>
      )}
      <td style={{ width: 210 }}><ExistingResult result={result} usedBy={usedBy} /></td>
      <td style={{ width: 40 }}>
        {canRestore && (
          <button
            type="button"
            className="bulk-icon"
            aria-label={result.status === 'delete' ? `Keep ${subject}` : `Undo changes to ${subject}`}
            title={result.status === 'delete' ? 'Keep it' : 'Undo changes'}
            onClick={() => onRestore(row.id)}
          >
            <UndoIcon />
          </button>
        )}
      </td>
    </tr>
  )
}, (previous, next) => (
  previous.row === next.row
  && previous.index === next.index
  && previous.planCode === next.planCode
  && previous.selected === next.selected
  && previous.usedBy === next.usedBy
  && sameResult(previous.result, next.result)
))

const AddedRow = memo(function AddedRow({
  row, result, index, number, startsPlan, onChange, onRemove, onKeyDown, onPaste,
}) {
  const hasError = result.status === 'error'
  const inheritsPlan = row.plan.trim() === '' && result.planCode !== ''
  const className = [
    startsPlan ? 'bulk-starts' : '',
    hasError ? 'bulk-error' : '',
  ].filter(Boolean).join(' ')

  return (
    <tr className={className}>
      <td className="bulk-number" style={{ width: 44 }}>{number}</td>
      {BULK_COLUMNS.map((column) => (
        <td key={column} className={column === 'planName' ? 'bulk-set-apart' : undefined}>
          <CellInput
            column={column}
            value={row[column]}
            rowIndex={index}
            label={`${COLUMN_LABELS[column]}, new row ${number}`}
            invalid={hasError}
            inherits={column === 'plan' && inheritsPlan}
            placeholder={column === 'plan' ? (inheritsPlan ? result.planCode : 'Plan') : ''}
            onChange={(event) => onChange(row.id, column, event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </td>
      ))}
      <td style={{ width: 210 }}><AddedResult result={result} /></td>
      <td style={{ width: 40 }}>
        {!isBlankRow(row) && (
          <button
            type="button"
            className="bulk-icon"
            aria-label={`Remove new row ${number}`}
            onClick={() => onRemove(row.id)}
          >
            <CloseIcon />
          </button>
        )}
      </td>
    </tr>
  )
}, (previous, next) => (
  previous.row === next.row
  && previous.index === next.index
  && previous.number === next.number
  && previous.startsPlan === next.startsPlan
  && sameResult(previous.result, next.result)
))

/**
 * The grid of Plans & options: what the Job has, to edit or tick for deletion, and below it the rows
 * to add, typed or pasted from a spreadsheet. Enter and the arrow keys move through a column; a
 * Plan left blank in an added row takes the Plan above. `bulk` is useBulkPlanOptions and `usage`
 * says how many Lots use each Plan and Option (those cannot be deleted).
 */
export default function BulkPlanOptionsGrid({ bulk, usage }) {
  const {
    existing, added, evaluation, selected,
    setExistingCell, setAddedCell, removeAddedRow, pasteAdded, toggleSelected, restoreRow,
  } = bulk
  const containerRef = useRef(null)
  const totalRows = existing.length + added.length

  const handleKeyDown = useCallback((event, rowIndex, columnIndex) => {
    const step = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)
      ? -1
      : event.key === 'ArrowDown' || event.key === 'Enter' ? 1 : 0
    if (step === 0) return

    event.preventDefault()
    // Rows that have no cell in this column (a Plan has no OPT #) are passed over.
    for (let target = rowIndex + step; target >= 0 && target < totalRows; target += step) {
      const input = containerRef.current?.querySelector(`input[data-cell="${target}:${columnIndex}"]:not(:disabled)`)
      if (input) {
        input.focus()
        input.select()
        return
      }
    }
  }, [totalRows])

  const handlePaste = useCallback((event, rowIndex, columnIndex) => {
    const matrix = parseSpreadsheetText(event.clipboardData?.getData('text'))
    // One cell pastes as text, as usual; several are spread over the rows being added.
    if (matrix.length === 0 || (matrix.length === 1 && matrix[0].length === 1)) return

    event.preventDefault()
    pasteAdded(rowIndex - existing.length, columnIndex, matrix)
  }, [existing.length, pasteAdded])

  const planCodes = new Map(existing.filter((row) => row.kind === 'plan').map((row) => [row.planId, row.plan]))

  return (
    <GridRoot ref={containerRef} data-bulk-grid>
      <table aria-label="Plans and options">
        <thead>
          <tr>
            <th style={{ width: 44 }} />
            {BULK_COLUMNS.map((column) => (
              <th
                key={column}
                className={column === 'planName' ? 'bulk-set-apart' : undefined}
                style={COLUMN_WIDTHS[column] ? { width: COLUMN_WIDTHS[column] } : undefined}
              >
                {COLUMN_LABELS[column]}
                {column === 'planName' && <span className="bulk-optional">optional</span>}
              </th>
            ))}
            <th style={{ width: 210 }}>Result</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {existing.map((row, index) => {
            const usedBy = (row.kind === 'plan' ? usage.plans.get(row.planId) : usage.options.get(row.optionId)) ?? 0
            return (
              <ExistingRow
                key={row.id}
                row={row}
                result={evaluation.existing.get(row.id)}
                index={index}
                planCode={planCodes.get(row.planId) ?? ''}
                selected={selected.has(row.id)}
                usedBy={usedBy}
                onChange={setExistingCell}
                onToggle={toggleSelected}
                onRestore={restoreRow}
                onKeyDown={handleKeyDown}
              />
            )
          })}
          <tr className="bulk-section">
            <td colSpan={COLUMN_COUNT}>
              New rows
              <span>Type or paste Plan, OPT # and Description. Leave the Plan blank to keep the one above.</span>
            </td>
          </tr>
          {added.map((row, addedIndex) => {
            const result = evaluation.added[addedIndex]
            const previous = evaluation.added[addedIndex - 1]
            return (
              <AddedRow
                key={row.id}
                row={row}
                result={result}
                index={existing.length + addedIndex}
                number={addedIndex + 1}
                startsPlan={result.status !== 'empty' && addedIndex > 0 && previous?.planCode !== result.planCode}
                onChange={setAddedCell}
                onRemove={removeAddedRow}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
              />
            )
          })}
        </tbody>
      </table>
    </GridRoot>
  )
}
