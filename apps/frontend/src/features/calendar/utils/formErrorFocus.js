// Takes the person to the field or section a form error belongs to. A field says where it is with
// `data-error-key` (the key of the error, see calendarFormErrors.js) on the element that holds it;
// this finds that element inside `root`, scrolls it into view and puts the focus on it.

const FOCUSABLE = [
  'input:not([type="hidden"]):not([aria-hidden="true"])',
  'textarea',
  'select',
  '[role="combobox"]',
  'button:not([disabled])',
].join(', ')

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export function findErrorTarget(root, key) {
  if (!root || !key) return null

  const holder = [...root.querySelectorAll('[data-error-key]')]
    .find((element) => element.dataset.errorKey === key)
  if (!holder) return null

  // A section that takes the focus itself (the split schedule) has a tabindex; a field holds an
  // input, a select or a button inside.
  if (holder.hasAttribute('tabindex')) return holder
  return holder.querySelector(FOCUSABLE)
}

// Returns false when the field is not on screen (a field of another event while one is being
// edited), so the caller can fall back to something else.
export function focusFormError(root, key) {
  const target = findErrorTarget(root, key)
  if (!target) return false

  // A field is centered, so the message under it is in view with it. A section (the split
  // schedule) can be taller than the screen, and its message is at its top: it starts there.
  target.scrollIntoView({
    block: target.hasAttribute('tabindex') ? 'start' : 'center',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
  target.focus({ preventScroll: true })
  return true
}
