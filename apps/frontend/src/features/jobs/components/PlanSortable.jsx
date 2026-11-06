import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconButton } from '@mui/material'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'

// The preview is smaller than the Plan it stands for (the Plans collapse as soon
// as a drag starts), so it is placed from the pointer instead of keeping the
// offset the pointer had inside the original: its grip sits under the pointer
// and it never leaves the window. Folding the list can also shorten the page
// and move the scroll, so the live pointer position is used rather than the
// drag distance.
// The Plans change height when a drag starts, so the dragged Plan's own box is
// out of date; the pointer decides where it lands (the keyboard uses the box).
function collisionByPointer(args) {
  if (!args.pointerCoordinates) return closestCenter(args)

  const within = pointerWithin(args)
  return within.length > 0 ? within : closestCenter(args)
}

const PREVIEW_GRIP_OFFSET = 22
const PREVIEW_MARGIN = 8

function previewTransform({ pointer, draggingNodeRect, overlayNodeRect, transform }) {
  if (!pointer || !draggingNodeRect) return transform

  const width = overlayNodeRect?.width ?? 0
  const height = overlayNodeRect?.height ?? 0
  const left = Math.min(
    Math.max(pointer.x - PREVIEW_GRIP_OFFSET, PREVIEW_MARGIN),
    Math.max(window.innerWidth - width - PREVIEW_MARGIN, PREVIEW_MARGIN),
  )

  return {
    ...transform,
    x: left - draggingNodeRect.left,
    y: pointer.y - height / 2 - draggingNodeRect.top,
  }
}

/**
 * Lets the Plans of a Job be dragged into a new order by their handle (mouse,
 * touch or keyboard). `onReorder` receives the Plan ids in the new order and
 * the id of the Plan that was moved.
 * `onDragChange(planId | null)` tells when a drag starts and ends, and
 * `renderPreview(plan)` draws what follows the pointer meanwhile.
 */
export function PlanSortableList({
  plans,
  onReorder,
  onDragChange,
  renderPreview,
  children,
  contextId,
}) {
  const [activeId, setActiveId] = useState(null)
  // Where the pointer is while a drag started with one (null for the keyboard).
  const pointer = useRef(null)
  const activePlan = plans.find(({ id }) => id === activeId) ?? null
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (activeId === null) return undefined

    const follow = (event) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    // Capture, so it is up to date before the drag library moves the preview.
    window.addEventListener('pointermove', follow, true)
    return () => window.removeEventListener('pointermove', follow, true)
  }, [activeId])

  const previewModifier = useCallback((args) => previewTransform({
    ...args,
    pointer: pointer.current,
  }), [])

  const finish = () => {
    setActiveId(null)
    onDragChange?.(null)
  }

  const handleDragStart = ({ active, activatorEvent }) => {
    pointer.current = activatorEvent && 'clientX' in activatorEvent
      ? { x: activatorEvent.clientX, y: activatorEvent.clientY }
      : null
    setActiveId(active.id)
    // Only a drag with the pointer folds the list: the keyboard moves the Plan
    // by its own box, which has to stay where the library measured it.
    if (pointer.current) onDragChange?.(active.id)
  }

  const handleDragEnd = ({ active, over }) => {
    finish()
    if (!over || active.id === over.id) return

    const ids = plans.map(({ id }) => id)
    const from = ids.indexOf(active.id)
    const to = ids.indexOf(over.id)
    if (from < 0 || to < 0) return

    onReorder(arrayMove(ids, from, to), active.id)
  }

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={collisionByPointer}
      // The Plans change height when a drag starts, so their places are measured again.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={finish}
    >
      <SortableContext
        items={plans.map(({ id }) => id)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
      {renderPreview && createPortal(
        // No drop animation: the library would restore the Plan's inline styles from
        // before the drop (dimmed, and moved) once it ended and leave them stuck.
        <DragOverlay
          modifiers={[previewModifier]}
          dropAnimation={null}
          style={{ width: 'auto', height: 'auto' }}
        >
          {activePlan ? renderPreview(activePlan) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

/**
 * One draggable Plan. `children` gets the props for the element that moves
 * (`rootProps`, to spread on it) and the handle to render inside it.
 */
export function SortablePlan({ plan, disabled = false, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plan.id, disabled })

  const rootProps = {
    ref: setNodeRef,
    'data-plan-id': plan.id,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
      // The preview follows the pointer; the Plan itself marks where it will land.
      opacity: isDragging ? 0.35 : undefined,
    },
  }

  const handle = disabled ? null : (
    <IconButton
      ref={setActivatorNodeRef}
      size="small"
      aria-label={`Move Plan ${plan.code}. Drag it, or press space and use the arrow keys.`}
      title="Drag to reorder"
      {...attributes}
      {...listeners}
      sx={{
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        color: 'text.secondary',
      }}
    >
      <DragIndicatorRoundedIcon fontSize="small" />
    </IconButton>
  )

  return children({ rootProps, handle })
}
