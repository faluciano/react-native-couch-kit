---
"@couch-kit/runtime": minor
"@couch-kit/host": patch
"@couch-kit/core": patch
---

Extract the authoritative game state, sessions, authorization, rate limiting,
and broadcast scheduling into a transport-neutral runtime package. The React
Native host now adapts its existing HTTP and WebSocket servers to that runtime
without changing the public `GameHostProvider` API.

The core ESM package metadata and declaration imports are also made compatible
with Node's ESM and `NodeNext` resolution so the runtime can be consumed from
supported Node versions.
