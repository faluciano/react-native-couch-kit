import {
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT_OFFSET,
  DEFAULT_WS_PATH,
} from "@couch-kit/core";

/**
 * Default host WebSocket URL for `couch-kit simulate`.
 *
 * Single source of truth shared by the top-level proxy command (`index.ts`)
 * and the real sub-command (`commands/simulate.ts`). It lives here, rather
 * than in the command module, so the entry point can show it in `--help`
 * without eagerly loading the command implementation.
 */
export const DEFAULT_SIMULATE_URL = `ws://localhost:${
  DEFAULT_HTTP_PORT + DEFAULT_WS_PORT_OFFSET
}${DEFAULT_WS_PATH}`;
