---
"@couch-kit/display": patch
---

**Bundle & tree-shaking**

- Fix an empty published `dist/index.js`. With `sideEffects: false`, a named
  re-export barrel (`export { RelayDisplayHost } from …`) let bun's bundler
  tree-shake the sole class out of the built entry, so `0.1.0` shipped a bundle
  with no implementation. Use an `export *` barrel and add a post-build guard
  that fails if `RelayDisplayHost` is missing from the output.
