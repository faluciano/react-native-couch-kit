import { useEffect, useState } from "react";
import { StaticServer } from "react-native-nitro-http-server";
import { Paths } from "expo-file-system/next";
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
    setLoading(true);

    const startServer = async () => {
      // In Dev Mode, we don't start the static server.
      // We just resolve the IP so the host knows where it is.
      if (config.devMode && config.devServerUrl) {
        const ip = await getBestIpAddress();
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

        server = new StaticServer();

        // Use '0.0.0.0' to bind to all interfaces (local network)
        await server.start(port, path, "0.0.0.0");

        // We prefer the actual IP over "localhost" returned by some libs
        const ip = await getBestIpAddress();
        if (ip) {
          setUrl(`http://${ip}:${port}`);
        } else {
          // Fallback if we can't detect IP
          setUrl(`http://localhost:${port}`);
        }
      } catch (e) {
        setError(new Error(toErrorMessage(e)));
      } finally {
        setLoading(false);
      }
    };

    startServer();

    return () => {
      if (server) {
        server.stop();
      }
    };
  }, [config.port, config.devMode, config.devServerUrl, config.staticDir]);

  return { url, error, loading };
};
