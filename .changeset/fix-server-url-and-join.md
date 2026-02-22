---
"@couch-kit/host": patch
---

Append `/index.html` to the static server URL so QR codes point directly to the client entry point. Also add error handling for the `derivePlayerId` promise in the JOIN handler to prevent silent failures that leave clients stuck on "Connected" without receiving a WELCOME message.
