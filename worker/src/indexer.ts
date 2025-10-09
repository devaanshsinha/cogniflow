import "dotenv/config";
import pino from "pino";
import { prisma, disconnectPrisma } from "./prisma";
import { syncWalletTransfers } from "./ingestion/syncWalletTransfers";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function main() {
  log.info("Indexer booting...");
  const [ping] =
    await prisma.$queryRaw<{ result: number }[]>`SELECT 1 AS result`;
  log.info({ dbPing: ping?.result ?? 0 }, "Database connectivity verified");

  const targetChain = process.env.ETH_CHAIN ?? "eth";
  const wallets = await prisma.wallet.findMany({
    where: { chain: targetChain },
  });

  if (wallets.length === 0) {
    log.warn({ chain: targetChain }, "No wallets registered for ingestion");
    return;
  }

  for (const wallet of wallets) {
    const childLog = log.child({ wallet: wallet.address, chain: wallet.chain });
    try {
      await syncWalletTransfers(wallet, childLog);
    } catch (error) {
      childLog.error({ err: error }, "Failed to sync wallet");
    }
  }
}

main()
  .catch((err) => {
    log.error({ err }, "Indexer crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
    log.debug("Prisma client disconnected");
  });
