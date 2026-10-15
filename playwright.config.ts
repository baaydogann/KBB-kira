import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'

// mode "test": .env.test, .env'deki DATABASE_URL'i ezer; kabuktan gelen değişkenler dosyalardan üstündür
// (CI'da DATABASE_URL job değişkeniyle verilir). global-setup yalnızca *_test veritabanında çalışır.
const env = loadEnv('test', process.cwd(), '')
Object.assign(process.env, env)

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3100', locale: 'tr-TR', timezoneId: 'Europe/Istanbul', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm start -p 3100',
    url: 'http://localhost:3100/api/saglik',
    timeout: 300_000,
    reuseExistingServer: false,
    env: { ...env, NODE_ENV: 'production', APP_URL: 'http://localhost:3100' },
  },
})
