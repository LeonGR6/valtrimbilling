import { requireSupabase } from '../../../services/api.js'
import {
  extractOriginalValtrimEmailSentDate,
  normalizeCustomerServicePdfExtraction,
} from '../utils/pdfExtraction.js'

const FUNCTION_NAME = 'extract-customer-service-pdf'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }

  return error?.message || 'The source extraction failed.'
}

export async function extractCustomerServicePdf(file) {
  const client = await requireSupabase()
  const body = new FormData()
  body.set('file', file, file.name)

  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  return normalizeCustomerServicePdfExtraction(data)
}

export async function extractCustomerServiceEmailText({ text, from = '', subject = '' }) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
    body: {
      sourceType: 'EMAIL_TEXT',
      text,
      from: from || null,
      subject: subject || null,
    },
  })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  const extraction = normalizeCustomerServicePdfExtraction(data)
  const sourceEmailSentDate = extractOriginalValtrimEmailSentDate(text)
  if (!sourceEmailSentDate) return extraction

  return {
    ...extraction,
    structuredData: {
      ...extraction.structuredData,
      document: {
        ...extraction.structuredData.document,
        sourceEmailSentDate,
      },
    },
  }
}
