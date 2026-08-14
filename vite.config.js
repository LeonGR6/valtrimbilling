import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sitesWorker = `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return response

    const fallbackUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
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
