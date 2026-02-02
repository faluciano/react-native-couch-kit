# @party-kit/cli

Developer tooling for React Native Party Kit.

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
