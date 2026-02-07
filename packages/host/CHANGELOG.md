# @party-kit/host

## 0.1.1

### Patch Changes

- 9c2c0f5: Add `staticDir` config option to `GameHostProvider` and `useStaticServer` for overriding the default www directory path. This is required on Android where `RNFS.MainBundlePath` is undefined, so apps must extract bundled assets to the filesystem and pass the path via `staticDir`.

## 0.1.0

### Minor Changes

- - **Session Recovery:** Added support for session recovery. The client now stores a secret and sends it on join. The host tracks these secrets and restores the session (mapping the new socket to the old session).
  - **Automatic Hydration:** The client now automatically handles the `HYDRATE` action. Users no longer need to implement this in their reducer.
  - **Large Message Support:** The Host WebSocket implementation now supports messages larger than 64KB (64-bit frame lengths).

### Patch Changes

- Updated dependencies
  - @party-kit/core@0.1.0

## 0.0.6

### Patch Changes

- Fix React Native bundling error by replacing Node.js `events` module with custom EventEmitter implementation
  - Replaced `import { EventEmitter } from "events"` with a custom lightweight EventEmitter implementation
  - Removed `events` and `@types/events` dependencies from package.json
  - Library now works out-of-the-box in React Native/Expo without Metro configuration
  - Custom EventEmitter supports: on(), once(), off(), emit(), removeAllListeners(), listenerCount()

## 0.0.5

### Patch Changes

- Fix React Native bundling error by replacing Node.js `events` module with custom EventEmitter implementation
  - Replaced `import { EventEmitter } from "events"` with a custom lightweight EventEmitter implementation
  - Removed `events` and `@types/events` dependencies from package.json
  - Library now works out-of-the-box in React Native/Expo without Metro configuration
  - Custom EventEmitter supports: on(), once(), off(), emit(), removeAllListeners(), listenerCount()

## 0.0.4

### Patch Changes

- Fix dependency resolution for @party-kit/core

## 0.0.3

### Patch Changes

- Fix dependency mismatch: update dependencies to point to published @party-kit/core@0.0.2

## 0.0.2

### Patch Changes

- Initial public release. Removed example apps, refactored logging, and prepared strictly typed packages for usage.
- Updated dependencies
  - @party-kit/core@0.0.2
