// Read-only view of one stored SPConnect message (Order or Change Order) as
// Hyphen sent it. Nothing here maps the message to our builders, Jobs or lots:
// that is step 5 of the implementation.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function cleanText(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // Hyphen sends some empty fields as the literal text "Null".
  if (!trimmed || trimmed.toLowerCase() === 'null') return null
  return trimmed
}

function readNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// Hyphen dates carry no time zone ("2026-11-25T00:00:00" in the header,
// "2/25/2026" on the Job). They are shown as calendar dates, never shifted by
// the browser's time zone.
export function formatHyphenDate(value) {
  const text = cleanText(value)
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${MONTHS[Number(iso[2]) - 1]} ${Number(iso[3])}, ${iso[1]}`

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (us) return `${MONTHS[Number(us[1]) - 1]} ${Number(us[2])}, ${us[3]}`

  return text
}

function optionDescriptions(header) {
  const descriptions = new Map()
  for (const option of header?.options ?? []) {
    const name = cleanText(option?.name)
    if (!name) continue
    const texts = (option.values ?? [])
      .map((value) => cleanText(value?.description))
      .filter(Boolean)
    descriptions.set(name, [...new Set(texts)].join(' · '))
  }
  return descriptions
}

export function listSpconnectOptions(payload) {
  return [...optionDescriptions(payload?.header)].map(([name, description]) => ({
    name,
    description,
  }))
}

export function listSpconnectLines(payload) {
  const descriptions = optionDescriptions(payload?.header)

  return (payload?.items ?? []).map((item, index) => ({
    key: cleanText(item?.builderLineItemNum) ?? `line-${index}`,
    lineNumber: cleanText(item?.builderLineItemNum),
    description: cleanText(item?.itemDescription),
    sku: cleanText(item?.builderSupplierSKU),
    quantity: readNumber(item?.builderTotalQuantity?.quantityOrdered),
    unit: cleanText(item?.builderTotalQuantity?.unitOfMeasurement),
    total: readNumber(item?.total),
    options: (item?.itemOptions ?? []).map((option) => {
      const name = cleanText(option?.optionName)
      return {
        name,
        description: (name && descriptions.get(name)) || null,
        locations: (option?.locations ?? []).map((location) => ({
          location: cleanText(location?.location),
          preferences: (location?.preferences ?? [])
            .map((preference) => {
              const label = cleanText(preference?.name)
              const value = cleanText(preference?.value)
              if (!value) return null
              return label ? `${label}: ${value}` : value
            })
            .filter(Boolean),
        })),
      }
    }),
  }))
}

function messageKind(row, header) {
  const kind = cleanText(row?.kind)?.toLowerCase().replace(/[\s_-]/g, '')
  if (kind === 'changeorder') return 'CHANGE_ORDER'
  if (kind === 'order') return 'ORDER'
  return header?.changeOrderNumber ? 'CHANGE_ORDER' : 'ORDER'
}

export function summarizeSpconnectMessage(row) {
  const payload = row?.payload ?? {}
  const header = payload.header ?? {}
  const job = header.job ?? {}

  return {
    id: String(row?.id ?? row?.message_id ?? `${row?.order_id}-${row?.received_at}`),
    receivedAt: row?.received_at ?? null,
    environment: cleanText(row?.environment),
    kind: messageKind(row, header),
    orderId: row?.order_id ?? header.id ?? null,
    poNumber: cleanText(row?.builder_order_number) ?? cleanText(header.builderOrderNumber),
    purpose: cleanText(row?.purpose) ?? cleanText(header.purpose),
    orderType: cleanText(header.orderType),
    changeOrderNumber: cleanText(String(row?.change_order_number ?? header.changeOrderNumber ?? '')),
    changeOrderSequence: row?.change_order_sequence ?? header.changeOrderSequence ?? null,
    changeType: cleanText(header.changeType),
    builderName: cleanText(header.builder?.address?.name),
    builderId: cleanText(header.builder?.id),
    supplierName: cleanText(header.supplier?.address?.name),
    accountNumber: cleanText(header.accountNumber),
    community: cleanText(job.subdivision),
    city: cleanText(job.city),
    phase: cleanText(job.phase),
    lot: cleanText(job.lot),
    block: cleanText(job.block),
    plan: cleanText(job.plan),
    elevation: cleanText(job.elevation),
    swing: cleanText(job.swing),
    address: cleanText(job.street),
    taskName: cleanText(header.task?.name),
    workStart: formatHyphenDate(header.startDate),
    workEnd: formatHyphenDate(header.endDate),
    issuedAt: formatHyphenDate(header.issueDate),
    orderTotal: readNumber(payload.summary?.orderTotal),
    lineCount: readNumber(payload.summary?.numberOfLines) ?? (payload.items ?? []).length,
  }
}

export function matchesSpconnectSearch(summary, search) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [
    summary.orderId,
    summary.poNumber,
    summary.builderName,
    summary.community,
    summary.lot,
    summary.plan,
    summary.changeOrderNumber,
  ].some((value) => value !== null && String(value).toLowerCase().includes(needle))
}
