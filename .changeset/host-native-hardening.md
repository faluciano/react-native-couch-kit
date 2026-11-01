---
"@couch-kit/host": patch
---

The TV host no longer trusts the native server more than it should.

- **A port that is already in use is reported as an error.** The native server signals a failed bind by returning port 0 rather than throwing. Before, the WebSocket server still emitted `listening`, and the static server published a URL (and QR code) with nothing behind it. Both now surface the failure through `onError` and `useStaticServer`'s `error`.
- **`maxMessageBytes` now also caps the native WebSocket transport.** Before, the native layer buffered messages up to its 64 MB default before the 256 KiB check in JS ran, so any device on the network could push large frames into a TV's memory.
- **Static-server starts and stops run one at a time.** The native static server is a single process-wide instance. A restart while a start was still in flight (StrictMode's double mount, a port or directory change) could stop the replacement, or make it fail to bind, leaving a URL on screen with no server behind it.
- **The WebSocket server restarts when `port`, `wsPort` or `maxMessageBytes` change.** It used to keep its first port, which broke the WS = HTTP + 2 convention after an HTTP port change.
- **Asset extraction creates nested directories.** A path like `images/cards/ace.png`, with no file directly in `images/`, used to fail. Extraction also yields between files, so a large bundle no longer freezes the TV's UI and an unmount stops it part way.
