---
"@couch-kit/core": patch
---

`replayActions` wraps the reducer it is given with `createGameReducer`. A recording that contains internal actions (`__PLAYER_JOINED__` and the others a host recorder captures) now replays the way it ran. Before, those actions were silently ignored, because a game's own reducer does not handle them. Passing a reducer that is already wrapped is harmless.
