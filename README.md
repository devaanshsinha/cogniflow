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
- `npm run dev -w web` to launch the Next.js app at http://localhost:3000
- `npm run start -w worker` to boot the indexer (currently logs a stub message)
- Copy `.env.example` (coming soon) to `.env` with Supabase, RPC, and OpenAI keys

## Development Milestones
- ✅ Day 1: Monorepo scaffolding, Next.js app, worker boot sequence
- ⏳ Day 2–3: Prisma schema, Supabase wiring, portfolio and transfers APIs
- ⏳ Day 4–5: Dashboard UI, chat endpoint, named SQL tool execution
- 🕸️ Later: pgvector search, Solana module, email/Discord summaries

## Contributing
- Run `npm run lint -w web` before opening PRs
- Keep worker scripts idempotent (upserts keyed by `txHash:logIndex`)
- Prefer named queries and validated params for any LLM-facing tools

Questions or ideas? Open an issue or start a discussion in the repo.
