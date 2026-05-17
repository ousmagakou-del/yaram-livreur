import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  build: {
    // ─── Perf : split les grosses libs dans des chunks separes ───
    // Vite 8 utilise Rolldown -> manualChunks DOIT etre une fonction.
    // Avantages :
    //  - le navigateur cache les vendors entre 2 deploys (longue duree)
    //  - le client lambda ne telecharge pas @zxing s'il n'ouvre pas le scan
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase'))     return 'vendor-supabase'
          if (id.includes('@zxing'))        return 'vendor-zxing'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react'
          }
        },
      },
    },
  },
})
