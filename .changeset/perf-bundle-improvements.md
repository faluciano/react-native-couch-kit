---
"@couch-kit/core": patch
"@couch-kit/host": minor
"@couch-kit/client": patch
"@couch-kit/cli": minor
---

Performance and dependency/bundle improvements

**Dependency cleanup:**

- Remove unused root-level dependencies (expo-\*, @react-native/assets-registry, js-sha1)
- Move `buffer` from root to @couch-kit/host where it's actually used
- Move `react-native-nitro-modules` to peerDependencies in @couch-kit/host
- Remove unused `chalk` dependency from @couch-kit/cli
- Replace `fs-extra`, `ora`, and `ws` with built-in alternatives in @couch-kit/cli

**Bundle & tree-shaking:**

- Add `sideEffects: false` to all library packages for better tree-shaking
- Add modern `exports` field to all package.json files
- Fix @couch-kit/core build target from `node` to `browser` (it's environment-agnostic)

**Runtime performance:**

- Throttle state broadcasts to ~30fps to reduce serialization overhead for fast-updating games
- Replace per-event `Buffer.concat` with a growing buffer strategy in WebSocket server to reduce GC pressure
- Replace deprecated `Buffer.slice()` with `Buffer.subarray()`

**CLI improvements:**

- Lazy-load CLI commands via dynamic `import()` for faster startup
- Replace `ws` with Bun's native WebSocket
- Replace `fs-extra` with `node:fs` built-in APIs
- Replace `ora` with simple console output
