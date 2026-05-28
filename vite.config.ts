import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function promptLogPlugin(): Plugin {
  return {
    name: 'prompt-log-writer',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(server.config.root, 'prompt-logs')
      server.middlewares.use('/__prompt-log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', c => chunks.push(c as Buffer))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (!body) {
            res.statusCode = 400
            res.end()
            return
          }
          const d = new Date()
          const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          const file = resolve(dir, `${day}.jsonl`)
          mkdir(dir, { recursive: true })
            .then(() => appendFile(file, body.replace(/\n*$/, '') + '\n', 'utf8'))
            .then(() => { res.statusCode = 204; res.end() })
            .catch(err => {
              server.config.logger.error(`[prompt-log] ${err instanceof Error ? err.message : String(err)}`)
              res.statusCode = 500
              res.end()
            })
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), promptLogPlugin()],
  // Spotify OAuth requires 127.0.0.1 (not "localhost") for dev redirect URIs.
  server: { host: '127.0.0.1' },
})
