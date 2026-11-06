/** Saves a Blob as a file with this name, as if the person had clicked a download link. */
export function saveToDisk(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Saves the bytes of a PDF as a file with this name. */
export function savePdfToDisk(bytes, fileName) {
  saveToDisk(new Blob([bytes], { type: 'application/pdf' }), fileName)
}
