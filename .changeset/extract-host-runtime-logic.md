---
"@couch-kit/host": patch
---

Extract rate limiting, session management, message validation, and broadcast scheduling out of the host provider into dedicated, unit-tested modules. No behavior change for consumers — the protocol flow, deterministic player IDs, rate limits, disconnect timeout, and broadcast throttling are preserved.
