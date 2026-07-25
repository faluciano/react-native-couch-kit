---
"@couch-kit/display": minor
---

**New features**

- New `@couch-kit/display` package. `RelayDisplayHost` owns the authoritative
  `GameHostRuntime` in a browser tab and bridges it to a game-agnostic relay,
  enabling cross-network play where phones on different networks join by room
  code. Framework-agnostic (`subscribe` / `getState` / `dispatch` / `stop`);
  promoted from the in-repo reference example so games no longer vendor it.
