# @party-kit/cli

Developer tooling for React Native Party Kit.

> **Starter Project:** See [Buzz](https://github.com/faluciano/buzz-tv-party-game) for a complete example that uses the CLI to bundle its web controller.

## Installation

```bash
bun add -d @party-kit/cli
```

## Commands

### `init`

Scaffolds a new web controller project (Vite + React + TypeScript) configured to work with Party Kit.

```bash
bunx party-kit init web-controller
```

### `bundle`

Builds the web controller and copies the assets into your Android project's `assets/www` folder. This is used when preparing your TV app for release.

```bash
# Default (looks for ./web-controller and copies to android/app/src/main/assets/www)
bunx party-kit bundle

# Custom paths
bunx party-kit bundle --source ./my-web-app --output ./android/app/src/main/assets/www
```

### `simulate`

Spawns headless WebSocket bots to simulate players (useful for load testing and quick iteration).

```bash
# Default: 4 bots, ws://localhost:8082
bunx party-kit simulate

# Custom host + count
bunx party-kit simulate --url ws://192.168.1.99:8082 --count 8

# Action interval (ms)
bunx party-kit simulate --interval 250
```
