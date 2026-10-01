// `export *`, not `export { DebugOverlay } from`: with `sideEffects: false`,
// bun tree-shakes a named re-export of the package's only value out of the
// bundle, publishing a `dist/index.js` that exports a binding it never defines.
// The build's `verify-build` step fails if that ever happens again.
export * from "./DebugOverlay";
