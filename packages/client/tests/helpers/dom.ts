/**
 * Registers a DOM for the hook tests only.
 *
 * Imported for its side effect, and first, so the globals exist before
 * `@testing-library/react` is evaluated. It is deliberately not a bunfig
 * preload: the other suites in this package assert behavior with *no* `window`
 * or `localStorage`, and a global DOM would change what they test. Call
 * {@link unregisterDom} in `afterAll` to hand those suites a clean process.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

export function unregisterDom(): void {
  if (GlobalRegistrator.isRegistered) GlobalRegistrator.unregister();
}
