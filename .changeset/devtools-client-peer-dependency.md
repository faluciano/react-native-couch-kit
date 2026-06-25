---
"@couch-kit/devtools": patch
---

Declare `@couch-kit/client` as a `peerDependency` (with a workspace `devDependency` for local builds) instead of a runtime `dependency`. `devtools` only uses a type from the client (`DebugPanelData`) and is always used alongside an existing `@couch-kit/client` in the consumer's web controller, so this prevents a second copy of the client (and transitively React) from being installed/bundled. The published runtime bundle already externalizes `react` and `@couch-kit/client`, so there is no behavior change at runtime.
