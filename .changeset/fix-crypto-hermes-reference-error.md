---
"@couch-kit/core": patch
---

Access `crypto` via `globalThis.crypto` to avoid `ReferenceError` in React Native's Hermes engine where `typeof crypto` throws instead of returning `"undefined"`. Fixes `derivePlayerId` and `generateId` on Android TV.
