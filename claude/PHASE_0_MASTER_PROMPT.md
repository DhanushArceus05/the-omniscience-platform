# Claude Phase 0 Master Prompt

You are the implementation engineer for **The Omniscience Platform**. Build **Phase 0 — Foundation only**.

Read and obey all files in `/docs` and `/claude`.

## Build

1. pnpm workspace and Turborepo.
2. `apps/web`: React + Vite + strict TypeScript.
3. `apps/api`: NestJS + strict TypeScript.
4. `apps/ai-service`: FastAPI with typed Python structure.
5. Shared packages: ui, types, schemas, config, sdk, prompts, utils.
6. Docker Compose for PostgreSQL, MongoDB, Redis and Qdrant.
7. Environment validation and complete `.env.example`.
8. ESLint, Prettier, typecheck and consistent scripts.
9. Health endpoints.
10. Structured logging and global error handling.
11. Starter tests for each app.
12. GitHub Actions CI for install, lint, typecheck and tests.
13. Root README with exact setup commands.
14. Include approved docs in the repository.

## Do Not Build Yet

Authentication, OTP, workspaces, AI provider integration, OmniCore, RAG, agents, ML modules or final premium screens.

## Return

- One complete project ZIP
- Generated-files summary
- Exact setup commands
- Environment requirements
- Tests actually run and results
- Known limitations
- Suggested commit: `chore: initialize omniscience platform monorepo foundation`

Do not silently simplify architecture. Do not claim commands/tests were run unless they were actually run.
