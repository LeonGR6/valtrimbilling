// Prints a PDF held in memory: it is loaded in a hidden frame and that frame's
// print dialog is opened. If the browser will not print from a frame, the PDF
// opens in a new tab instead, where its own viewer can print it.

const CLEANUP_MILLISECONDS = 5 * 60 * 1000

export function printPdfBytes(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'

  const cleanup = () => {
    frame.remove()
    URL.revokeObjectURL(url)
  }

  return new Promise((resolve) => {
    frame.onload = () => {
      try {
        frame.contentWindow.focus()
        frame.contentWindow.print()
      } catch {
        window.open(url, '_blank')
      }
      setTimeout(cleanup, CLEANUP_MILLISECONDS)
      resolve()
    }
    frame.src = url
    document.body.appendChild(frame)
  })
}
