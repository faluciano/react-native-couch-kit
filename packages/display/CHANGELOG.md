# @couch-kit/display

## 0.1.2

### Patch Changes

- [#136](https://github.com/faluciano/react-native-couch-kit/pull/136) [`973805a`](https://github.com/faluciano/react-native-couch-kit/commit/973805af754a8e22c1c6c81de4c858ffa353556c) Thanks [@faluciano](https://github.com/faluciano)! - **Bundle & tree-shaking**

  - Fix `RelayDisplayHost` resolving as "not exported" for consumers on
    `moduleResolution: NodeNext`/`Node16`. The package is `type: module`, so the
    emitted `.d.ts` is read in strict-ESM mode where an extensionless relative
    re-export (`export * from "./relay-display-host"`) is not resolved. Add the
    `.js` extension to the barrel specifier, matching the other ESM packages.

## 0.1.1

### Patch Changes

- [#134](https://github.com/faluciano/react-native-couch-kit/pull/134) [`2b29581`](https://github.com/faluciano/react-native-couch-kit/commit/2b29581a8c4eddee4d4131030c375fcf1f0f4f98) Thanks [@faluciano](https://github.com/faluciano)! - **Bundle & tree-shaking**

  - Fix an empty published `dist/index.js`. With `sideEffects: false`, a named
    re-export barrel (`export { RelayDisplayHost } from …`) let bun's bundler
    tree-shake the sole class out of the built entry, so `0.1.0` shipped a bundle
    with no implementation. Use an `export *` barrel and add a post-build guard
    that fails if `RelayDisplayHost` is missing from the output.

## 0.1.0

### Minor Changes

- [#132](https://github.com/faluciano/react-native-couch-kit/pull/132) [`514d108`](https://github.com/faluciano/react-native-couch-kit/commit/514d108a57717b1bbd12d96e27c2c8f8bbb49470) Thanks [@faluciano](https://github.com/faluciano)! - **New features**

  - New `@couch-kit/display` package. `RelayDisplayHost` owns the authoritative
    `GameHostRuntime` in a browser tab and bridges it to a game-agnostic relay,
    enabling cross-network play where phones on different networks join by room
    code. Framework-agnostic (`subscribe` / `getState` / `dispatch` / `stop`);
    promoted from the in-repo reference example so games no longer vendor it.
