import { defineConfig } from '@playwright/test'

// Runs against a dev hub: ./bin/rfs-hub -addr 127.0.0.1:7430 -dev-email dev@local
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:7430', viewport: { width: 1280, height: 800 } },
  reporter: [['list']],
})
