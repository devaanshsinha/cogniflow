import type { Wallet } from "@prisma/client";
import { prisma } from "../prisma";
import {
  getAssetTransfersForWallet,
  getBlockByNumber,
  getLatestBlockNumber,
  getLookbackBlocks,
  type AlchemyAssetTransfer,
} from "../clients/alchemy";
import { ensureLogger, type Logger } from "../logger";

type NormalizedTransfer = {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: Date;
  token: string;
  symbol: string | null;
  decimals: number | null;
  from: string;
  to: string;
  amountRaw: string;
  amountDec: string;
  chain: string;
};

const MAX_DECIMALS_STORED = 18;

export type SyncWalletOptions = {
  lookbackBlocks?: number;
  maxPages?: number;
  skipBlockMetadata?: boolean;
  skipIfSyncedWithinMs?: number;
  maxBlockSpan?: number;
};

export type SyncWalletResult = {
  walletId: string;
  address: string;
  fromBlock: number;
  toBlock: number;
  latestBlock: number;
  transfersProcessed: number;
  hasMore: boolean;
};

export async function syncWalletTransfers(
  wallet: Wallet,
  logger?: Logger,
  options: SyncWalletOptions = {},
): Promise<SyncWalletResult> {
  const log = ensureLogger(logger);

  const lastSyncedAt =
    wallet.lastSyncedAt instanceof Date
      ? wallet.lastSyncedAt
      : wallet.lastSyncedAt
        ? new Date(wallet.lastSyncedAt)
        : null;

  if (
    options.skipIfSyncedWithinMs &&
    lastSyncedAt &&
    Number.isFinite(options.skipIfSyncedWithinMs) &&
    Date.now() - lastSyncedAt.getTime() < options.skipIfSyncedWithinMs
  ) {
    log.info(
      {
        address: wallet.address,
        lastSyncedAt: lastSyncedAt.toISOString(),
      },
      "Skipping ingestion; wallet recently synced",
    );
    const cursor = wallet.lastSyncedBlock ?? 0;
    return {
      walletId: wallet.id,
      address: wallet.address,
      fromBlock: cursor,
      toBlock: cursor,
      latestBlock: cursor,
      transfersProcessed: 0,
      hasMore: false,
    };
  }

  const latestBlock = await getLatestBlockNumber();
  const lookback =
    options.lookbackBlocks && Number.isFinite(options.lookbackBlocks)
      ? Math.max(0, options.lookbackBlocks)
      : getLookbackBlocks();

  const fromBlockCandidate =
    wallet.lastSyncedBlock !== null && wallet.lastSyncedBlock !== undefined
      ? wallet.lastSyncedBlock + 1
      : latestBlock - lookback;
  const fromBlock = Math.max(fromBlockCandidate, 0);

  const maxBlockSpan =
    options.maxBlockSpan && Number.isFinite(options.maxBlockSpan)
      ? Math.max(0, Math.floor(options.maxBlockSpan))
      : null;
  const targetToBlock =
    maxBlockSpan != null ? Math.min(latestBlock, fromBlock + maxBlockSpan) : latestBlock;

  if (fromBlock > latestBlock) {
    log.info(
      {
        address: wallet.address,
        lastSyncedBlock: wallet.lastSyncedBlock,
        latestBlock,
      },
      "Wallet already synced to head",
    );
    return {
      walletId: wallet.id,
      address: wallet.address,
      fromBlock,
      toBlock: latestBlock,
      latestBlock,
      transfersProcessed: 0,
      hasMore: false,
    };
  }

  log.info(
    { address: wallet.address, fromBlock, toBlock: targetToBlock, latestBlock },
    "Fetching ERC-20 transfers",
  );

  const [incoming, outgoing] = await Promise.all([
    getAssetTransfersForWallet({
      logger: log,
      address: wallet.address,
      fromBlock,
      toBlock: targetToBlock,
      direction: "incoming",
      maxPages: options.maxPages,
    }),
    getAssetTransfersForWallet({
      logger: log,
      address: wallet.address,
      fromBlock,
      toBlock: targetToBlock,
      direction: "outgoing",
      maxPages: options.maxPages,
    }),
  ]);

  const rawTransfers = [...incoming, ...outgoing];
  if (rawTransfers.length === 0) {
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        lastSyncedBlock: targetToBlock,
        lastSyncedAt: new Date(),
      },
    });
    log.info(
      { address: wallet.address, toBlock: targetToBlock },
      "No transfers discovered in window",
    );
    return {
      walletId: wallet.id,
      address: wallet.address,
      fromBlock,
      toBlock: targetToBlock,
      latestBlock,
      transfersProcessed: 0,
      hasMore: targetToBlock < latestBlock,
    };
  }

  const normalized = dedupeById(normalizeTransfers(rawTransfers, wallet.chain));
  const uniqueBlocks = Array.from(
    new Set(normalized.map((transfer) => transfer.blockNumber)),
  );

  if (!options.skipBlockMetadata) {
    await upsertBlocks(uniqueBlocks, log);
  }
  await upsertTransfers(normalized, log);

  const maxSyncedBlock = normalized.reduce(
    (acc, transfer) => Math.max(acc, transfer.blockNumber),
    wallet.lastSyncedBlock ?? 0,
  );
  const finalSyncedBlock = Math.max(maxSyncedBlock, targetToBlock);

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      lastSyncedBlock: finalSyncedBlock,
      lastSyncedAt: new Date(),
    },
  });

  log.info(
    {
      address: wallet.address,
      transfers: normalized.length,
      fromBlock,
      syncedTo: finalSyncedBlock,
    },
    "Wallet ingestion completed",
  );

  return {
    walletId: wallet.id,
    address: wallet.address,
    fromBlock,
    toBlock: finalSyncedBlock,
    latestBlock,
    transfersProcessed: normalized.length,
    hasMore: finalSyncedBlock < latestBlock,
  };
}

function normalizeTransfers(
  transfers: AlchemyAssetTransfer[],
  chain: string,
): NormalizedTransfer[] {
  return transfers
    .filter((transfer) => transfer.category === "erc20")
    .map((transfer) => {
      const blockNumber = parseIntSafe(transfer.blockNum);
      const timestamp = transfer.metadata?.blockTimestamp
        ? new Date(transfer.metadata.blockTimestamp)
        : new Date();

      const parsedLogIndex = parseLogIndex(transfer);
      const logIndex = parsedLogIndex ?? 0;
      const txHash = transfer.hash.toLowerCase();
      const id =
        transfer.uniqueId?.toLowerCase() ?? `${txHash}:${logIndex.toString()}`;

      const tokenAddress =
        transfer.rawContract?.address?.toLowerCase() ??
        "0x0000000000000000000000000000000000000000";
      const decimals = parseIntNullable(transfer.rawContract?.decimal);
      const symbol = transfer.asset ?? null;

      const rawValue = parseRawValue(transfer);
      const amountDec = toDecimalString(rawValue, decimals);

      return {
        id,
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        token: tokenAddress,
        symbol,
        decimals,
        from: transfer.from.toLowerCase(),
        to: transfer.to.toLowerCase(),
        amountRaw: rawValue.toString(),
        amountDec,
        chain,
      };
    });
}

async function upsertBlocks(blockNumbers: number[], logger: Logger) {
  if (blockNumbers.length === 0) {
    return;
  }

  const existing = await prisma.block.findMany({
    where: { number: { in: blockNumbers } },
    select: { number: true },
  });
  const existingSet = new Set(existing.map((block) => block.number));
  const missing = blockNumbers.filter((number) => !existingSet.has(number));

  for (const blockNumber of missing) {
    const block = await getBlockByNumber(blockNumber, logger);
    const timestamp = Number.parseInt(block.timestamp, 16) * 1000;
    await prisma.block.upsert({
      where: { number: blockNumber },
      create: {
        number: blockNumber,
        hash: block.hash.toLowerCase(),
        parentHash: block.parentHash.toLowerCase(),
        timestamp: new Date(timestamp),
      },
      update: {
        hash: block.hash.toLowerCase(),
        parentHash: block.parentHash.toLowerCase(),
        timestamp: new Date(timestamp),
      },
    });
    logger.debug?.({ blockNumber }, "Upserted block metadata");
  }
}

async function upsertTransfers(
  transfers: NormalizedTransfer[],
  logger: Logger,
) {
  const chunks = chunk(transfers, 50);
  for (const chunkTransfers of chunks) {
    await prisma.$transaction(
      chunkTransfers.map((transfer) =>
        prisma.transfer.upsert({
          where: { id: transfer.id },
          update: {
            blockNumber: transfer.blockNumber,
            timestamp: transfer.timestamp,
            txHash: transfer.txHash,
            logIndex: transfer.logIndex,
            token: transfer.token,
            fromAddr: transfer.from,
            toAddr: transfer.to,
            amountRaw: transfer.amountRaw,
            amountDec: transfer.amountDec,
            symbol: transfer.symbol,
            decimals: transfer.decimals ?? undefined,
            chain: transfer.chain,
            stale: false,
          },
          create: {
            id: transfer.id,
            blockNumber: transfer.blockNumber,
            timestamp: transfer.timestamp,
            txHash: transfer.txHash,
            logIndex: transfer.logIndex,
            token: transfer.token,
            fromAddr: transfer.from,
            toAddr: transfer.to,
            amountRaw: transfer.amountRaw,
            amountDec: transfer.amountDec,
            symbol: transfer.symbol,
            decimals: transfer.decimals ?? undefined,
            chain: transfer.chain,
            stale: false,
          },
        }),
      ),
    );
  }
  logger.info({ inserted: transfers.length }, "Upserted transfer records");
}

function parseRawValue(transfer: AlchemyAssetTransfer): bigint {
  const raw = transfer.rawContract?.value;
  if (raw && raw !== "0x" && raw !== "0") {
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
      return BigInt(raw);
    }
    return BigInt(raw);
  }

  if (transfer.value && transfer.rawContract?.decimal != null) {
    const decimals = parseIntNullable(transfer.rawContract.decimal) ?? 0;
    return decimalStringToBigInt(transfer.value, decimals);
  }

  return 0n;
}

function decimalStringToBigInt(value: string, decimals: number): bigint {
  const [integer, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const combined = `${integer}${normalizedFraction}`;
  if (combined.trim() === "") {
    return 0n;
  }
  return BigInt(combined);
}

function toDecimalString(rawValue: bigint, decimals: number | null): string {
  if (decimals == null || decimals <= 0) {
    return rawValue.toString();
  }

  let workingValue = rawValue;
  let workingDecimals = decimals;
  if (workingDecimals > MAX_DECIMALS_STORED) {
    const diff = workingDecimals - MAX_DECIMALS_STORED;
    const divisor = 10n ** BigInt(diff);
    workingValue = workingValue / divisor;
    workingDecimals = MAX_DECIMALS_STORED;
  }

  const scale = 10n ** BigInt(workingDecimals);
  const integerPart = workingValue / scale;
  const fractionalPart = workingValue % scale;

  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  const fraction = fractionalPart
    .toString()
    .padStart(workingDecimals, "0")
    .replace(/0+$/, "");

  return `${integerPart.toString()}.${fraction}`;
}

function parseIntSafe(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const clean = value.toString();
  if (clean.includes("e") || clean.includes(".")) {
    const floatVal = Number.parseFloat(clean);
    if (!Number.isFinite(floatVal)) {
      return 0;
    }
    return Math.floor(floatVal);
  }
  if (clean.startsWith("0x") || clean.startsWith("0X")) {
    return Number.parseInt(clean, 16);
  }
  return Number.parseInt(clean, 10);
}

function parseIntNullable(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const parsed = parseIntSafe(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseLogIndex(transfer: AlchemyAssetTransfer): number | null {
  const rawLogIndex = transfer.logIndex;
  if (rawLogIndex != null) {
    const numeric =
      typeof rawLogIndex === "number"
        ? rawLogIndex
        : rawLogIndex.toString().startsWith("0x")
          ? Number.parseInt(rawLogIndex.toString(), 16)
          : Number.parseInt(rawLogIndex.toString(), 10);
    if (
      Number.isFinite(numeric) &&
      numeric >= 0 &&
      numeric <= Number.MAX_SAFE_INTEGER
    ) {
      return numeric;
    }
  }

  if (transfer.uniqueId) {
    const colonSplit = transfer.uniqueId.split(":");
    const suffix = colonSplit.at(-1);
    if (suffix) {
      const cleaned = suffix.split("-").at(-1) ?? suffix;
      if (cleaned.startsWith("0x")) {
        const parsed = Number.parseInt(cleaned, 16);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      } else if (!cleaned.includes("e") && !cleaned.includes(".")) {
        const parsed = Number.parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }

  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function dedupeById(transfers: NormalizedTransfer[]): NormalizedTransfer[] {
  const map = new Map<string, NormalizedTransfer>();
  for (const transfer of transfers) {
    map.set(transfer.id, transfer);
  }
  return Array.from(map.values());
}
