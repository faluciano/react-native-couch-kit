---
"@couch-kit/core": patch
---

**Security:** Derive public player IDs with a real SHA-256 on React Native / Hermes.

`derivePlayerId` hashes the session secret with SHA-256 via the Web Crypto API,
but Hermes (where the host runs) does not expose `crypto.subtle`. The previous
fallback used `derivePlayerIdLegacy`, which simply truncated the secret —
exposing the first half of the raw session token as the public `playerId`
broadcast in game state.

The fallback now uses a dependency-free pure-JS SHA-256 that produces the exact
same digest as `crypto.subtle`, so player IDs are secure and identical across
all host runtimes. `derivePlayerIdLegacy` is retained only for reconnect
migration of players who joined under the old scheme.
