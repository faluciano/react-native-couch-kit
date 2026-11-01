---
"@couch-kit/host": patch
---

The `react-native-nitro-modules` peer range is now `~0.35.0` instead of `>=0.35.0`. `react-native-nitro-http-server` is generated against Nitro 0.35, and Nitro minor versions change the generated C++ ABI, so 0.36 satisfied the old range but would break the native server. The README's install command and version table now say 0.35.x as well (the table said `>= 0.33.0`).
