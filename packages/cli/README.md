# @couch-kit/cli

Developer tooling for Couch Kit.

> **Starter Project:** See [Buzz](https://github.com/faluciano/buzz-tv-party-game) for a complete example that uses the CLI to bundle its web controller.

## Installation

```bash
bun add -d @couch-kit/cli
```

## Commands

### `init`

Scaffolds a web controller project (Vite + React + TypeScript) to add to an existing host app. This creates only the phone/tablet side — for a full game project (host + client + shared), clone the [Buzz starter](https://github.com/faluciano/buzz-tv-party-game).

```bash
bunx couch-kit init web-controller
```

### `bundle`

Builds the web controller and copies the assets into your Android project's `assets/www` folder, along with a `manifest.json` listing all files. This manifest is used by `useExtractAssets()` on the host to extract assets at runtime.

```bash
# Default (looks for ./web-controller and copies to android/app/src/main/assets/www)
bunx couch-kit bundle

# Custom paths
bunx couch-kit bundle --source ./my-web-app --output ./android/app/src/main/assets/www
```

Output structure:

```
android/app/src/main/assets/www/
├── manifest.json       ← import this in your host app
├── index.html
├── assets/
│   └── ...
```

### `simulate`

Spawns headless WebSocket bots to simulate players (useful for load testing and quick iteration).

```bash
# Default: 4 bots, ws://localhost:8082
bunx couch-kit simulate

# Custom host + count
bunx couch-kit simulate --url ws://192.168.1.99:8082 --count 8

# Action interval (ms)
bunx couch-kit simulate --interval 250
```

### `replay`

Replays a recorded game session against a reducer, validating state transitions. Useful for debugging, regression testing, and reproducing bugs from recordings captured with `useActionRecorder`.

```bash
# Replay a recording against your reducer
bunx couch-kit replay ./session.json ./shared/reducer.ts

# With intermediate state snapshots
bunx couch-kit replay ./session.json ./shared/reducer.ts --snapshots

# JSON output (for piping to other tools)
bunx couch-kit replay ./session.json ./shared/reducer.ts --json
```

The reducer module must export a `default` or a named `reducer` function. If your shared file exports `gameReducer`, add a re-export:

```ts
// shared/reducer.ts (or any entry point for replay)
export { gameReducer as default } from "./types";
```

### `dev`

Starts a Vite dev server on the LAN so phones can load the controller from your laptop during development.

```bash
# Default: port 5173, exposed to LAN
bunx couch-kit dev

# Custom port
bunx couch-kit dev --port 3000
```

Prints the LAN URL (e.g., `http://192.168.1.50:5173`) so you can pass it as `devServerUrl` to `GameHostProvider`. Requires `vite` as a dev dependency in your web controller project.
