import { useCallback, useMemo, useState } from 'react'
import {
  applyPastedCells,
  createBulkRow,
  createExistingRows,
  evaluateBulkChanges,
  isBlankRow,
  revertedRow,
  withTrailingBlankRow,
} from '../utils/bulkPlanOptions.js'

const STARTING_ROWS = 6

function differsFromOriginal(row) {
  return Object.entries(row.original).some(([column, value]) => row[column] !== value)
}

/**
 * The bulk mode of Plans & Options: the Job's Plans and Options as rows to edit, the rows ticked and
 * the ones marked for deletion, the rows added below, and what saving would do. Nothing is saved
 * until the person does; leaving the mode drops it all.
 */
export default function useBulkPlanOptions(plans) {
  const [existing, setExisting] = useState(() => createExistingRows(plans))
  const [added, setAdded] = useState(() => Array.from({ length: STARTING_ROWS }, () => createBulkRow()))
  const [deleted, setDeleted] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const evaluation = useMemo(
    () => evaluateBulkChanges({ existing, added, deleted }),
    [existing, added, deleted],
  )

  const setExistingCell = useCallback((rowId, column, value) => {
    setExisting((current) => current.map((row) => (row.id === rowId ? { ...row, [column]: value } : row)))
  }, [])
  const setAddedCell = useCallback((rowId, column, value) => {
    setAdded((current) => withTrailingBlankRow(current.map((row) => (
      row.id === rowId ? { ...row, [column]: value } : row
    ))))
  }, [])
  const removeAddedRow = useCallback((rowId) => {
    setAdded((current) => withTrailingBlankRow(current.filter((row) => row.id !== rowId)))
  }, [])
  const pasteAdded = useCallback((rowIndex, columnIndex, matrix) => {
    setAdded((current) => applyPastedCells(current, rowIndex, columnIndex, matrix))
  }, [])

  const toggleSelected = useCallback((rowId) => {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(rowId)) next.add(rowId)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const deleteSelected = useCallback(() => {
    setDeleted((current) => new Set([...current, ...selected]))
    setSelected(new Set())
  }, [selected])
  // Puts a row back as it was: not deleted, and with what it had before it was edited.
  const restoreRow = useCallback((rowId) => {
    setDeleted((current) => {
      const next = new Set(current)
      next.delete(rowId)
      return next
    })
    setSelected((current) => {
      const next = new Set(current)
      next.delete(rowId)
      return next
    })
    setExisting((current) => current.map((row) => (row.id === rowId ? revertedRow(row) : row)))
  }, [])

  return {
    existing,
    added,
    deleted,
    selected,
    evaluation,
    setExistingCell,
    setAddedCell,
    removeAddedRow,
    pasteAdded,
    toggleSelected,
    clearSelection,
    deleteSelected,
    restoreRow,
    hasContent: deleted.size > 0
      || existing.some(differsFromOriginal)
      || added.some((row) => !isBlankRow(row)),
  }
}
