---
"@couch-kit/core": minor
"@couch-kit/host": patch
---

Add CJS export for core package and fix host main field

- Added `require` export condition and CJS build step to `@couch-kit/core` for CommonJS consumers
- Fixed `@couch-kit/host` main field from `lib/index.d.ts` to `./src/index.tsx`
- Removed `typescript` from core `peerDependencies`
- Added `engines` field (`node >=18`) to all packages
