import "dotenv/config";
import pino from "pino";
import { updateEmbeddings } from "../../shared/jobs/updateEmbeddings";
import { disconnectPrisma } from "../../shared/prisma";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function main() {
  log.info("Embedding job starting...");
  const result = await updateEmbeddings({ logger: log });
  log.info(
    {
      chain: result.chain,
      processed: result.processed,
      batches: result.batches,
    },
    "Embedding job finished",
  );
}

main()
  .catch((err) => {
    log.error({ err }, "Embedding job crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
    log.debug("Prisma client disconnected");
  });
