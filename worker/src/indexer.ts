import 'dotenv/config'
import pino from 'pino'

const log = pino({ level: process.env.LOG_LEVEL || 'info' })

async function main() {
  log.info('Indexer booting...')
  // TODO: read cursor from DB
  // TODO: fetch RPC logs
  // TODO: upsert into DB
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
