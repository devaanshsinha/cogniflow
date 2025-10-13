# Cogniflow – Project Context & Status

## Vision & Project Plan

- **Goal:** Ship an on-chain intelligence agent that ingests Ethereum wallet activity, normalizes it into Postgres/Supabase, enriches it with prices and semantic embeddings, and exposes the data through a Next.js dashboard plus a deterministic chat/LLM interface.
- **Architecture overview:**\
  `Worker (ts-node)` ⟶ `Supabase Postgres + pgvector` ⟶ `Next.js APIs & UI` ⟶ `User`
- **MVP outcomes (current focus):**
  - Continuous ingestion for tracked Ethereum wallets (idempotent upserts + retry/backoff).
  - REST APIs powering the dashboard and chat tooling (`/api/transfers`, `/api/portfolio`, `/api/search`, `/api/chat`, `/tool/sql`, `/api/healthz`).
  - Production-ready dashboard UI with summary cards, USD valuations, semantic search, and explorer-aware links.
  - Deterministic tooling layer so an LLM orchestrator can call named SQL and semantic search safely.
- **Local workflow note:** All prisma CLI commands, migrations, or shell operations beyond basic package management (`npm install`, `npm uninstall`, etc.) are executed manually by the project owner; automated scripts and documentation should assume manual approval for those steps.
- **Roadmap milestones (completed unless noted):**
  1. **Repo setup & monorepo tooling** – TypeScript workspace (`web`, `worker`) with shared dependencies. ✅
  2. **Database schema** – `prisma/schema.prisma` defines `transfers`, `blocks`, `prices`, `tx_embeddings`, `wallets`, `users`. ✅
  3. **Supabase + Prisma wiring** – `.env.example`, migrations, Prisma client helpers, `/api/healthz`. ✅
  4. **APIs & ingestion** – `/api/transfers`, `/api/portfolio`, resilient worker ingestion loop. ✅
  5. **Dashboard UI** – Tailwind + shadcn-inspired components, summary cards, transfers table, semantic search section. ✅
  6. **Tooling layer** – `/tool/sql` named queries, `/api/chat` intent routing, semantic search integration. ✅
  7. **Price & embeddings enrichment** – CoinGecko job, OpenAI embeddings job, `/api/search` returning USD context. ✅
  8. **Polish & deployment** – UI refinements, cron automation, Vercel deploy, LLM orchestration UX. ⏳ (in progress)

## Repository Structure

```
.
├── README.md                 # Getting started, API references
├── chat.md                   # This context document
├── .env.example              # Environment variables required across packages
├── prisma/
│   ├── schema.prisma         # Data model for Supabase Postgres + pgvector
│   └── migrations/…          # Prisma migrations (pgvector enabled, tables created)
├── web/                      # Next.js 15 app router frontend + API routes
│   ├── app/
│   │   ├── api/              # REST endpoints (transfers, portfolio, chat, search, tool/sql, healthz)
│   │   ├── layout.tsx        # Root layout & metadata
│   │   ├── page.tsx          # Entry page rendering Dashboard component
│   │   └── globals.css       # Tailwind layer directives
│   ├── components/
│   │   ├── dashboard.tsx     # Main UI (cards, transfers table, search panel)
│   │   └── ui/               # shadcn-style primitives (card, button, badge, etc.)
│   ├── lib/
│   │   ├── prisma.ts         # Prisma client singleton for Next.js
│   │   ├── embeddings.ts     # Embedding helper (normalizes vectors to 768 dims)
│   │   └── tools/            # Named SQL query definitions + validation
│   └── package.json
└── worker/
    ├── src/
    │   ├── indexer.ts        # Entry point: iterates wallets, runs ingestion
    │   ├── prisma.ts         # Worker-side Prisma client helper
    │   ├── clients/
    │   │   └── alchemy.ts    # JSON-RPC client with retry/backoff + logging
    │   └── jobs/
    │       ├── updatePrices.ts      # CoinGecko enrichment
    │       └── updateEmbeddings.ts  # OpenAI embeddings batch job
    └── package.json
```

## Data & Ingestion Pipeline

- **Wallet tracking:** `wallets` table stores `address`, `chain`, and ingestion cursors (`lastSyncedBlock`, `lastSyncedAt`). Scripts or Prisma Studio update it when swapping tracked addresses.
- **Indexer (`worker/src/indexer.ts`):**
  - Loads all wallets for the configured `ETH_CHAIN`.
  - Uses `clients/alchemy.ts` to call `alchemy_getAssetTransfers` for both directions within a block window.
  - Upserts `blocks` and `transfers` via Prisma transactions (`syncWalletTransfers.ts`).
  - Handles reorg safety using deterministic IDs (`txHash:logIndex`) and logs progress with pino.
  - Retries RPC calls with exponential backoff (configurable via `RPC_MAX_RETRIES`, `RPC_RETRY_BASE_MS`, `RPC_RETRY_MAX_MS`).
- **Normalization details (`worker/src/ingestion/syncWalletTransfers.ts`):**
  - Converts raw amounts using the provided decimals (stores both `amount_raw` and normalized `amount_dec`).
  - Lowercases addresses, stores `symbol`, `token`, and marks `stale` if needed.
  - Adapts to missing `logIndex` values by deriving them from unique IDs safely.
- **Price enrichment (`worker/src/jobs/updatePrices.ts`):**
  - Collects distinct token contracts per chain from `transfers`.
  - Calls CoinGecko `/simple/token_price` respecting free-tier limits (default 1 contract per request).
  - Upserts hourly snapshots into the `prices` table.
- **Embeddings job (`worker/src/jobs/updateEmbeddings.ts`):**
  - Selects transfers lacking embeddings.
  - Generates descriptive text (amount buckets included) and calls OpenAI `text-embedding-3-small`.
  - Normalizes vectors to 768 dimensions (trunc/pad) to match the `VECTOR(768)` column.
  - Upserts into `tx_embeddings` with accompanying JSON metadata.

## API Surface (Next.js)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/healthz` | GET | Pings Supabase with `SELECT 1`; used for readiness checks. |
| `/api/transfers` | GET | Cursor-paginated transfers for a wallet (`address`, `chain`, `direction`, `limit`, `cursor`). Enriched with USD values + latest price timestamp and sync metadata. |
| `/api/portfolio` | GET | Aggregated stats: total counts, per-token incoming/outgoing/net amounts, USD totals, and wallet sync metadata. |
| `/api/search` | GET | Semantic search over transfers; embeds the query, filters by `address`/`chain`, queries pgvector, enriches with USD pricing, sorts by intent (largest, latest, etc.). |
| `/api/tool/sql` | GET/POST | Exposes allowlisted SQL queries (`topCounterparties`, `netFlowSummary`) with zod validation; used by chat/tooling. |
| `/api/chat` | POST | Intent router for chat-like requests. Supports: \
  • semanticSearch → calls `/api/search` internally \
  • topCounterparties → runs named SQL query \
  • netFlowSummary → runs named SQL query \
  Returns structured payload `{ answer, tables, chart|null, sources, debug }`. |

## Frontend (Dashboard UX)

- **Tech:** Next.js 15 (App Router), Tailwind 4, shadcn-inspired UI primitives.
- **Key component:** `web/components/dashboard.tsx`
  - Address form w/ network picker.
  - Summary cards (total transfers, USD metrics) using compact number formatting.
  - Sync status badge showing latest block + timestamp from `wallets`.
  - Latest transfers table with USD information and explorer links (auto-detected base URL or `NEXT_PUBLIC_ETHERSCAN_BASE_URL` override).
  - Top holdings card list with net units, priced net, and spot price tooltip.
  - Semantic search panel: input triggers `/api/search`, results table shows amounts + USD, sorted according to query intent.
  - UI leverages shared components in `web/components/ui/*` (Card, Table, Button, Input, Badge, helper `cn`).

## Tooling & Chat Orchestration

- **Named queries:** Defined in `web/lib/tools/sqlQueries.ts` with Prisma-backed execution and zod-validated input.
- **Chat handler (`/api/chat/route.ts`):**
  - Parses recent user message.
  - Infers time window (default 7 days) and intent (semantic search vs. counterparty vs. net flow).
  - Uses named SQL tools or semantic search to produce answers and data tables.
  - Future plan: connect to an LLM orchestrator (OpenAI, etc.) that delegates to these tools.

## Background Jobs & Commands

Run from repository root (dotenv config required):

| Command | Description |
|---------|-------------|
| `npm run start -w worker` | Launch ingestion loop (fetch transfers & update cursors). |
| `npm run start:prices -w worker` | Run CoinGecko price snapshot job. |
| `npm run start:embeddings -w worker` | Generate embeddings for new transfers. |
| `npm run dev -w web` | Start Next.js app on `http://localhost:3000`. |
| `npm run lint -w web` | ESLint check for frontend (passes after latest changes). |
| `npx prisma studio` | Inspect/edit Supabase tables (uses `DATABASE_URL`). |
| `npx prisma migrate deploy` | Apply migrations to Supabase (uses `DIRECT_URL`). |

## Environment Variables (see `.env.example`)

- **Supabase / Prisma:** `DATABASE_URL`, `DIRECT_URL`
- **Supabase Auth (frontend):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Explorer:** `NEXT_PUBLIC_ETHERSCAN_BASE_URL` (optional override per network)
- **RPC & ingestion:** `ETH_CHAIN`, `ETH_RPC_URL`, `ETH_LOOKBACK_BLOCKS`, `RPC_MAX_RETRIES`, `RPC_RETRY_BASE_MS`, `RPC_RETRY_MAX_MS`
- **CoinGecko:** `COINGECKO_API_KEY` (optional), `PRICE_CHAIN`, `PRICE_BATCH_SIZE`
- **OpenAI embeddings:** `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional), `EMBEDDING_MODEL`, `EMBEDDING_BATCH_SIZE`, `EMBEDDING_DIM`
- **Logging:** `LOG_LEVEL` (`info` by default)

## Current Status (Oct 2025)

- **Data:** Ingestion tested against Sepolia and mainnet addresses (e.g. `0x7116…e74c`). Transfers, prices, embeddings populate successfully.
- **APIs:** `/api/transfers`, `/api/portfolio`, `/api/search`, `/tool/sql`, `/api/chat` are live and returning enriched data.
- **UI:** Dashboard renders real wallets, holdings cards display price info, the chat panel calls `/api/chat` to display answers (including tables, sources, and chart placeholders), and users authenticate via dedicated `/signin` and `/signup` flows (email/password or Google OAuth) before accessing data. Direct semantic search is exposed via the API and leveraged by the chat flow.
- **LLM tooling:** Deterministic endpoints ready; full chat orchestration (agent / UI conversation) still to be finalized.
- **Deployment:** Web app is deployed on Vercel (env vars + Prisma generate handled in build). Worker logic is shared with the Next.js app; `/api/ingest`, `/api/prices`, and `/api/embeddings` expose the jobs behind an `INGESTION_SECRET`. Vercel cron wiring and UI-triggered refresh remain.

## Pending / Next Steps

1. **Worker Automation**
   - Schedule periodic runs with Vercel Cron (or GitHub Actions/Render) to call `/api/ingest`, `/api/prices`, and `/api/embeddings` with the `INGESTION_SECRET`.
   - Add on-demand wallet refresh in the dashboard by POSTing to `/api/ingest`.
   - Layer in monitoring/log aggregation once cron hooks are live.
2. **Chat & UI Enhancements**
   - Build chat interface in the dashboard that consumes `/api/chat`.
   - Add support for more named queries (top tokens, gas analysis, net positions in USD).
   - Display semantic search matches inside chat responses.
3. **Authentication & User management**
   - Integrate Supabase Auth (email/GitHub magic links).
   - Persist user-specific wallets, chat history, and saved settings.
   - Surface login/logout UI in the dashboard.
4. **Analytics & Visuals**
   - Charts (e.g. net flow over time, counterparties bar charts).
   - Saved addresses / multi-wallet management.
5. **Resilience & Testing**
   - Add integration tests for API routes.
   - Improve retry/backoff metrics (logging, alerts).
   - Consider caching frequently accessed results.
6. **Stretch goals (from original plan)**
   - Multi-chain support (Polygon/Base, Solana via Helius).
   - Discord/email summaries, alerts, CSV exports.
   - LLM guardrails, tool auditing.

## How to Talk About the Project

> “Cogniflow ingests Ethereum wallet activity into Supabase, enriches it with CoinGecko pricing and OpenAI embeddings, and exposes the data via deterministic APIs and a Next.js dashboard. A ts-node worker ensures idempotent ingestion with retry/backoff, while pgvector enables semantic search and natural-language chat tooling. The UI presents live portfolio stats, transfers, and semantic patterns with shadcn-inspired components, and the REST endpoints provide safe entry points for a future LLM agent.”

## Advanced Search & Analytics Ideas (post-MVP roadmap)

- **Counterparty intelligence:** per-address summaries, top recurring counterparties, first/last interaction dates, tagging exchanges/bridges, clustering related wallets.
- **Protocol context:** decode method IDs, label protocols/pools, surface NFT interactions, flag known entities (MEV relays, Tornado Cash, notable contracts).
- **Token analytics:** largest positions, stablecoin vs volatile exposure, per-token PnL, liquidity-provider activity, approvals/wrap/unwrapped balances.
- **Cash-flow patterns:** cadence (daily/weekly), burst detection, recurring payments, balance trough/peak timelines, active vs dormant periods.
- **Gas/cost breakdown:** total fees, average gas price, burn vs priority fee, failed tx counts, comparisons across counterparties or protocols.
- **Risk/compliance:** sanctioned address proximity, tornado/rug exposure, dusting/new-address detection, bridge anomalies.
- **Rule-based filters:** thresholds (“transfers > $100k”), direction filters, token/protocol filters, custom watchlists.
- **Strategy detection:** arbitrage loops, sandwich victimization, staking cycles, repeated strategy patterns.
- **Cross-chain awareness:** identify bridge flows, track mirrored activity on other networks.
- **UX upgrades:** saved searches, query filters/chips, compare two wallets, highlight “new since last run”, natural-language synonyms.

## Quick Reference (files & responsibilities)

- **worker/src/indexer.ts** – main loop; ensures wallets stay current.
- **shared/ingestion/syncWalletTransfers.ts** – normalization + Prisma upserts shared by worker and API routes.
- **shared/clients/alchemy.ts** – RPC client (retries, logging safeguards).
- **shared/jobs/updatePrices.ts** – CoinGecko enrichment logic (worker + API reuse).
- **shared/jobs/updateEmbeddings.ts** – OpenAI embedding generation + vector writes.
- **worker/src/jobs/updatePrices.ts** – CLI wrapper for the shared price updater.
- **worker/src/jobs/updateEmbeddings.ts** – CLI wrapper for the shared embedding job.
- **web/app/api/transfers/route.ts** – paginated transfers, returns USD + sync.
- **web/app/api/portfolio/route.ts** – aggregated stats, holdings, valuations.
- **web/app/api/search/route.ts** – semantic search with USD awareness.
- **web/app/api/chat/route.ts** – intent router for chat/tooling.
- **web/app/api/ingest/route.ts** – secure ingestion trigger; loops wallets & calls `syncWalletTransfers`.
- **web/app/api/prices/route.ts** – secure price updater calling CoinGecko via shared job.
- **web/app/api/embeddings/route.ts** – secure embeddings generator using shared OpenAI job.
- **web/lib/tools/sqlQueries.ts** – named SQL queries & executors.
- **web/lib/supabase/** – browser/server client helpers for Supabase Auth.
- **web/components/providers/supabase-provider.tsx** – wraps the app with Supabase session context.
- **web/components/dashboard.tsx** – entire dashboard UI (address form, cards, tables, search).
- **web/components/ui/** – reusable shadcn-style components.
- **web/app/signin/page.tsx, web/app/signup/page.tsx** – standalone authentication views.
 - **Deployment / Cron** – schedule Vercel Cron (or external) to hit `/api/ingest`, `/api/prices`, `/api/embeddings` with the shared secret; follow up with UI-driven on-demand ingestion.

---

Keep this file updated as you add features or change architecture—future contributors can ramp quickly by reading `chat.md` first.
