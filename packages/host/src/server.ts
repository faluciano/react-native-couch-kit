import { useEffect, useState } from "react";
import { StaticServer } from "react-native-nitro-http-server";
import { Paths } from "expo-file-system";
import { getBestIpAddress } from "./network";
import { DEFAULT_HTTP_PORT, toErrorMessage } from "@couch-kit/core";

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

    const stop = (target: StaticServer | null) => {
      if (!target) return;
      void Promise.resolve(target.stop()).catch(() => {
        // Nothing useful to do if a server we no longer want fails to stop.
      });
    };

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

        const started = new StaticServer();
        server = started;

        // Use '0.0.0.0' to bind to all interfaces (local network)
        await started.start(port, path, "0.0.0.0");
        if (cancelled) {
          // Cleanup ran while the server was still starting, when a stop may
          // not have taken; stop it again now that it is actually up.
          stop(started);
          return;
        }

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
      stop(server);
    };
  }, [config.port, config.devMode, config.devServerUrl, config.staticDir]);

  return { url, error, loading };
};
