---
"@couch-kit/host": patch
---

Keep `react-native-nitro-http-server` on 1.6.x and drop two unused dependencies

**Dependency cleanup:** `react-native-nitro-http-server` was declared as
`^1.6.1`, but 1.7 and later regenerate their Nitrogen C++ against
`react-native-nitro-modules` 0.35, while this package only asks consumers for
`>= 0.33`. A fresh install resolved 1.9.2 next to nitro 0.33 and the Android
native build failed with `no member named 'CxxPart' in JHybridObject`. The
range is now `~1.6.1`, the last series that builds against the peer range this
package actually declares. Consumers who pinned 1.6.1 by hand can drop the pin.

`buffer` and `js-sha1` are removed: nothing in `@couch-kit/host` (or in `core`
and `runtime`, which ship their own pure-JS SHA-256) imports either.
