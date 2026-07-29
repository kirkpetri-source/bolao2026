import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Identificador do build. Vai embutido no bundle e também num /version.json
// servido sem cache: é comparando os dois que a aba aberta há dias descobre
// que existe versão nova, em vez de seguir rodando código velho.
const BUILD_ID = new Date().toISOString()

function emiteVersao() {
  return {
    name: 'emite-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID }),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), emiteVersao()],
  root: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5056,
    host: true,
    open: true
  }
})
