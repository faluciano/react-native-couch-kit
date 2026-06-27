# @couch-kit/devtools

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
