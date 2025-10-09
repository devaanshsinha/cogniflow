import "dotenv/config";
import pino from "pino";
import { prisma, disconnectPrisma } from "../prisma";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const SUPPORTED_CHAINS: Record<string, { platform: string }> = {
  eth: { platform: "ethereum" },
};

const DEFAULT_CHAIN = process.env.PRICE_CHAIN ?? "eth";

function resolveBatchSize(): number {
  const raw = Number.parseInt(process.env.PRICE_BATCH_SIZE ?? "NaN", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (process.env.COINGECKO_API_KEY) {
    return 50;
  }
  return 1;
}

function truncateToHour(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const step = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    batches.push(items.slice(i, i + step));
  }
  return batches;
}

async function fetchPrices(
  chain: string,
  tokens: string[],
): Promise<Map<string, number>> {
  const chainConfig = SUPPORTED_CHAINS[chain];
  if (!chainConfig) {
    throw new Error(`Unsupported chain for price job: ${chain}`);
  }

  if (tokens.length === 0) {
    return new Map();
  }

  const url = new URL(
    `https://api.coingecko.com/api/v3/simple/token_price/${chainConfig.platform}`,
  );
  url.searchParams.set("contract_addresses", tokens.join(","));
  url.searchParams.set("vs_currencies", "usd");

  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `CoinGecko request failed (${response.status}): ${await response.text()}`,
    );
  }

  const json = (await response.json()) as Record<
    string,
    { usd?: number | null }
  >;
  const prices = new Map<string, number>();
  for (const [contract, value] of Object.entries(json)) {
    if (value && typeof value.usd === "number" && value.usd > 0) {
      prices.set(contract.toLowerCase(), value.usd);
    }
  }
  return prices;
}

async function main() {
  const targetChain = DEFAULT_CHAIN;
  const tokens = await prisma.transfer.findMany({
    where: { chain: targetChain },
    distinct: ["token"],
    select: { token: true },
  });

  const tokenAddresses = tokens
    .map((item) => item.token.toLowerCase())
    .filter((token) => token && token !== "0x0000000000000000000000000000000000000000");

  if (tokenAddresses.length === 0) {
    log.warn({ chain: targetChain }, "No tokens discovered for pricing");
    return;
  }

  log.info(
    { chain: targetChain, tokens: tokenAddresses.length },
    "Fetching token prices",
  );

  const timestamp = truncateToHour(new Date());
  let updates = 0;

  const batchSize = resolveBatchSize();

  for (const batch of chunk(tokenAddresses, batchSize)) {
    try {
      const prices = await fetchPrices(targetChain, batch);
      if (prices.size === 0) {
        continue;
      }

      await prisma.$transaction(
        Array.from(prices.entries()).map(([token, price]) =>
          prisma.priceSnapshot.upsert({
            where: {
              chain_token_timestamp: {
                chain: targetChain,
                token,
                timestamp,
              },
            },
            update: { usd: price },
            create: {
              chain: targetChain,
              token,
              timestamp,
              usd: price,
            },
          }),
        ),
      );
      updates += prices.size;
    } catch (error) {
      log.error(
        { err: error, chain: targetChain, batch: batch.length },
        "Failed to update prices for batch",
      );
    }
  }

  log.info({ chain: targetChain, updated: updates }, "Price job completed");
}

main()
  .catch((err) => {
    log.error({ err }, "Price job crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
