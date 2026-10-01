# couch-kit

> Framework for building local multiplayer TV party games. Host runs on Android TV (React Native/Expo), players join from phones via web client (React/Vite), communication over WebSocket on LAN. An opt-in relay mode lets a browser display own the game instead, with phones joining by room code from any network.

## Monorepo Structure

| Package    | npm Name              | Purpose                                                                                                          |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `core`     | `@couch-kit/core`     | Shared types, protocol definitions, `createGameReducer`, middleware, replay                                      |
| `runtime`  | `@couch-kit/runtime`  | Transport-neutral authoritative state, sessions, authorization, and broadcast scheduling                         |
| `client`   | `@couch-kit/client`   | React hooks for phone web controllers (`useGameClient`, `useServerTime`, `usePreload`, `useDebugPanel`)          |
| `display`  | `@couch-kit/display`  | Browser display host for the cross-network relay (`RelayDisplayHost`)                                            |
| `host`     | `@couch-kit/host`     | React Native TV host (`GameHostProvider`, `useGameHost`, WebSocket server, static file server, asset extraction) |
| `cli`      | `@couch-kit/cli`      | CLI tools (`init`, `bundle`, `simulate`, `replay`, `dev`)                                                        |
| `devtools` | `@couch-kit/devtools` | Debug overlay component for web controllers                                                                      |

Unpublished services (outside the `packages/*` workspace):

| Service                 | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `services/relay`        | Single-process Bun relay — reference implementation and self-host option           |
| `services/relay-worker` | Cloudflare Workers + Durable Objects relay, one DO per room — what production uses |

## Build & Verify

Package manager: **Bun** (pinned to 1.4.2 via `packageManager` field). Never use npm, yarn, or pnpm.

```bash
bun install        # install dependencies
bun run build      # build all packages (core first, then others)
bun run test       # run all package tests
bun run lint       # Prettier formatting check + changeset header lint (no ESLint)
bun run format     # apply Prettier formatting
bun run typecheck  # type-check all packages (core first, then others)
```

Build order: `core` → `runtime` → `client` → `display`, then `host`, `cli`, and `devtools`. The build script handles this automatically.

## Architecture Invariants

- **Host runtime is authoritative.** `@couch-kit/runtime` owns canonical game state; transport adapters deliver full snapshots to clients (or per-player views when the runtime's `project` option is set).
- **`createGameReducer` wraps user reducers.** It handles internal actions (`__HYDRATE__`, `__PLAYER_JOINED__`, `__PLAYER_LEFT__`, `__PLAYER_RECONNECTED__`, `__PLAYER_REMOVED__`). User reducers must NOT handle these directly.
- **Player IDs are deterministic**, derived from the client's session secret via SHA-256. They're stable across reconnections.
- **State broadcasts are throttled**: at most one broadcast per `stateThrottleMs` window (default 33ms, ~30fps), with every change inside the window coalesced into it.
- **WebSocket port = HTTP port + 2** (default 8082) to avoid Metro dev server on 8081.
- **Session recovery**: disconnected players have a 5-minute timeout before `__PLAYER_REMOVED__` fires.
- **Security**: Rate limiting (60 actions/sec), internal action injection prevention, secrets never broadcast.

## Protocol Flow

```
Client → Host: JOIN { name, avatar?, secret }
Host → Client: WELCOME { playerId, state, serverTime }  (new player)
Host → Client: RECONNECTED { playerId, state }          (returning player, instead of WELCOME)
Client → Host: ASSETS_LOADED                            (controller finished preloading)
Client → Host: ACTION { type, payload? }                (game action from player)
Host → Client: STATE_UPDATE { newState, timestamp }     (throttled, one per window)
Client → Host: PING { id, timestamp }                   (time sync)
Host → Client: PONG { id, origTimestamp, serverTime }
Host → Client: ERROR { code, message }
  codes: INVALID_MESSAGE | INVALID_SECRET | ALREADY_JOINED | JOIN_FAILED |
         FORBIDDEN_ACTION | NOT_JOINED | RATE_LIMITED
```

In relay mode the same messages travel inside relay `DATA` envelopes; the relay routes them by room and never inspects them.

## Inter-Package Dependencies

Packages reference each other via `workspace:*` protocol in package.json. The custom `scripts/publish.ts` resolves these to concrete versions before publishing to npm, then reverts after.

**Never change `workspace:*` references** in package.json — the publish script handles version resolution.

## Git Workflow

- Never commit directly to `main`. Always create a feature branch.
- Branch naming: `<type>/<short-description>` (e.g. `fix/host-build-error`, `feat/session-timeout`).
- Every PR that changes package source code must include a changeset: `bun run changeset`
- Workflow-only or config-only changes do NOT need changesets.
- CHANGELOGs are auto-generated — never edit them directly.

## Do NOT

- Handle internal action types (`__HYDRATE__`, `__PLAYER_JOINED__`, etc.) in user reducers
- Edit `CHANGELOG.md` files directly (auto-generated by changesets)
- Change `workspace:*` references in package.json
- Use npm, yarn, or pnpm (Bun only)
- Bundle `react` or `react-native` into library output (they are peer dependencies)

## Consumer Apps

Three apps consume couch-kit via npm:

- [buzz-tv-party-game](https://github.com/faluciano/buzz-tv-party-game) — Buzzer game (starter template)
- [domino-party-game](https://github.com/faluciano/domino-party-game) — Dominican domino (complex, 4 players, teams, bots)
- [card-game-engine](https://github.com/faluciano/card-game-engine) — JSON-driven card game engine

All follow the same pattern: `shared` (reducer + types) → `client` (web UI) → `host` (TV display)

## Testing

Tests use Bun's built-in test runner. Run `bun run test` from root.

Key test files:

- `packages/core/tests/` — reducer, protocol, middleware, replay
- `packages/runtime/tests/` — authoritative state, sessions, authorization, validation, broadcast scheduling
- `packages/client/tests/` — time-sync, debug-panel
- `packages/display/tests/` — relay display host
- `packages/host/tests/` — event-emitter, assets, action-recorder
- `packages/cli/tests/` — CLI commands, bundle manifest
- `packages/devtools/tests/` — debug overlay
- `services/relay/tests/` — relay routing core. Not covered by `bun run test`; these run in the separate `relay` CI job (`bun test` from `services/relay`).

## Release Flow

1. PRs merged to `main` with changesets → CI creates "Version Packages" PR
2. Version PR merged → CI publishes to npm with provenance (OIDC Trusted Publishing, no NPM_TOKEN)
3. After publish → each consumer repo's **Renovate** opens a PR bumping `@couch-kit/*`
4. Each consumer's CI (typecheck + build) gates the PR; patch/minor auto-merge, **major** bumps are held for manual review

Consumers use Renovate (`renovate.json`, scoped to `@couch-kit/*` and grouped into one PR) with auto-merge for minor/patch/digest updates — there is no custom dispatch glue in this repo. Renovate (not Dependabot) is used because Dependabot does not regenerate Bun workspace lockfiles.
