import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = resolve(frontendDirectory, '../..')
const buildDirectory = resolve(repositoryDirectory, 'dist')

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
      const serverDirectory = resolve(buildDirectory, 'server')
      await mkdir(serverDirectory, { recursive: true })
      await writeFile(resolve(serverDirectory, 'index.js'), sitesWorker)
    },
  }
}

export default defineConfig({
  plugins: [react(), emitSitesWorker()],
  resolve: {
    // FullCalendar view plugins must share the same core/preact runtime. This
    // workspace also uses Deno for Edge Functions, which can leave linked npm
    // packages under node_modules/.deno. Deduping prevents a linked time-grid
    // plugin from loading a second FullCalendar core at runtime.
    dedupe: [
      '@fullcalendar/core',
      '@fullcalendar/daygrid',
      '@fullcalendar/interaction',
      '@fullcalendar/list',
      '@fullcalendar/multimonth',
      '@fullcalendar/react',
      '@fullcalendar/timegrid',
    ],
  },
  build: {
    outDir: resolve(buildDirectory, 'client'),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
