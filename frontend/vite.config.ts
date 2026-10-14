import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The board runs on http://localhost:5173 and calls the FastAPI backend on http://localhost:8000
// directly (see src/api.ts). strictPort keeps it on 5173, the origin the backend allows.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
