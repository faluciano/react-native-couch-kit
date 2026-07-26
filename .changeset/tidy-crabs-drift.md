---
"@couch-kit/client": patch
---

Add the `RATE_LIMITED` and `SERVER_BUSY` relay error codes, which the relay has
sent since abuse limits landed but the client's copy of the protocol never knew
about — a client could receive a code its own types called impossible.

A contract test now imports both copies of the wire constants and fails if they
ever diverge again.
