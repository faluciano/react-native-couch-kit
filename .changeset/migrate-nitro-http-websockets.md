---
"@couch-kit/host": minor
---

Migrate WebSocket implementation to use react-native-nitro-http-server's built-in WebSocket support. This replaces the custom RFC 6455 WebSocket protocol implementation with a native Rust-based implementation, reducing code complexity by ~320 lines while maintaining API compatibility.

**Breaking changes:**
- Removed `react-native-tcp-socket` peer dependency (no longer required)
- `start()` and `stop()` methods are now async (but handled gracefully in existing code)

**Benefits:**
- Simpler, more maintainable codebase
- Better performance with native Rust implementation
- Fewer dependencies
