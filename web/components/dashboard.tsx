"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react";
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
    amountUsd: string | null;
    priceUsd: string | null;
    priceTimestamp: string | null;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  sync: {
    lastSyncedBlock: number | null;
    lastSyncedAt: string | null;
  } | null;
};

type FetchState = {
  loading: boolean;
  error: string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  status: "ok";
  data: {
    answer: string;
    tables: Array<{
      title: string;
      columns: string[];
      rows: Array<string[]>;
    }>;
    chart: { type: string; data: unknown } | null;
    sources: string[];
    debug?: Record<string, unknown>;
  };
};

type ChatTurn = {
  id: string;
  user: string;
  answer: string;
  tables: ChatResponse["data"]["tables"];
  chart: ChatResponse["data"]["chart"];
  sources: string[];
  debug?: Record<string, unknown>;
};

const DEMO_ADDRESS = "0xabc123abc123abc123abc123abc123abc123abc1";
const DEFAULT_CHAIN =
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN?.toLowerCase() ?? "eth";
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

export function Dashboard() {
  const session = useSession();
  const router = useRouter();
  const supabase = useSupabaseClient();


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
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [transfersHasMore, setTransfersHasMore] = useState(false);
  const [portfolio, setPortfolio] =
    useState<PortfolioResponse["data"] | null>(null);
  const [transfers, setTransfers] = useState<TransfersResponse["data"]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatState, setChatState] = useState<FetchState>({
    loading: false,
    error: null,
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);

  const refreshData = useCallback(
    async (nextAddress: string) => {
      if (!session) return;

      const normalized = nextAddress.trim().toLowerCase();
      if (!normalized) {
        setPortfolio(null);
        setTransfers([]);
        setTransfersHasMore(false);
        setChatMessages([]);
        setChatTurns([]);
        setChatState({ loading: false, error: null });
        setChatInput("");
        return;
      }

      setPortfolioState({ loading: true, error: null });
      setTransfersState({ loading: true, error: null });

      try {
        const ensureWalletResponse = await fetch("/api/wallets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: normalized, chain: DEFAULT_CHAIN }),
        });

        if (!ensureWalletResponse.ok) {
          const body = await ensureWalletResponse.json().catch(() => ({}));
          throw new Error(body?.message ?? "Failed to prepare wallet");
        }

        const [portfolioRes, transfersRes] = await Promise.all([
          fetch(`/api/portfolio?address=${normalized}&chain=${DEFAULT_CHAIN}`),
          fetch(
            `/api/transfers?address=${normalized}&chain=${DEFAULT_CHAIN}&limit=25`,
          ),
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
        setChatMessages([]);
        setChatTurns([]);
        setChatState({ loading: false, error: null });
        setChatInput("");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        setPortfolioState({ loading: false, error: message });
        setTransfersState({ loading: false, error: message });
      }
    },
    [session],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session) {
        setChatState({
          loading: false,
          error: "Please sign in to load wallet data.",
        });
        return;
      }
      setAddress(pendingAddress);
      void refreshData(pendingAddress);
    },
    [pendingAddress, refreshData, session],
  );

  useEffect(() => {
    if (!session) return;
    void refreshData(address);
  }, [address, refreshData, session]);

  const onChatSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const prompt = chatInput.trim();
      if (!prompt) {
        return;
      }

      if (!session) {
        setChatState({
          loading: false,
          error: "Please sign in to ask questions.",
        });
        return;
      }

      const normalizedAddress = address.trim().toLowerCase();
      if (!normalizedAddress.match(/^0x[a-f0-9]{40}$/i)) {
        setChatState({
          loading: false,
          error: "Enter a valid wallet address before asking questions.",
        });
        return;
      }

      const chain = portfolio?.chain ?? "eth";
      const outboundMessages: ChatMessage[] = [
        ...chatMessages,
        { role: "user", content: prompt },
      ];

      const turnId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;

      setChatTurns((prev) => [
        ...prev,
        {
          id: turnId,
          user: prompt,
          answer: "",
          tables: [],
          chart: null,
          sources: [],
          debug: undefined,
        },
      ]);
      setChatState({ loading: true, error: null });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: normalizedAddress,
            chain,
            messages: outboundMessages,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.message ?? "Failed to get assistant reply");
        }

        const json = (await response.json()) as ChatResponse;

        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: json.data.answer,
        };

        setChatMessages([...outboundMessages, assistantMessage]);
        setChatTurns((prev) =>
          prev.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  answer: json.data.answer,
                  tables: json.data.tables ?? [],
                  chart: json.data.chart,
                  sources: json.data.sources ?? [],
                  debug: json.data.debug,
                }
              : turn,
          ),
        );
        setChatInput("");
        setChatState({ loading: false, error: null });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        setChatState({ loading: false, error: message });
        setChatTurns((prev) => prev.filter((turn) => turn.id !== turnId));
      }
    },
    [chatInput, address, portfolio?.chain, chatMessages, session],
  );

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatTurns([]);
    setChatInput("");
    setChatState({ loading: false, error: null });
  }, []);

  const handleSignOut = useCallback(async () => {
    setSignOutLoading(true);
    const { error } = await supabase.auth.signOut();
    setSignOutLoading(false);
    if (error) {
      console.error("Failed to sign out", error.message);
      return;
    }
    router.replace("/signin");
    router.refresh();
  }, [router, supabase]);

  useEffect(() => {
    if (session) {
      return;
    }
    setPortfolio(null);
    setTransfers([]);
    setTransfersHasMore(false);
    setPortfolioState({ loading: false, error: null });
    setTransfersState({ loading: false, error: null });
    setChatMessages([]);
    setChatTurns([]);
    setChatInput("");
    setChatState({ loading: false, error: null });
    setAddress(DEMO_ADDRESS);
    setPendingAddress(DEMO_ADDRESS);
  }, [session]);

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

  if (!session) {
    return null;
  }

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
          <div className="flex w-full max-w-lg flex-col gap-3">
            <form
              onSubmit={onSubmit}
              className="flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <div className="flex-1">
                <Input
                  value={pendingAddress}
                  onChange={(event) => setPendingAddress(event.target.value)}
                  placeholder="0x…"
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/40 focus:border-white/40 focus:ring-white/30"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={portfolioState.loading || transfersState.loading}
              >
                Load activity
              </Button>
            </form>
            <div className="flex flex-col gap-1 text-xs text-neutral-300 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Signed in as{" "}
                <span className="font-semibold">
                  {session.user.email ?? session.user.id}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
                onClick={handleSignOut}
                disabled={signOutLoading}
              >
                {signOutLoading ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </div>
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
                      <div className="mt-3 flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-200">
                        <div className="flex items-center justify-between">
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
                        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                          <span>
                            {transfer.amountUsd
                              ? formatUsd(transfer.amountUsd)
                              : "—"}
                          </span>
                          <span>
                            {transfer.priceUsd
                              ? `${formatUsd(transfer.priceUsd)} spot`
                              : "No price"}
                          </span>
                        </div>
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
            <CardTitle>Chat</CardTitle>
            <CardDescription>
              Ask natural-language questions. Responses use deterministic tools
              (named SQL plus semantic search) under the hood.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={onChatSubmit}
              className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white/80 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50 sm:flex-row sm:items-center"
            >
              <Input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Top counterparties last 14 days"
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={chatState.loading}>
                  {chatState.loading ? "Thinking…" : "Ask"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearChat}
                  disabled={chatState.loading && chatTurns.length === 0}
                >
                  Clear
                </Button>
              </div>
            </form>
            {chatState.error ? (
              <p className="text-sm text-red-500">{chatState.error}</p>
            ) : null}
            {chatTurns.length === 0 && !chatState.loading ? (
              <p className="text-sm text-neutral-500">
                Try prompts like “What were my largest outgoing USDT transfers
                last week?” or “Show top counterparties over the last 30 days.”
              </p>
            ) : null}
            <div className="space-y-4">
              {chatTurns.map((turn, index) => {
                const isPending =
                  turn.answer.trim().length === 0 &&
                  chatState.loading &&
                  index === chatTurns.length - 1;
                return (
                  <div
                    key={turn.id}
                    className="space-y-3 rounded-2xl border border-neutral-200 bg-white/80 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50"
                  >
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">
                        You
                      </p>
                      <p className="text-sm text-neutral-800 dark:text-neutral-200">
                        {turn.user}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">
                        Assistant
                      </p>
                      <p className="text-sm text-neutral-700 dark:text-neutral-100">
                        {isPending
                          ? "Working on it…"
                          : turn.answer || "No answer returned."}
                      </p>
                    </div>
                    {turn.sources.length > 0 ? (
                      <p className="text-xs text-neutral-500">
                        Sources: {turn.sources.join(", ")}
                      </p>
                    ) : null}
                    {turn.tables.length > 0
                      ? turn.tables.map((table, tableIndex) => (
                          <div
                            key={`${turn.id}-table-${tableIndex}`}
                            className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
                          >
                            <div className="border-b border-neutral-200 bg-neutral-100/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-300">
                              {table.title}
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {table.columns.map((column) => (
                                    <TableHead key={column}>{column}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {table.rows.map((row, rowIndex) => (
                                  <TableRow key={`${turn.id}-row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) => (
                                      <TableCell key={cellIndex}>{cell}</TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))
                      : null}
                    {turn.chart ? (
                      <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-700">
                        Chart placeholder ({turn.chart.type}) – integrate a chart
                        library to render{" "}
                        <code className="rounded bg-neutral-900/80 px-1 py-0.5 text-neutral-100">
                          {JSON.stringify(turn.chart.data)}
                        </code>
                      </div>
                    ) : null}
                    {turn.debug ? (
                      <details className="rounded-xl border border-neutral-200 bg-white/70 p-3 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                        <summary className="cursor-pointer font-semibold text-neutral-600 dark:text-neutral-200">
                          Debug info
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(turn.debug, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
