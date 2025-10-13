import "dotenv/config";
import pino from "pino";
import { updatePrices } from "../../shared/jobs/updatePrices";
import { disconnectPrisma } from "../../shared/prisma";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function main() {
  log.info("Price job starting...");
  const result = await updatePrices({ logger: log });
  log.info(
    {
      chain: result.chain,
      processedTokens: result.processedTokens,
      updated: result.updated,
      timestamp: result.timestamp.toISOString(),
    },
    "Price job finished",
  );
}

main()
  .catch((err) => {
    log.error({ err }, "Price job crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
    log.debug("Prisma client disconnected");
  });
