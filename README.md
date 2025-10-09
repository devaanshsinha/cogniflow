# Cogniflow

Cogniflow is an on-chain intelligence agent that lets users explore wallet activity through a chat UI and a dashboard. It combines a lightweight indexer, normalized storage, vector search, and LLM-driven tool use to answer natural-language questions with charts and tables.

## Monorepo Layout

- `web/` Next.js app (chat, dashboard, API routes)
- `worker/` Node.js indexer and scheduled jobs
- `package.json` npm workspaces config
- `package-lock.json` lockfile shared across packages
- `.gitignore` repo-wide ignore rules

## Core Capabilities (Planned MVP)

- Connect Ethereum wallets (Sepolia/mainnet read-only)
- Ingest balances, ERC-20 transfers, and gas metrics
- Store normalized events in Postgres + pgvector
- Chat endpoint executes named SQL/REST tools
- Dashboard cards, transfers table, and simple charts

## Tech Stack

- Frontend: Next.js 15, React 19, Tailwind CSS 4, TypeScript
- Backend: Node.js workers, Prisma (up next), Supabase Postgres
- Data: pgvector embeddings, CoinGecko price enrichment
- Infra: Vercel (web, cron), Supabase Auth, Alchemy/Infura RPC

## Getting Started

- `npm install` to bootstrap root and workspace dependencies
- `cp .env.example .env` and update Supabase/RPC/LLM keys
- `npx prisma migrate dev` to create tables (Supabase/Postgres URL required)
- `npx prisma generate` whenever the schema changes
- `npm run dev -w web` to launch the Next.js app at http://localhost:3000
- `npm run start -w worker` to ingest ERC-20 transfers for tracked wallets

## API Routes (so far)

- `GET /api/healthz` – verifies database connectivity
- `GET /api/transfers?address=0x...&chain=eth&direction=all&limit=50&cursor=...` – paginated transfers for a wallet (response includes `sync` metadata for the indexed block/time)
- `GET /api/portfolio?address=0x...&chain=eth&days=7` – aggregated balances and counters for the last N days (response includes `sync` metadata and USD valuations when prices are available)
- `POST /tool/sql` – deterministic named SQL tooling for the chat agent (see `/tool/sql` GET for the allowlisted names)
- `POST /api/chat` – placeholder chat orchestrator stub that will call the deterministic tools

## Frontend

- Dashboard page includes an address form, summary cards, token net positions, and a transfers table backed by the APIs above (defaults to the seeded demo address).

## Indexer Notes

- Requires `ETH_RPC_URL` (or `ALCHEMY_HTTP_URL`) to be set to an Ethereum JSON-RPC endpoint (Sepolia or mainnet).
- The worker queries `wallets` by `chain` (default `eth`). Add rows via Prisma/SQL or future auth flows to start ingestion.
- `ETH_LOOKBACK_BLOCKS` controls the initial sync window when no cursor exists; defaults to 5000.
- `RPC_MAX_RETRIES`, `RPC_RETRY_BASE_MS`, and `RPC_RETRY_MAX_MS` tune the exponential backoff for RPC calls (defaults: 5 attempts, 300ms base delay, 4.5s cap).
- `NEXT_PUBLIC_ETHERSCAN_BASE_URL` configures the explorer links in the dashboard (defaults to mainnet `https://etherscan.io`; set to `https://sepolia.etherscan.io` for Sepolia).
- Hourly price enrichment: run `npm run start:prices -w worker` (or schedule it) to fetch USD prices from CoinGecko and populate the `prices` table for the tokens seen on the chain. Free CoinGecko tier supports one token per request, so leave `PRICE_BATCH_SIZE` at `1` unless you supply a Pro API key.

## Contributing

- Run `npm run lint -w web` before opening PRs
- Keep worker scripts idempotent (upserts keyed by `txHash:logIndex`)
- Prefer named queries and validated params for any LLM-facing tools

Questions or ideas? Open an issue or start a discussion in the repo.
