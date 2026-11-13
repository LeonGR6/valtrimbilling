// What opening a Release template needs before it can be shown: a usable
// template (analyzed now unless one already exists) and the PDF itself.
// Collaborators are passed in so this stays free of network code and testable.

export const REUSABLE_STATUSES = ['needs_review', 'confirmed', 'superseded']

export async function loadTemplateAndPdf({
  document,
  template,
  analyze,
  download,
  onStep = () => {},
}) {
  const reusable = Boolean(template) && REUSABLE_STATUSES.includes(template.status)
  const current = reusable ? template : await analyze(document, {})

  onStep('loading-pdf')
  const file = await download(document)
  return { template: current, file }
}
