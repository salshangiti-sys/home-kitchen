/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite build --mode pages` builds for GitHub Pages, where the app lives under /home-kitchen/
// (https://salshangiti-sys.github.io/home-kitchen/). Everywhere else it is served from the root.
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/home-kitchen/' : '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
  },
}))
