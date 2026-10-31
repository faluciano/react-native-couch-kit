---
"@couch-kit/runtime": minor
---

**Security:** A player can no longer join as someone else. A JOIN used to fall back to a "legacy" player ID made from the first 16 characters of the secret. Player IDs are public (they key `state.players`, which every client receives), so a client could send a secret that starts with another player's ID, get `RECONNECTED` as that player with their projected view, and act as them. The runtime now maps a secret only to its SHA-256 player ID. The `derivePlayerIdLegacy` option of `HostSessionManager` is removed.

**Security:** Errors thrown by game code no longer escape the runtime. A reducer that throws on a player's action leaves the state unchanged and is reported through `onError`. A `project` that throws for one player skips only that player's update, where it used to throw from the broadcast timer and lose the update for everyone. A state subscriber that throws no longer stops state from being broadcast. A failed JOIN is reported through `onError` as well as answered with `JOIN_FAILED`.
