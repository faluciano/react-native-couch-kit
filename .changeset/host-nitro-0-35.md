---
"@couch-kit/host": major
---

Move to `react-native-nitro-http-server` 1.9 and require `react-native-nitro-modules` >= 0.35

**Breaking changes:** the `react-native-nitro-modules` peer range moves from
`>= 0.33.0` to `>= 0.35.0`, and `react-native-nitro-http-server` is now
`^1.9.2` (was held on `~1.6.1`). http-server 1.7+ regenerates its Nitrogen
C++ against nitro-modules 0.35, so the two packages are ABI-coupled: a host
built against nitro 0.33 fails its Android native build with
`no member named 'CxxPart' in JHybridObject`. The peer range now tells the
package manager the truth instead of relying on a pinned patch series.
The JavaScript surface `@couch-kit/host` uses (`ConfigServer`, `StaticServer`,
the WebSocket mount) is unchanged; 1.9 additionally returns the bound port
from `start()` and adds an opt-in `autoRestart` option, neither of which
affects host behaviour.

**Migration:** bump `react-native-nitro-modules` in your app to the latest
0.35.x (`react-native-nitro-http-server` 1.9 declares `^0.35.0`, so 0.36+ is
not yet supported), drop any direct `react-native-nitro-http-server` pin you
added to work around the 1.6.x hold, then rebuild native code with
`npx expo prebuild --clean` (or a fresh `gradlew clean` / `pod install`) so the
regenerated Nitrogen bindings are picked up.
