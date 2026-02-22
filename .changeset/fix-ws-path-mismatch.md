---
"@couch-kit/core": patch
"@couch-kit/client": patch
"@couch-kit/host": patch
"@couch-kit/cli": patch
---

Fix WebSocket connection failure caused by path mismatch: the client connected to `ws://host:8082` (root path `/`) while the server only accepted upgrades on `/ws`. Added shared `DEFAULT_WS_PATH` constant to `@couch-kit/core` and use it in both client URL construction and server handler registration.
