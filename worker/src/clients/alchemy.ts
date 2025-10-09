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

async function callRpc<T>(method: string, params: unknown[]): Promise<T> {
  const rpcUrl = requireRpcUrl();
  const payload: JsonRpcRequest = {
    id: ++rpcIdCounter,
    jsonrpc: "2.0",
    method,
    params,
  };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `RPC request failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
  }
  if (typeof body.result === "undefined") {
    throw new Error("RPC response missing result");
  }
  return body.result;
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
): Promise<JsonRpcBlock> {
  const hexBlock = `0x${blockNumber.toString(16)}`;
  return await callRpc<JsonRpcBlock>("eth_getBlockByNumber", [hexBlock, false]);
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
