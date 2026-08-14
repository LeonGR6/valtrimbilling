import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sitesWorker = `const worker = {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request)

    if (response.status === 404 && ['GET', 'HEAD'].includes(request.method)) {
      const fallbackUrl = new URL('/index.html', request.url)
      response = await env.ASSETS.fetch(new Request(fallbackUrl, request))
    }

    if (response.headers.get('content-type')?.includes('text/html')) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store, max-age=0')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return response
  },
}

export default worker
`

function emitSitesWorker() {
  return {
    name: 'emit-sites-worker',
    apply: 'build',
    async closeBundle() {
      const serverDirectory = resolve(process.cwd(), 'dist/server')
      await mkdir(serverDirectory, { recursive: true })
      await writeFile(resolve(serverDirectory, 'index.js'), sitesWorker)
    },
  }
}

export default defineConfig({
  plugins: [react(), emitSitesWorker()],
  build: {
    outDir: 'dist/client',
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
