---
"@couch-kit/cli": patch
---

Fix the CLI under Node.

- `couch-kit simulate` defaulted to `ws://localhost:8082`, without the `/ws` path the host listens on, so bots could not connect. Defaults now have one source of truth and proxy commands no longer override sub-command defaults.
- `couch-kit replay` crashed with "Bun is not defined"; it now uses Node APIs and imports the reducer by file URL.
- The package is marked `"type": "module"` (the bundle is ESM) and declares Node >= 22, which `simulate`'s use of the global `WebSocket` already required.
- `couch-kit init` scaffolds current dependencies: `@couch-kit/client` and `@couch-kit/core` at `latest` (core was imported but not declared) and a Vite version compatible with the React plugin.
