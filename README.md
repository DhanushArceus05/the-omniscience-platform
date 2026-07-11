# The Omniscience Platform

**One Platform. Every Intelligence.**

This is the monorepo for The Omniscience Platform. This repository currently
implements **Phase 0 — Foundation** only. See `claude/CURRENT_PHASE.md` and
`docs/08_Development_Roadmap.md` for what comes next.

## What's in Phase 0

- pnpm workspace + Turborepo monorepo
- `apps/web` — React + Vite + strict TypeScript (foundation shell + health panel)
- `apps/api` — NestJS + strict TypeScript (health endpoint, structured logging, global error handling)
- `apps/ai-service` — FastAPI + typed Python (health endpoint, structured logging, global error handling)
- Shared packages: `ui`, `types`, `schemas`, `config`, `sdk`, `prompts`, `utils`
- Docker Compose for PostgreSQL, MongoDB, Redis and Qdrant
- Environment validation (`packages/config` for Node, `app/core/config.py` for Python) + `.env.example`
- ESLint + Prettier + strict TypeScript across the Node workspace; Ruff + Mypy (strict) for Python
- Starter tests for every app and package
- GitHub Actions CI (install, lint, typecheck, test, build)

**Explicitly excluded from Phase 0** (per `claude/PHASE_0_MASTER_PROMPT.md`):
authentication, OTP, workspaces, AI provider integration, OmniCore, RAG, agents,
ML modules, and final premium UI screens.

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (via Corepack: `corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Python >= 3.11
- Docker + Docker Compose (for local Postgres/MongoDB/Redis/Qdrant)

## Setup

```bash
# 1. Clone and enter the repo
git clone <repo-url> omniscience-platform
cd omniscience-platform

# 2. Copy environment variables
cp .env.example .env
# edit .env with real values (never commit .env)

# 3. Enable pnpm and install Node dependencies
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install

# 4. Start infrastructure (Postgres, MongoDB, Redis, Qdrant)
docker compose up -d

# 5. Set up the Python AI service
cd apps/ai-service
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cd ../..
```

## Running the apps

```bash
# Web app (Vite dev server on :5173)
pnpm --filter @omniscience/web dev

# API (NestJS on :4000)
pnpm --filter @omniscience/api dev

# AI service (FastAPI on :8000)
cd apps/ai-service && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

## Common workspace commands

```bash
pnpm -r build       # build every Node app/package
pnpm -r lint         # lint every Node app/package
pnpm -r typecheck    # strict TypeScript typecheck everywhere
pnpm -r test         # run every Node test suite (vitest / jest)
pnpm format          # format the whole repo with Prettier
```

```bash
# Python (from apps/ai-service, with .venv activated)
ruff check .          # lint
mypy app               # strict typecheck
pytest                 # run tests with coverage
```

## Health checks

Once running:

- Web: http://localhost:5173
- API health: http://localhost:4000/health
- AI service health: http://localhost:8000/health

Each returns:

```json
{
  "status": "ok",
  "service": "api",
  "version": "0.1.0",
  "timestamp": "2026-07-11T12:00:00.000Z",
  "uptimeSeconds": 12.34
}
```

## Repository layout

```
apps/
  web/           React + Vite + TypeScript
  api/           NestJS + TypeScript
  ai-service/    FastAPI + Python
packages/
  ui/            Shared React UI primitives
  types/         Shared TypeScript types (dual CJS/ESM build)
  schemas/       Shared zod runtime validation schemas
  config/        Environment validation (Node)
  sdk/           Typed HTTP client for the platform's services
  prompts/       Prompt template registry (structural scaffold, populated in Phase 6)
  utils/         Result type, structured logger factory
docs/            Approved planning documents (vision, SRS, architecture, roadmap, ...)
claude/          Claude context, current phase, and phase master prompts
```

## Architecture rules (see `docs/09_Claude_Development_Rules.md`)

- Implement only the current approved phase.
- Business logic requests capabilities, never vendor names (`OmniProvider` rule).
- Strict TypeScript; no unjustified `any`.
- No placeholders, hardcoded secrets, or silent failures.
- Every service boundary and AI output must be validated.
