import { useEffect, useState } from "react";
import { StaticServer } from "react-native-nitro-http-server";
import { Paths } from "expo-file-system";
import { getBestIpAddress } from "./network";
import { DEFAULT_HTTP_PORT, toErrorMessage } from "@couch-kit/core";

/**
 * Static-server starts and stops, run one at a time.
 *
 * The native static server is a single process-wide instance: `stop()` on any
 * `StaticServer` stops whatever is running. An effect torn down while its
 * start was still in flight (StrictMode's double mount, a port change) would
 * otherwise race the start that replaced it: the new start fails to bind the
 * port the old one still holds, and the old one's late stop then takes down
 * the only server. Queued, each stop finishes before the next start begins.
 */
let nativeQueue: Promise<void> = Promise.resolve();
function enqueueNative<T>(task: () => Promise<T>): Promise<T> {
  const run = nativeQueue.then(task, task);
  nativeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface CouchKitHostConfig {
  port?: number;
  devMode?: boolean;
  devServerUrl?: string; // e.g. "http://localhost:5173"
  staticDir?: string; // Override the default www directory path (required on Android)
}

/**
 * React hook that manages a static HTTP file server for serving the web controller.
 *
 * In production mode, starts a `StaticServer` bound to `0.0.0.0` on the configured port,
 * serving files from `staticDir` (or the iOS bundle directory + `/www` by default).
 * On Android, `staticDir` must be provided since bundle assets live inside the APK.
 * In dev mode, skips the server and returns `devServerUrl` directly.
 *
 * @param config - Server configuration including port, dev mode, and static directory.
 * @returns An object with `url` (the server URL or null), `error`, and `loading`.
 */
export const useStaticServer = (config: CouchKitHostConfig) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let server: StaticServer | null = null;
    // Set by cleanup. Starting is asynchronous, so an effect that was torn down
    // mid-start (a config change, StrictMode's double mount, an unmount) must
    // neither publish its result nor leave its server holding the port.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const startServer = async () => {
      // In Dev Mode, we don't start the static server.
      // We just resolve the IP so the host knows where it is.
      if (config.devMode && config.devServerUrl) {
        const ip = await getBestIpAddress();
        if (cancelled) return;
        if (ip) {
          // In dev mode, the URL is the laptop's dev server,
          // but we might need the TV's IP for the WebSocket connection later.
          setUrl(config.devServerUrl);
        } else {
          setError(new Error("Could not detect TV IP address"));
        }
        setLoading(false);
        return;
      }

      // Production Mode: Serve assets from bundle
      try {
        // Use staticDir if provided (required on Android where bundle path is undefined),
        // otherwise fall back to the iOS bundle directory via expo-file-system
        let path = config.staticDir;

        if (!path) {
          const bundleUri = Paths.bundle?.uri;
          if (!bundleUri) {
            throw new Error(
              "No staticDir provided and Paths.bundle is unavailable. " +
                "On Android, you must pass staticDir from useExtractAssets.",
            );
          }
          path = `${bundleUri.replace(/^file:\/\//, "")}www`;
        }
        const port = config.port || DEFAULT_HTTP_PORT;
        const rootDir = path;

        const started = await enqueueNative(async () => {
          // Torn down before its turn came: never start at all.
          if (cancelled) return false;
          const instance = new StaticServer();
          // Use '0.0.0.0' to bind to all interfaces (local network)
          const boundPort = await instance.start(port, rootDir, "0.0.0.0");
          // The native server reports a failed bind (port in use, no
          // permission) by returning a port <= 0, not by throwing.
          if (!(boundPort > 0)) {
            throw new Error(
              `Could not start the controller server on port ${port}. ` +
                "Is another app using it?",
            );
          }
          server = instance;
          return true;
        });
        if (!started || cancelled) return;

        // We prefer the actual IP over "localhost" returned by some libs
        const ip = await getBestIpAddress();
        if (cancelled) return;
        if (ip) {
          setUrl(`http://${ip}:${port}/index.html`);
        } else {
          // Fallback if we can't detect IP
          setUrl(`http://localhost:${port}/index.html`);
        }
      } catch (e) {
        if (!cancelled) setError(new Error(toErrorMessage(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    startServer();

    return () => {
      cancelled = true;
      // Queued behind this effect's own start, so it stops what that start
      // produced (if anything) before any later start runs.
      void enqueueNative(async () => {
        const target = server;
        server = null;
        if (target) await target.stop();
      }).catch(() => {
        // Nothing useful to do if a server we no longer want fails to stop.
      });
    };
  }, [config.port, config.devMode, config.devServerUrl, config.staticDir]);

  return { url, error, loading };
};
