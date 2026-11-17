/** "1 option" or "2 options": the count with the singular or the plural form ("s" added by default). */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
