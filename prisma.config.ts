import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// prisma.config.ts varken Prisma CLI .env dosyasını kendiliğinden yüklemez.
// Zaten tanımlı değişkenler (ör. testlerde .env.test'ten gelen DATABASE_URL) ezilmez.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
