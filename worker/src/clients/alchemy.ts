import type { Logger } from "pino";

type JsonRpcRequest = {
  id: number;
  jsonrpc: "2.0";
  method: string;
  params: unknown[];
};

type JsonRpcResponse<T> = {
  id: number;
  jsonrpc: "2.0";
  result?: T;
  error?: { code: number; message: string };
};

type AssetTransferResponse = {
  transfers: AlchemyAssetTransfer[];
  pageKey?: string;
};

export type AlchemyAssetTransfer = {
  uniqueId: string;
  hash: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
  rawContract?: {
    address?: string;
    decimal?: string | number | null;
    value?: string | null;
  };
  asset?: string | null;
  value?: string | null;
  from: string;
  to: string;
  category: string;
  erc721TokenId?: string | null;
  logIndex?: string | number | null;
};

let rpcIdCounter = 0;

const ETH_DEFAULT_LOOKBACK = Number.parseInt(
  process.env.ETH_LOOKBACK_BLOCKS ?? "5000",
  10,
);
const RPC_MAX_RETRIES = Number.parseInt(
  process.env.RPC_MAX_RETRIES ?? "5",
  10,
);
const RPC_RETRY_BASE_MS = Number.parseInt(
  process.env.RPC_RETRY_BASE_MS ?? "300",
  10,
);
const RPC_RETRY_MAX_MS = Number.parseInt(
  process.env.RPC_RETRY_MAX_MS ?? "4500",
  10,
);

export function getLookbackBlocks(): number {
  return Number.isFinite(ETH_DEFAULT_LOOKBACK) && ETH_DEFAULT_LOOKBACK > 0
    ? ETH_DEFAULT_LOOKBACK
    : 5000;
}

function requireRpcUrl(): string {
  const url =
    process.env.ETH_RPC_URL?.trim() ??
    process.env.ALCHEMY_HTTP_URL?.trim() ??
    "";
  if (!url) {
    throw new Error(
      "ETH_RPC_URL (or ALCHEMY_HTTP_URL) is not configured. Set it in your environment before running the worker.",
    );
  }
  return url;
}

type RpcRetryOptions = {
  logger?: Logger;
  context?: Record<string, unknown>;
};

async function callRpc<T>(
  method: string,
  params: unknown[],
  options: RpcRetryOptions = {},
): Promise<T> {
  const rpcUrl = requireRpcUrl();
  const payload: JsonRpcRequest = {
    id: ++rpcIdCounter,
    jsonrpc: "2.0",
    method,
    params,
  };

  const maxAttempts =
    Number.isFinite(RPC_MAX_RETRIES) && RPC_MAX_RETRIES > 0
      ? RPC_MAX_RETRIES
      : 5;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await safeText(response);
        const error = new Error(
          `RPC request failed (${response.status}): ${errorBody}`,
        );
        (error as { status?: number }).status = response.status;
        throw error;
      }

      const body = (await response.json()) as JsonRpcResponse<T>;
      if (body.error) {
        const error = new Error(
          `RPC error ${body.error.code}: ${body.error.message}`,
        );
        (error as { code?: number }).code = body.error.code;
        throw error;
      }
      if (typeof body.result === "undefined") {
        throw new Error("RPC response missing result");
      }
      return body.result;
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= maxAttempts) {
        throw error;
      }
      const delay = computeBackoff(attempt);
      options.logger?.warn(
        {
          attempt,
          delay,
          method,
          ...(options.context ?? {}),
          err: error,
        },
        "Retrying RPC request after failure",
      );
      await wait(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("RPC call failed after retries");
}

function shouldRetry(error: unknown): boolean {
  if (error == null) return false;
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    const code = (error as { code?: number }).code;
    const message = error.message.toLowerCase();

    if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    if (code && [429, -32002].includes(code)) {
      return true;
    }

    if (
      message.includes("timeout") ||
      message.includes("temporarily unavailable") ||
      message.includes("forwarder error")
    ) {
      return true;
    }
  }
  return false;
}

function computeBackoff(attempt: number): number {
  const base =
    Number.isFinite(RPC_RETRY_BASE_MS) && RPC_RETRY_BASE_MS > 0
      ? RPC_RETRY_BASE_MS
      : 300;
  const max =
    Number.isFinite(RPC_RETRY_MAX_MS) && RPC_RETRY_MAX_MS > 0
      ? RPC_RETRY_MAX_MS
      : 4500;
  const jitter = Math.random() * base;
  const delay = Math.min(base * 2 ** (attempt - 1) + jitter, max);
  return Math.floor(delay);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}

export async function getLatestBlockNumber(): Promise<number> {
  const hex = await callRpc<string>("eth_blockNumber", []);
  return Number.parseInt(hex, 16);
}

export type JsonRpcBlock = {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
};

export async function getBlockByNumber(
  blockNumber: number,
  logger?: Logger,
): Promise<JsonRpcBlock> {
  const hexBlock = `0x${blockNumber.toString(16)}`;
  return await callRpc<JsonRpcBlock>(
    "eth_getBlockByNumber",
    [hexBlock, false],
    { logger, context: { blockNumber } },
  );
}

export async function getAssetTransfersForWallet(options: {
  logger: Logger;
  address: string;
  fromBlock: number;
  toBlock: number;
  direction: "incoming" | "outgoing";
  maxPages?: number;
}): Promise<AlchemyAssetTransfer[]> {
  const { logger, address, fromBlock, toBlock, direction } = options;
  const maxPages = options.maxPages ?? 5;

  const paramsBase = {
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    category: ["erc20"],
    withMetadata: true,
    excludeZeroValue: false,
    maxCount: "0x3E8", // 1000 dec
  } as Record<string, unknown>;

  if (direction === "incoming") {
    paramsBase.toAddress = address;
  } else {
    paramsBase.fromAddress = address;
  }

  const transfers: AlchemyAssetTransfer[] = [];
  let pageKey: string | undefined;
  let page = 0;

  do {
    const params = { ...paramsBase };
    if (pageKey) {
      params.pageKey = pageKey;
    }

    const response = await callRpc<AssetTransferResponse>(
      "alchemy_getAssetTransfers",
      [params],
      {
        logger,
        context: { address, direction, fromBlock, toBlock, page },
      },
    );
    transfers.push(...(response.transfers ?? []));
    pageKey = response.pageKey;
    page += 1;

    if (page >= maxPages && pageKey) {
      logger.warn(
        { address, direction, fromBlock, toBlock, pageKey },
        "Reached max pagination depth while fetching transfers",
      );
      break;
    }
  } while (pageKey);

  return transfers;
}
