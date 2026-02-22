---
"@couch-kit/core": patch
---

Fall back to legacy player ID derivation when `crypto.subtle` is unavailable (React Native / Hermes). Previously, `derivePlayerId` unconditionally called `crypto.subtle.digest("SHA-256", ...)` which threw in Hermes, silently preventing the JOIN handshake from completing and leaving clients stuck on a loading spinner.
