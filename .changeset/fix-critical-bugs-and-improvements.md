---
"@party-kit/core": minor
"@party-kit/client": minor
"@party-kit/host": minor
"@party-kit/cli": patch
---

Fix critical bugs and improve reliability across all packages.

**@party-kit/core**: Make `IGameState.status` a flexible `string` type instead of a restrictive union, allowing games to define custom phases like `"round_end"` or `"game_over"`.

**@party-kit/client**: Fix WELCOME message handler to hydrate state immediately on connect instead of waiting for the next STATE_UPDATE broadcast. Add `name` and `avatar` config options to `useGameClient` so games can customize player identity. Wrap `localStorage` access in try/catch for Safari private browsing and restrictive WebView compatibility.

**@party-kit/host**: Rewrite WebSocket frame processing with proper buffer management — process all complete frames per TCP packet instead of only the first (fixes silent data loss). Add RFC 6455 opcode handling for close frames (send close response), ping frames (respond with pong), and graceful handling of binary/unknown frames. Fix corrupt JSON no longer permanently blocking a connection. Retain post-handshake data that arrives in the same TCP packet. Improve socket ID generation from ~5-6 chars to 21 chars to eliminate collision risk. Update stale `declarations.d.ts` to match actual `react-native-nitro-http-server` import.

**@party-kit/cli**: Fix `simulate` command default WebSocket URL from port 8081 to 8082 to match actual server port.
