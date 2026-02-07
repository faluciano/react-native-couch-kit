import { useEffect, useState } from "react";
import { StaticServer } from "react-native-nitro-http-server";
import RNFS from "react-native-fs";
import { getBestIpAddress } from "./network";

interface PartyKitHostConfig {
  port?: number;
  devMode?: boolean;
  devServerUrl?: string; // e.g. "http://localhost:5173"
  staticDir?: string; // Override the default www directory path (required on Android)
}

export const useStaticServer = (config: PartyKitHostConfig) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let server: StaticServer | null = null;

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
        return;
      }

      // Production Mode: Serve assets from bundle
      try {
        // Use staticDir if provided (required on Android where MainBundlePath is undefined),
        // otherwise fall back to iOS MainBundlePath
        const path = config.staticDir || `${RNFS.MainBundlePath}/www`;
        const port = config.port || 8080;

        server = new StaticServer();

        // Use '0.0.0.0' to bind to all interfaces (local network)
        await server.start(port, path, "0.0.0.0");

        // We prefer the actual IP over "localhost" returned by some libs
        const ip = await getBestIpAddress();
        if (ip) {
          setUrl(`http://${ip}:${port}`);
        } else {
          // Fallback if we can't detect IP (though HttpServer doesn't return the URL directly like the old lib)
          setUrl(`http://localhost:${port}`);
        }
      } catch (e) {
        setError(e as Error);
      }
    };

    startServer();

    return () => {
      if (server) {
        server.stop();
      }
    };
  }, [config.port, config.devMode, config.devServerUrl, config.staticDir]);

  return { url, error };
};
