# @party-kit/host

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
