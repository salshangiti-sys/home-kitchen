import { defineConfig, devices } from '@playwright/test'

// End-to-end smoke test: the app as built for GitHub Pages, opened in a real browser at phone
// size. It needs no Supabase project and never signs in: the two VITE_ values only have to exist
// for the app to start. Run it with `npm run e2e` after `npx vite build --mode pages`.
const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}/home-kitchen/`, ...devices['Pixel 7'], locale: 'ar' },
  webServer: {
    command: `npx vite preview --mode pages --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/home-kitchen/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
