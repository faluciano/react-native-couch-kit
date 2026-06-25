---
"@couch-kit/client": patch
---

Simplify session-secret recovery in the game client to remove a redundant variable initializer. Behavior is unchanged: an existing `ck_secret` is reused, a new one is generated and persisted when absent, and a fresh secret is generated when `localStorage` is unavailable.
