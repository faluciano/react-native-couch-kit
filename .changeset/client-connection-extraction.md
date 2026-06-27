---
"@couch-kit/client": patch
---

Extract the client's connection logic (WebSocket URL resolution, reconnect
backoff, session-secret recovery, and host-message interpretation) into a
framework-free `connection` module with full unit test coverage. No behavior
change; these pure helpers are now exported for reuse and testing.
