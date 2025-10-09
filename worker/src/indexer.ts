import 'dotenv/config'
import pino from 'pino'
import { prisma, disconnectPrisma } from './prisma'

const log = pino({ level: process.env.LOG_LEVEL || 'info' })

async function main() {
  log.info('Indexer booting...')
  const [ping] = await prisma.$queryRaw<{ result: number }[]>`SELECT 1 AS result`
  log.info({ dbPing: ping?.result ?? 0 }, 'Database connectivity verified')
  // TODO: read cursor from DB
  // TODO: fetch RPC logs
  // TODO: upsert into DB
}

main()
  .catch((err) => {
    log.error({ err }, 'Indexer crashed')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectPrisma()
    log.debug('Prisma client disconnected')
  })
