---
"@couch-kit/devtools": patch
---

Publish a bundle that actually contains `DebugOverlay`.

Every previous release shipped a 27-byte `dist/index.js` that exported `DebugOverlay` without defining it: with `sideEffects: false`, the bundler tree-shook the named re-export of the package's only value. The build also targeted React's development JSX runtime, which does not work in a production build. The entry point now uses `export *`, the bundle is built against `react/jsx-runtime`, and the build fails if either regresses.
