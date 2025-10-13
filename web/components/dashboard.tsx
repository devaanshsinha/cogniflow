"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type PortfolioResponse = {
  status: "ok";
  data: {
    address: string;
    chain: string;
    windowDays: number;
    sync: {
      lastSyncedBlock: number | null;
      lastSyncedAt: string | null;
    } | null;
    valuations: {
      incomingUsd: string;
      outgoingUsd: string;
      netUsd: string;
    };
    totals: {
      transfers: number;
      incomingTransfers: number;
      outgoingTransfers: number;
      counterparties: number;
    };
    holdings: Array<{
      token: string;
      symbol: string | null;
      decimals: number | null;
      incoming: string;
      outgoing: string;
      net: string;
      priceUsd: string | null;
      priceTimestamp: string | null;
      incomingUsd: string | null;
      outgoingUsd: string | null;
      netUsd: string | null;
    }>;
  };
};

type TransfersResponse = {
  status: "ok";
  data: Array<{
    id: string;
    timestamp: string;
    txHash: string;
    token: string;
    from: string;
    to: string;
    amount: string;
    symbol: string | null;
    chain: string;
    stale: boolean;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  sync: {
    lastSyncedBlock: number | null;
    lastSyncedAt: string | null;
  } | null;
};

type SearchResponse = {
  status: "ok";
  data: Array<{
    id: string;
    score: number;
    timestamp: string;
    txHash: string;
    from: string;
    to: string;
    amount: string;
    symbol: string | null;
    chain: string;
  }>;
};

type FetchState = {
  loading: boolean;
  error: string | null;
};

const DEMO_ADDRESS = "0xabc123abc123abc123abc123abc123abc123abc1";
const EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_ETHERSCAN_BASE_URL ?? "https://etherscan.io";

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const preciseFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

function formatCompact(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (Math.abs(numeric) < 1000) {
    return preciseFormatter.format(numeric);
  }
  return compactFormatter.format(numeric);
}

function formatUsd(value: string | number | null) {
  if (value == null) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const absolute = Math.abs(numeric);
  const formatted =
    absolute >= 1000
      ? compactFormatter.format(numeric)
      : preciseFormatter.format(numeric);
  return numeric >= 0 ? `$${formatted}` : `- $${formatted.replace("-", "")}`;
}

function shortenAddress(address: string, length = 8) {
  if (!address) return "—";
  return `${address.slice(0, length)}…${address.slice(-4)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString();
}

export function Dashboard(): JSX.Element {
  const [address, setAddress] = useState(DEMO_ADDRESS);
  const [pendingAddress, setPendingAddress] = useState(DEMO_ADDRESS);
  const [portfolioState, setPortfolioState] = useState<FetchState>({
    loading: false,
    error: null,
  });
  const [transfersState, setTransfersState] = useState<FetchState>({
    loading: false,
    error: null,
  });
  const [transfersHasMore, setTransfersHasMore] = useState(false);
  const [searchState, setSearchState] = useState<FetchState>({
    loading: false,
    error: null,
  });

  const [portfolio, setPortfolio] =
    useState<PortfolioResponse["data"] | null>(null);
  const [transfers, setTransfers] = useState<TransfersResponse["data"]>([]);
  const [searchResults, setSearchResults] =
    useState<SearchResponse["data"]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRan, setSearchRan] = useState(false);

  const refreshData = useCallback(async (nextAddress: string) => {
    const normalized = nextAddress.trim().toLowerCase();
    if (!normalized) {
      setPortfolio(null);
      setTransfers([]);
      setTransfersHasMore(false);
      setSearchResults([]);
      setSearchState({ loading: false, error: null });
      setSearchRan(false);
      return;
    }

    setPortfolioState({ loading: true, error: null });
    setTransfersState({ loading: true, error: null });

    try {
      const [portfolioRes, transfersRes] = await Promise.all([
        fetch(`/api/portfolio?address=${normalized}`),
        fetch(`/api/transfers?address=${normalized}&limit=25`),
      ]);

      if (!portfolioRes.ok) {
        const body = await portfolioRes.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to load portfolio");
      }
      if (!transfersRes.ok) {
        const body = await transfersRes.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to load transfers");
      }

      const portfolioJson = (await portfolioRes.json()) as PortfolioResponse;
      const transfersJson = (await transfersRes.json()) as TransfersResponse;

      setPortfolio(portfolioJson.data);
      setTransfers(transfersJson.data);
       setTransfersHasMore(transfersJson.hasMore);
      setPortfolioState({ loading: false, error: null });
      setTransfersState({ loading: false, error: null });
      setSearchResults([]);
      setSearchState({ loading: false, error: null });
      setSearchRan(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      setPortfolioState({ loading: false, error: message });
      setTransfersState({ loading: false, error: message });
    }
  }, []);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAddress(pendingAddress);
      void refreshData(pendingAddress);
    },
    [pendingAddress, refreshData],
  );

  useEffect(() => {
    void refreshData(address);
  }, [address, refreshData]);

  const onSearchSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const query = searchQuery.trim();
      if (!query) {
        setSearchResults([]);
        setSearchState({ loading: false, error: null });
        setSearchRan(false);
        return;
      }

      setSearchState({ loading: true, error: null });
      try {
        const normalizedAddress = address.trim().toLowerCase();
        const params = new URLSearchParams({ q: query });
        const chain = portfolio?.chain ?? "eth";
        params.set("chain", chain);
        if (normalizedAddress.match(/^0x[a-f0-9]{40}$/i)) {
          params.set("address", normalizedAddress);
        }

        const response = await fetch(`/api/search?${params.toString()}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.message ?? "Failed to run search");
        }
        const json = (await response.json()) as SearchResponse;
        setSearchResults(json.data);
        setSearchState({ loading: false, error: null });
        setSearchRan(true);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        setSearchState({ loading: false, error: message });
        setSearchRan(false);
      }
    },
    [searchQuery, address, portfolio?.chain],
  );

  const holdings = useMemo(() => portfolio?.holdings ?? [], [portfolio]);
  const valuations = portfolio?.valuations ?? null;
  const sync = portfolio?.sync ?? null;

  const syncDisplay = useMemo(() => {
    if (!sync) {
      return { blockLabel: "—", timeLabel: "Waiting for first sync…" };
    }
    const blockLabel =
      typeof sync.lastSyncedBlock === "number"
        ? `#${sync.lastSyncedBlock.toLocaleString()}`
        : "—";
    const timeLabel = sync.lastSyncedAt
      ? `Updated ${new Date(sync.lastSyncedAt).toLocaleString()}`
      : "Sync pending";
    return { blockLabel, timeLabel };
  }, [sync]);

  const summaryItems = useMemo(() => {
    if (!portfolio) return [];
    return [
      {
        label: "Total transfers",
        value: formatCompact(portfolio.totals.transfers),
        caption: "All movements during the selected window",
      },
      {
        label: "Incoming transfers",
        value: formatCompact(portfolio.totals.incomingTransfers),
        caption: "Credits received",
      },
      {
        label: "Outgoing transfers",
        value: formatCompact(portfolio.totals.outgoingTransfers),
        caption: "Debits sent",
      },
      {
        label: "Unique counterparties",
        value: formatCompact(portfolio.totals.counterparties),
        caption: "Distinct addresses interacted with",
      },
      valuations && {
        label: "Net USD",
        value: formatUsd(valuations.netUsd),
        caption: "Incoming minus outgoing (priced)",
      },
      valuations && {
        label: "Incoming USD",
        value: formatUsd(valuations.incomingUsd),
        caption: "Priced value of credits",
      },
      valuations && {
        label: "Outgoing USD",
        value: formatUsd(valuations.outgoingUsd),
        caption: "Priced value of debits",
      },
    ].filter(Boolean) as Array<{
      label: string;
      value: string;
      caption: string;
    }>;
  }, [portfolio, valuations]);

  const topHoldings = useMemo(() => {
    return holdings
      .slice()
      .sort(
        (a, b) => Number(b.netUsd ?? b.net ?? 0) - Number(a.netUsd ?? a.net ?? 0),
      );
  }, [holdings]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-16 pt-12 sm:px-8">
      <section className="grid gap-6 rounded-3xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-700 p-8 text-white shadow-xl dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-300">
              Cogniflow
            </span>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Wallet intelligence at production scale
            </h1>
            <p className="max-w-xl text-sm text-neutral-400 sm:text-base">
              Connect an address, refresh the ledger, and interrogate on-chain
              activity with deterministic tools and semantic search.
            </p>
          </div>
          <form
            onSubmit={onSubmit}
            className="flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:items-center"
          >
            <div className="flex-1">
              <Input
                value={pendingAddress}
                onChange={(event) => setPendingAddress(event.target.value)}
                placeholder="0x…"
                className="border-white/20 bg-white/10 text-white placeholder:text-white/40 focus:border-white/40 focus:ring-white/30"
              />
            </div>
            <Button type="submit" variant="secondary">
              Load activity
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-300">
          <Badge variant="outline" className="border-white/20 text-white">
            Chain: {portfolio?.chain ?? "eth"}
          </Badge>
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">Sync:</span>
            <span>{syncDisplay.blockLabel}</span>
            <span className="text-neutral-400">·</span>
            <span>{syncDisplay.timeLabel}</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryItems.length === 0 && portfolioState.loading ? (
          <p className="text-sm text-neutral-500">Loading summary…</p>
        ) : summaryItems.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Enter an address to see portfolio insights.
          </p>
        ) : (
          summaryItems.map((item) => (
            <Card key={item.label} className="border-neutral-100 dark:border-neutral-800">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-[0.25em]">
                  {item.label}
                </CardDescription>
                <CardTitle className="text-2xl text-neutral-900 dark:text-neutral-50">
                  {item.value}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {item.caption}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Latest transfers</CardTitle>
            <CardDescription>
              Most recent activity limited to 25 rows (freshest at the top).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transfersState.loading ? (
              <p className="text-sm text-neutral-500">Loading transfers…</p>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No transfers found for this range.
              </p>
            ) : (
              <div className="space-y-3">
                {transfers.slice(0, 10).map((transfer) => {
                  const isIncoming =
                    transfer.to.toLowerCase() === address.toLowerCase();
                  return (
                    <div
                      key={transfer.id}
                      className="rounded-2xl border border-neutral-200 bg-white/80 p-4 shadow-sm transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-50">
                            {transfer.symbol ?? "Unknown"}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {new Date(transfer.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant={isIncoming ? "success" : "warning"}>
                          {isIncoming ? "Incoming" : "Outgoing"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-400">
                        <span className="truncate" title={transfer.from}>
                          {shortenAddress(transfer.from, 12)}
                        </span>
                        <span className="text-center text-neutral-500">→</span>
                        <span className="text-right" title={transfer.to}>
                          {shortenAddress(transfer.to, 12)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-200">
                        <span>{transfer.amount}</span>
                        <a
                          href={`${EXPLORER_BASE_URL}/tx/${transfer.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-300"
                        >
                          {transfer.txHash.slice(0, 10)}…
                        </a>
                      </div>
                    </div>
                  );
                })}
                {transfersHasMore && (
                  <p className="text-xs text-neutral-400">
                    More transfers available via the API.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top holdings</CardTitle>
            <CardDescription>
              Net token positions ranked by priced value (or token units when no
              quote is available).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {portfolioState.loading ? (
              <p className="text-sm text-neutral-500">Loading holdings…</p>
            ) : topHoldings.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No holdings found in the selected window.
              </p>
            ) : (
              <div className="space-y-4">
                {topHoldings.slice(0, 5).map((holding) => {
                  const netUsd = holding.netUsd
                    ? Number(holding.netUsd)
                    : Number(holding.net);
                  const positive = netUsd >= 0;
                  const spotPrice = holding.priceUsd
                    ? formatUsd(holding.priceUsd)
                    : null;
                  const spotTimestamp = formatTimestamp(holding.priceTimestamp);
                  return (
                    <div
                      key={holding.token}
                      className={cn(
                        "rounded-2xl border border-neutral-200 bg-white/80 p-4 transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/50",
                        positive
                          ? "border-emerald-100/70 dark:border-emerald-900/40"
                          : "border-amber-100/70 dark:border-amber-900/40",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                            {holding.symbol ?? "Unknown"}
                          </p>
                          <p className="text-xs text-neutral-400">
                            {shortenAddress(holding.token, 12)}
                          </p>
                        </div>
                        <Badge variant={positive ? "success" : "warning"}>
                          {positive ? "Net long" : "Net out"}
                        </Badge>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                          {formatCompact(holding.net)}
                        </div>
                        <p className="text-sm text-neutral-500">
                          {formatCompact(holding.incoming)} in · {formatCompact(holding.outgoing)} out
                        </p>
                        {spotPrice ? (
                          <p className="text-xs text-neutral-400">
                            Spot {spotPrice}
                            {spotTimestamp ? ` · ${spotTimestamp}` : ""}
                          </p>
                        ) : (
                          <p className="text-xs text-neutral-400">
                            No recent spot price
                          </p>
                        )}
                        <p className="text-xs text-neutral-400">
                          {holding.netUsd
                            ? `Priced net ${formatUsd(holding.netUsd)}`
                            : "Net position valued from token balance"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Semantic search</CardTitle>
            <CardDescription>
              Ask for patterns in natural language. Results are ranked using
              OpenAI embeddings and pgvector similarity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={onSearchSubmit}
              className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white/80 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center"
            >
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find multi-million inflows last month"
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={searchState.loading}>
                  {searchState.loading ? "Searching…" : "Search"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                    setSearchState({ loading: false, error: null });
                    setSearchRan(false);
                  }}
                >
                  Clear
                </Button>
              </div>
            </form>
            {searchState.error && (
              <p className="text-sm text-red-500">{searchState.error}</p>
            )}
            {searchRan && searchResults.length === 0 && !searchState.loading ? (
              <p className="text-sm text-neutral-500">
                No semantic matches found. Try refining the query or widening the
                timeframe.
              </p>
            ) : null}
            {searchResults.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-neutral-100/70 dark:bg-neutral-900/60">
                      <TableHead>Timestamp</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Similarity</TableHead>
                      <TableHead>Tx hash</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResults.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {new Date(row.timestamp).toLocaleString()}
                        </TableCell>
                        <TableCell>{shortenAddress(row.from, 12)}</TableCell>
                        <TableCell>{shortenAddress(row.to, 12)}</TableCell>
                        <TableCell>{row.amount}</TableCell>
                        <TableCell>{row.symbol ?? "—"}</TableCell>
                        <TableCell>{row.score.toFixed(3)}</TableCell>
                        <TableCell>
                          <a
                            href={`${EXPLORER_BASE_URL}/tx/${row.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-300"
                          >
                            {row.txHash.slice(0, 12)}…
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
