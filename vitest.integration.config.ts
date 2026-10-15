import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

// mode "test": Vite .env, .env.local, .env.test ve .env.test.local dosyalarını okur
// (sonraki dosya öncekini ezer); zaten tanımlı process.env değerleri dosyalardan üstündür.
// globalSetup aynı süreçte çalıştığı için değişkenler process.env'e de yazılır.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  return {
    resolve: { tsconfigPaths: true },
    test: {
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      globalSetup: ['tests/integration/global-setup.ts'],
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env,
    },
  }
})
