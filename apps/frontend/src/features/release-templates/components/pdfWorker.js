import { pdfjs } from 'react-pdf'

// The PDF is parsed in a worker so large pages never block the screen. Vite
// bundles the worker that ships with the pdfjs-dist version react-pdf uses.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()
