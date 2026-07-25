// A single `export *` barrel: a named re-export (`export { X } from`) combined
// with `sideEffects: false` lets bun's bundler tree-shake the sole class out of
// the built entry, publishing an empty `dist/index.js`. `export *` keeps it.
export * from "./relay-display-host";
