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
- `GET /api/transfers?address=0x...&chain=eth&direction=all&limit=50&cursor=...` – paginated transfers for a wallet
- `GET /api/portfolio?address=0x...&chain=eth&days=7` – aggregated balances and counters for the last N days

## Frontend

- Dashboard page includes an address form, summary cards, token net positions, and a transfers table backed by the APIs above (defaults to the seeded demo address).

## Indexer Notes

- Requires `ETH_RPC_URL` (or `ALCHEMY_HTTP_URL`) to be set to an Ethereum JSON-RPC endpoint (Sepolia or mainnet).
- The worker queries `wallets` by `chain` (default `eth`). Add rows via Prisma/SQL or future auth flows to start ingestion.
- `ETH_LOOKBACK_BLOCKS` controls the initial sync window when no cursor exists; defaults to 5000.

## Contributing

- Run `npm run lint -w web` before opening PRs
- Keep worker scripts idempotent (upserts keyed by `txHash:logIndex`)
- Prefer named queries and validated params for any LLM-facing tools

Questions or ideas? Open an issue or start a discussion in the repo.
