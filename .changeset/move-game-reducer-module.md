---
"@couch-kit/core": patch
---

Move `createGameReducer` and `CreateGameReducerOptions` from `types.ts` into a dedicated `reducer.ts` module. This is an internal refactor — the public API is unchanged (both remain exported from `@couch-kit/core`) and runtime behaviour is identical. It also removes a circular import between `types.ts` and `middleware.ts`.
