# @couch-kit/devtools

## 3.0.2

### Patch Changes

- [#151](https://github.com/faluciano/react-native-couch-kit/pull/151) [`ff839a6`](https://github.com/faluciano/react-native-couch-kit/commit/ff839a67c54aaf1f042b598d59d7918f03814c92) Thanks [@faluciano](https://github.com/faluciano)! - Fix an over-strict peer dependency that pinned devtools to one exact client
  release.

  The peer range was `workspace:*`, which publishing rewrites to the current
  version — so `@couch-kit/devtools@3.0.0` demanded _exactly_
  `@couch-kit/client@0.11.0`, and any client patch would conflict. devtools uses
  one type-only import from client and nothing at runtime, so the peer is now a
  wide, optional range (`>=0.9.0 <1.0.0`).

  This also stops the runaway majors: because a peerDependency range change is
  treated as breaking, every client release majored devtools — 0.2.10 → 1.0.0 →
  2.0.0 → 3.0.0 in a day, each changelog reading "Patch Changes". Changesets is
  now configured to bump peer dependents only when a release actually leaves
  their range.

## 3.0.1

### Patch Changes

- [#149](https://github.com/faluciano/react-native-couch-kit/pull/149) [`182ef3d`](https://github.com/faluciano/react-native-couch-kit/commit/182ef3da3b5a2ec3ae242aa73fd4619d145eee43) Thanks [@faluciano](https://github.com/faluciano)! - Fix an over-strict peer dependency that pinned devtools to one exact client
  release.

  The peer range was `workspace:*`, which publishing rewrites to the current
  version — so `@couch-kit/devtools@3.0.0` demanded _exactly_
  `@couch-kit/client@0.11.0`, and any client patch would conflict. devtools uses
  one type-only import from client and nothing at runtime, so the peer is now a
  wide, optional range (`>=0.9.0 <1.0.0`).

  This also stops the runaway majors: because a peerDependency range change is
  treated as breaking, every client release majored devtools — 0.2.10 → 1.0.0 →
  2.0.0 → 3.0.0 in a day, each changelog reading "Patch Changes". Changesets is
  now configured to bump peer dependents only when a release actually leaves
  their range.

## 3.0.0

### Patch Changes

- Updated dependencies [[`abf8bbe`](https://github.com/faluciano/react-native-couch-kit/commit/abf8bbe075e8f5eff00ffee7d9131009195c6a0e), [`abf8bbe`](https://github.com/faluciano/react-native-couch-kit/commit/abf8bbe075e8f5eff00ffee7d9131009195c6a0e)]:
  - @couch-kit/client@0.11.0

## 2.0.1

### Patch Changes

- Updated dependencies [[`050239e`](https://github.com/faluciano/react-native-couch-kit/commit/050239e251b32641b0c754016510b70ae713fcaa)]:
  - @couch-kit/client@0.10.1

## 2.0.0

### Patch Changes

- Updated dependencies [[`5142ccd`](https://github.com/faluciano/react-native-couch-kit/commit/5142ccdb2ef37ab85cc57eac1e50f99b567cde70)]:
  - @couch-kit/client@0.10.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`782d495`](https://github.com/faluciano/react-native-couch-kit/commit/782d4956c73918af35bff73410bf5e39d7261e56)]:
  - @couch-kit/client@0.9.0

## 0.2.10

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.9

## 0.2.9

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.8

## 0.2.8

### Patch Changes

- Updated dependencies [[`7897e88`](https://github.com/faluciano/react-native-couch-kit/commit/7897e887967c440b5b973c8dc753bf1fa705b993)]:
  - @couch-kit/client@0.8.7

## 0.2.7

### Patch Changes

- [#66](https://github.com/faluciano/react-native-couch-kit/pull/66) [`f436188`](https://github.com/faluciano/react-native-couch-kit/commit/f436188bc92cb0bb0b0e3e29205db25c4264b145) Thanks [@faluciano](https://github.com/faluciano)! - Declare `@couch-kit/client` as a `peerDependency` (with a workspace `devDependency` for local builds) instead of a runtime `dependency`. `devtools` only uses a type from the client (`DebugPanelData`) and is always used alongside an existing `@couch-kit/client` in the consumer's web controller, so this prevents a second copy of the client (and transitively React) from being installed/bundled. The published runtime bundle already externalizes `react` and `@couch-kit/client`, so there is no behavior change at runtime.

## 0.2.6

### Patch Changes

- Updated dependencies [[`bd9cd2d`](https://github.com/faluciano/react-native-couch-kit/commit/bd9cd2d6eebc464e33fd1ecbbb6731783ba3ed0c)]:
  - @couch-kit/client@0.8.6

## 0.2.5

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.5

## 0.2.4

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.4

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.3

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @couch-kit/client@0.8.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`4976357`](https://github.com/faluciano/react-native-couch-kit/commit/49763573df502e394d5591b73000f48ee711d7a8)]:
  - @couch-kit/client@0.8.1

## 0.2.0

### Minor Changes

- [#21](https://github.com/faluciano/react-native-couch-kit/pull/21) [`f1e836d`](https://github.com/faluciano/react-native-couch-kit/commit/f1e836d8f17821f0da20db7c3c552552c9b22133) Thanks [@faluciano](https://github.com/faluciano)! - Initial release of `@couch-kit/devtools` package with `DebugOverlay` React component. Provides a collapsible debug overlay showing action log, state tree, connection status, and RTT.

### Patch Changes

- Updated dependencies [[`f1e836d`](https://github.com/faluciano/react-native-couch-kit/commit/f1e836d8f17821f0da20db7c3c552552c9b22133)]:
  - @couch-kit/client@0.8.0
