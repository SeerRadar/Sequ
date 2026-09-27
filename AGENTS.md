# AGENTS.md

## Commands

```bash
pnpm dev          # Run dev server (tsx — NO typecheck, just runs TS)
pnpm build        # Compile TypeScript to dist/ (tsc — this IS your typecheck)
pnpm start        # Build then run from dist/
pnpm lint         # Lint with oxlint (linter only, no typecheck)
pnpm lint:fix     # Lint and auto-fix
pnpm format       # Prettier on src/ only (with import sort plugin)
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
- **Region selection**: one process logs into exactly one region, chosen by `REGION` (`cn` | `tw`, default `cn`)
  - 大陆服 account: `SERVICE_ACCOUNT_ID` + `SERVICE_ACCOUNT_PASSWORD`
  - 台服 account: `TW_SERVICE_ACCOUNT_ID` + `TW_SERVICE_ACCOUNT_PASSWORD`
  - Startup exits with an error when `REGION` is neither `cn` nor `tw`, or when the selected region's account is missing
- `GAME_SERVER_HOST` / `GAME_SERVER_PORT` only override the **大陆服** fallback game server;
  `config.ts` applies that override and exports the resolved table as `settings.regionProfile`
  (callers read the profile, never `PROFILES` directly)

## Architecture

```
src/index.ts                  — bootstrap: validate config → tcpService.init() → HTTP server
src/config/config.ts          — env loading + Settings export (resolved region profile + account)
src/game/                     — game-server TCP communication domain
  region.ts                   — per-region profiles (gate URL, server ID range, channel, notice URL)
  device.ts                   — device platform name used by cmd 103 / cmd 1001
  crypto.ts                   — result (序列号) algorithm (Algorithms)
  bootstrap/                  — login bootstrap
    gate.ts                   — resolve login gate address list
    session.ts                — session acquisition (CN: account HTTP API / TW: gate cmd 103)
    serverList.ts             — cmd 106 server enumeration
    login.ts                  — cmd 1001 game-server login
  packet/                     — binary packet codec primitives, command dict, Command.json
  transport/                  — sender/receiver engine over the socket
    rawRequest.ts             — single request/response over a bare socket (bootstrap only)
  queue.ts                    — serial request queue (single-flight game access)
  maintenance.ts              — unity maintenance-notice probe
  client.ts                   — TCPService lifecycle: tcpService singleton (connect, heartbeat, reconnect)
src/api/                      — Hono HTTP layer: app.ts, routes.ts, controllers/, helpers/
                                (reply + account validation)
src/notifications/feishu.ts   — Feishu webhook alerting
```

## Region Differences

- Same packet format, command dict and result algorithm for both regions; only constants differ
- **Session acquisition**: 大陆服 uses the account HTTP JSONP API; 台服 has no equivalent HTTP API and
  must use `cmd 103 MAIN_LOGIN_IN` on the login gate (plus `cmd 111` ban check and `cmd 109` role check,
  matching the official client)
- 大陆服 server IDs 1800–1900, 台服 1700–1799 (test server 1990 excluded)
- 台服 requires a **numeric** 米米号
- Notice feeds differ: 台服 serializes `type` as a string, so it is coerced with `Number()`
- See `src/game/region.ts` for the region profile table

## Testing

No test framework or test files exist in this repo.

## Key Runtime Behaviors

- TCP connection auto-reconnects with exponential backoff (4s–30s, max 10 attempts)
- Heartbeat every 5 minutes (cmd 2157, args = `[count, ...accountId]`)
- Before reconnecting, probes the region's notice URL for maintenance status
- Sends Feishu webhook alert on reconnect failure (if `FEISHU_WEBHOOK_URL` is configured)
- `sendAndReceive` auto-retries once if socket disconnect is detected
- `result` sequence number: cmd > 1000 packets carry a value derived from the previous
  `result` + body; cmd ≤ 1000 packets always send 0 and do **not** advance. Responses to
  cmd 1001 / 41463 / 42387 resync the baseline (set by the receiver, read by the sender)
- `result > 1000` marks an error packet (logged, not turned into a request failure)
- `MAX_PACKET_SIZE` mirrors the client's `PACKAGE_MAX` (8 MiB)

## Protocol reference

The 大陆服 Unity client is decompiled to C# at `../seer-unity/seer-unity-game-logic-dll/src/GameLogic/`
(CDN pull + dnSpy, refreshed weekly). Every packet constant here was cross-checked against it —
when touching protocol code, check these files instead of guessing:

- `socket/SocketEncryptImpl.cs` — header layout (17 bytes), framing, result algorithm (`packHead`),
  baseline commands and `PACKAGE_MAX` (`parseData`)
- `socket/SocketConnectionHelper.cs` — `result > 1000` ⇒ error callback, else cmd callback
- `core/manager/OnlineManager.cs` — cmd 1001 / cmd 41463 field lists
- `core/manager/LoginManager.cs` — cmd 103 field list, `testServerIdList`, cmd 106 / 105 calls
- `core/model/ServerInfo.cs`, `RangeSvrInfo.cs`, `AllSvrListInfo.cs` — cmd 106 / 105 record layout
- `core/GameInfo.cs` — gate URL variants, default gate list, notice URL, `versionCode` encoding

Open question: the client's cmd 103 sends the password padded to 32 bytes (`LoginManager.login(uid, password, …)`),
while our 台服 path sends `md5(md5(password))` hex taken from the 台服 client. Re-check against the
台服 DLL before changing it.
