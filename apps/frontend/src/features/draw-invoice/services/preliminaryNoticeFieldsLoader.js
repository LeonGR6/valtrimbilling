import { pdfjs } from 'react-pdf'
import '../../release-templates/components/pdfWorker.js'
import { detectFieldsInPage } from './preliminaryNoticeFields.js'

/** The blanks and check boxes of every page of a Preliminary Notice PDF. */
export async function detectNoticeFields(pdfBytes) {
  // pdf.js may detach the buffer it receives, so it gets a copy.
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    isEvalSupported: false,
  })
  const document = await loadingTask.promise

  try {
    const fields = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const [operatorList, content] = await Promise.all([
        page.getOperatorList(),
        page.getTextContent(),
      ])
      fields.push(...detectFieldsInPage({
        page: number,
        operatorList,
        OPS: pdfjs.OPS,
        viewport: page.getViewport({ scale: 1 }),
        textItems: content.items,
      }))
    }
    return fields
  } finally {
    await loadingTask.destroy()
  }
}
