# @party-kit/cli

Developer tooling for React Native Party Kit.

## Installation

```bash
bun add -d @party-kit/cli
```

## Commands

### `init`

Scaffolds a new web controller project (Vite + React + TypeScript).

```bash
bunx party-kit init my-controller
```

### `bundle`

Builds the web controller and copies the assets into your Android project's `assets/www` folder.

```bash
# Default (looks for ./web-controller)
bunx party-kit bundle

# Custom paths
bunx party-kit bundle --source ./my-web-app --output ./android/app/src/main/assets/www
```

### `simulate`

Spawns headless "bot" players to stress-test your game logic or test multiplayer scenarios without multiple devices.

```bash
# Spawn 4 bots
bunx party-kit simulate --count 4

# Spawn 50 bots connecting to a specific IP
bunx party-kit simulate --count 50 --url ws://192.168.1.5:8081
```
