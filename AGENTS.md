# AGENTS.md

## Commands

```bash
pnpm dev          # Run dev server (tsx, no build step)
pnpm build        # Compile TypeScript to dist/ (tsc)
pnpm start        # Build then run from dist/
pnpm lint         # Lint with oxlint
pnpm lint:fix     # Lint and auto-fix
pnpm format       # Prettier (with import sort plugin)
```

## Project Type

- **ESM** (`"type": "module"` in package.json)
- **SINGLE package** — `pnpm-workspace.yaml` exists only for esbuild allow-list; this is NOT a monorepo
- **pnpm 10+** as package manager
- Entrypoint: `src/index.ts` — initializes TCP game server connection, then starts Hono HTTP server on `PORT` (default 3000)

## TypeScript Gotchas

- Imports MUST use `.js` extension even though sources are `.ts` (NodeNext module resolution)
- `verbatimModuleSyntax` is enabled — use `import type` for type-only imports, not `import { type Foo }`
- `isolatedModules: true` — no enums merging, no namespace exports
- `strict: true`, `noUncheckedIndexedAccess: true`

## Lint & Format

- **oxlint** (not ESLint) for linting
- **Prettier** with `@trivago/prettier-plugin-sort-imports` — imports are auto-sorted on format
- Single quotes, semicolons, 80-char print width

## Env Config

- `.env` files are **gitignored** (pattern: `.env.*`)
- On Windows, `.env.development` is loaded **before** `.env` (so `.env` wins for shared keys)
- Required env: `SERVICE_ACCOUNT_ID`, `SERVICE_ACCOUNT_PASSWORD` — server prints warnings if unset but still starts

## Architecture

```
src/index.ts          — bootstrap: tcpService.init() then HTTP server
src/config/config.ts   — env loading + Settings export
src/core/              — encryption + login logic
src/pkg/               — TCP packet send/receive
src/services/tcpService.ts — TCP connection lifecycle (connect, heartbeat, reconnect)
src/services/httpServer/   — Hono app, routes, controllers
src/utils/             — helpers: http, packet building, webhook, etc.
```

## Testing

No test framework or test files exist in this repo.

## Key Runtime Behaviors

- TCP connection auto-reconnects with exponential backoff (4s–30s, max 10 attempts)
- Heartbeat every 5 minutes (cmd 2157)
- Before reconnecting, checks `http://unity-notice.61.com/unity_notice/` for maintenance status
- Sends Feishu webhook alert on reconnect failure (if `FEISHU_WEBHOOK_URL` is configured)
- `sendAndReceive` auto-retries once if socket disconnect is detected
