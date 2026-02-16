# Copilot Instructions — couch-kit

## Project Overview

couch-kit is a framework for building TV party games. The host runs on Android TV (React Native/Expo), players join from phones/tablets via a web client (React/Vite). Communication happens over WebSocket on the local network.

## Monorepo Structure

4 packages under `packages/`, managed with Bun workspaces:

| Package  | npm Name            | Purpose                                                                                           |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `core`   | `@couch-kit/core`   | Shared types, protocol definitions, `createGameReducer`                                           |
| `client` | `@couch-kit/client` | Web SDK — `CouchKitProvider`, `useCouchKit()`, `useServerTime()`, `useAssets()`                   |
| `host`   | `@couch-kit/host`   | Android TV SDK — `GameHostProvider`, `useRoom()`, `usePlayers()`, `useGameState()`, `useAssets()` |
| `cli`    | `@couch-kit/cli`    | CLI tooling — `couch-kit bundle` bundles web client into Android assets                           |

## Build Order

`core` must build first — all other packages depend on it:

```bash
bun run build    # builds core first, then others in parallel
bun run typecheck # typechecks core first, then others
```

## Key Architectural Invariants

- **Host is authoritative.** The host runs the canonical game state. Clients receive full state snapshots (not diffs).
- **`createGameReducer` wraps user reducers.** It handles internal actions (`__HYDRATE__`, `__PLAYER_JOINED__`, `__PLAYER_LEFT__`, `__PLAYER_RECONNECTED__`, `__PLAYER_REMOVED__`). User reducers must NOT handle these directly.
- **Player IDs are deterministic**, derived from the client's session secret. They're stable across reconnections.
- **State broadcasts are throttled** to ~30fps (configurable via `stateThrottleMs`).
- **WebSocket port = HTTP port + 2** (default 8082) to avoid Metro dev server on 8081.
- **Session recovery**: disconnected players have a 5-minute timeout before `__PLAYER_REMOVED__` fires.

## Protocol Flow

```
Client → Host: JOIN { name, avatar, secret }
Host → Client: WELCOME { playerId, state, serverTime }
Host → Client: STATE_UPDATE { state }  (on every state change, throttled)
Host → Client: PING { serverTime }     (heartbeat + time sync)
Client → Host: PONG { clientTime, serverTime }
Client → Host: ACTION { action }       (game actions from player)
Host → Client: ERROR { code, message } (INVALID_MESSAGE | INVALID_SECRET | FORBIDDEN_ACTION)
```

## Inter-Package Dependencies

Packages reference each other via `workspace:*` protocol in package.json. The custom `scripts/publish.ts` resolves these to concrete versions before publishing to npm, then reverts after.

**Never change `workspace:*` references** in package.json — the publish script handles version resolution.

## Package Manager

**Bun** (pinned to 1.2.19 via `packageManager` field). Do NOT use npm, yarn, or pnpm.

## Changesets

- Every PR that changes package source code must include a changeset: `bun run changeset`
- Workflow-only or config-only changes do NOT need changesets
- CHANGELOGs are auto-generated — never edit them directly
- Version bumps happen via the "Version Packages" PR created by CI

## Testing

```bash
bun run test      # runs tests across all packages
bun run lint      # lints all packages
bun run typecheck # typechecks all packages
```

## Release Flow

1. PRs merged to `main` with changesets → CI creates "Version Packages" PR
2. Version PR merged → CI publishes to npm with provenance
3. After publish → issues auto-created in consumer apps (domino, buzz) assigned to Copilot

## Consumer Apps

Two apps consume couch-kit via npm:

- [domino-party-game](https://github.com/faluciano/domino-party-game) — Dominican domino (complex, 4 players, teams, bots)
- [buzz-tv-party-game](https://github.com/faluciano/buzz-tv-party-game) — Buzzer game (starter template)

Both follow the same pattern: `shared` (reducer + types) → `client` (web UI) → `host` (TV display)
