# @couch-kit/cli

Developer tooling for Couch Kit.

> **Starter Project:** See [Buzz](https://github.com/faluciano/buzz-tv-party-game) for a complete example that uses the CLI to bundle its web controller.

## Installation

```bash
bun add -d @couch-kit/cli
```

## Commands

### `init`

Scaffolds a new web controller project (Vite + React + TypeScript) configured to work with Couch Kit.

```bash
bunx couch-kit init web-controller
```

### `bundle`

Builds the web controller and copies the assets into your Android project's `assets/www` folder. This is used when preparing your TV app for release.

```bash
# Default (looks for ./web-controller and copies to android/app/src/main/assets/www)
bunx couch-kit bundle

# Custom paths
bunx couch-kit bundle --source ./my-web-app --output ./android/app/src/main/assets/www
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

The reducer module must export a default or named `reducer` function.

### `dev`

Starts a Vite dev server on the LAN so phones can load the controller from your laptop during development.

```bash
# Default: port 5173, exposed to LAN
bunx couch-kit dev

# Custom port
bunx couch-kit dev --port 3000
```

Prints the LAN URL (e.g., `http://192.168.1.50:5173`) so you can pass it as `devServerUrl` to `GameHostProvider`. Requires `vite` as a dev dependency in your web controller project.
