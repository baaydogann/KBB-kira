import { PrismaClient } from '@/generated/prisma'
import { seedVerisiniYukle } from './seed-veri'

const db = new PrismaClient()

seedVerisiniYukle(db)
  .then(() => console.log('Seed tamamlandı.'))
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
