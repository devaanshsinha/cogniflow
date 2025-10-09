"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PortfolioResponse = {
  status: "ok";
  data: {
    address: string;
    chain: string;
    windowDays: number;
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
};

type FetchState = {
  loading: boolean;
  error: string | null;
};

const DEMO_ADDRESS = "0xabc123abc123abc123abc123abc123abc123abc1";

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
  const [portfolio, setPortfolio] = useState<PortfolioResponse["data"] | null>(
    null
  );
  const [transfers, setTransfers] = useState<
    TransfersResponse["data"]
  >([]);

  const refreshData = useCallback(
    async (nextAddress: string) => {
      const normalized = nextAddress.trim().toLowerCase();
      if (!normalized) {
        setPortfolio(null);
        setTransfers([]);
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
        setPortfolioState({ loading: false, error: null });
        setTransfersState({ loading: false, error: null });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        setPortfolioState({ loading: false, error: message });
        setTransfersState({ loading: false, error: message });
      }
    },
    []
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAddress(pendingAddress);
      void refreshData(pendingAddress);
    },
    [pendingAddress, refreshData]
  );

  useEffect(() => {
    void refreshData(address);
  }, [address, refreshData]);

  const holdings = useMemo(() => portfolio?.holdings ?? [], [portfolio]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Cogniflow Dashboard
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Track wallet activity, balances, and transfers. Data updates when you
          change the address below.
        </p>
        <form
          onSubmit={onSubmit}
          className="mt-4 flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white/60 p-4 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/60"
        >
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Wallet address
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-neutral-700 dark:bg-neutral-900"
              value={pendingAddress}
              onChange={(event) => setPendingAddress(event.target.value)}
              placeholder="0x..."
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              Load data
            </button>
          </div>
        </form>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
          Overview ({portfolio?.chain ?? "eth"})
        </h2>
        {portfolioState.loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading portfolio…</p>
        ) : portfolioState.error ? (
          <p className="mt-3 text-sm text-red-500">
            {portfolioState.error}. Try again.
          </p>
        ) : portfolio ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Total transfers"
              value={portfolio.totals.transfers.toLocaleString()}
            />
            <SummaryCard
              label="Incoming"
              value={portfolio.totals.incomingTransfers.toLocaleString()}
            />
            <SummaryCard
              label="Outgoing"
              value={portfolio.totals.outgoingTransfers.toLocaleString()}
            />
            <SummaryCard
              label="Counterparties"
              value={portfolio.totals.counterparties.toLocaleString()}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">
            Enter an address to see portfolio stats.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
          Top tokens (net)
        </h2>
        {holdings.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No holdings found in the selected window.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {holdings.map((holding) => (
              <div
                key={holding.token}
                className="rounded-lg border border-neutral-200 bg-white/60 p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/60"
              >
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                  {holding.symbol ?? "Unknown"}{" "}
                  <span className="text-xs text-neutral-400">
                    ({holding.token.slice(0, 6)}…)
                  </span>
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {Number(holding.net).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  Incoming {holding.incoming}, Outgoing {holding.outgoing}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
          Latest transfers
        </h2>
        {transfersState.loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading transfers…</p>
        ) : transfersState.error ? (
          <p className="mt-3 text-sm text-red-500">
            {transfersState.error}. Try again.
          </p>
        ) : transfers.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No transfers found for this range.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 shadow-sm dark:border-neutral-700">
            <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
              <thead className="bg-neutral-50 dark:bg-neutral-900">
                <tr>
                  <Th>Timestamp</Th>
                  <Th>Token</Th>
                  <Th>Direction</Th>
                  <Th>Amount</Th>
                  <Th>Tx hash</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white/60 dark:divide-neutral-800 dark:bg-neutral-900/60">
                {transfers.map((transfer) => {
                  const isIncoming =
                    transfer.to.toLowerCase() === address.toLowerCase();
                  return (
                    <tr key={transfer.id}>
                      <Td className="whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                        {new Date(transfer.timestamp).toLocaleString()}
                      </Td>
                      <Td className="text-sm">
                        <span className="font-medium text-neutral-800 dark:text-neutral-100">
                          {transfer.symbol ?? "Unknown"}
                        </span>
                        <span className="block text-xs text-neutral-400">
                          {transfer.token.slice(0, 10)}…
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            isIncoming
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {isIncoming ? "Incoming" : "Outgoing"}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-200">
                        {Number(transfer.amount).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                        <a
                          href={`https://etherscan.io/tx/${transfer.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {transfer.txHash.slice(0, 12)}…
                        </a>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white/60 p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/60">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {value}
      </p>
    </div>
  );
}

function Th({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}

export default Dashboard;
