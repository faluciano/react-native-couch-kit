---
"@party-kit/host": patch
---

Add `staticDir` config option to `GameHostProvider` and `useStaticServer` for overriding the default www directory path. This is required on Android where `RNFS.MainBundlePath` is undefined, so apps must extract bundled assets to the filesystem and pass the path via `staticDir`.
