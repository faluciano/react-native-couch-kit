---
"@couch-kit/core": patch
"@couch-kit/runtime": patch
---

A player who rejoins under a new name or avatar is renamed. `__PLAYER_RECONNECTED__` now carries the rejoining JOIN's `name` and `avatar`, and the reducer applies them. Before, a reconnect kept the old name, so "change name" in a controller did nothing. Recordings without them replay as before.
