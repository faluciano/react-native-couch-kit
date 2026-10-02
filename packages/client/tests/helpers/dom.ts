/**
 * Registers a DOM for the hook tests only.
 *
 * Imported for its side effect, and first, so the globals exist before
 * `@testing-library/react` is evaluated. It is deliberately not a bunfig
 * preload: the other suites in this package assert behavior with *no* `window`
 * or `localStorage`, and a global DOM would change what they test. Call
 * {@link registerDom} in `beforeAll` and {@link unregisterDom} in `afterAll`
 * to hand those suites a clean process.
 *
 * The module is evaluated once per process, so the import-time registration
 * only covers the first hook suite to run; `registerDom` restores the DOM for
 * any later one after an earlier suite's `afterAll` removed it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

export function registerDom(): void {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
}

registerDom();

export function unregisterDom(): void {
  if (GlobalRegistrator.isRegistered) GlobalRegistrator.unregister();
}
