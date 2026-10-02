import {
  FakeStaticServer,
  Paths,
  network,
  resetNativeFakes,
} from "./helpers/native-fakes";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_HTTP_PORT } from "@couch-kit/core";

// Loaded after the native mocks are registered.
const { useStaticServer } = await import("../src/server");
type CouchKitHostConfig = import("../src/server").CouchKitHostConfig;

const originalWarn = console.warn;

beforeEach(() => {
  resetNativeFakes();
  // getBestIpAddress warns on lookup failures; keep the output quiet.
  console.warn = () => {};
});

afterEach(() => {
  cleanup();
  console.warn = originalWarn;
});

/** Resolves pending promise chains inside the hook. */
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("useStaticServer in dev mode", () => {
  const devConfig: CouchKitHostConfig = {
    devMode: true,
    devServerUrl: "http://192.168.1.5:5173",
  };

  test("returns the dev server URL without starting a static server", async () => {
    const { result } = renderHook(() => useStaticServer(devConfig));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.url).toBe("http://192.168.1.5:5173");
    expect(result.current.error).toBeNull();
    expect(FakeStaticServer.instances).toHaveLength(0);
  });

  test("errors when the TV's own address cannot be found", async () => {
    network.ip = null;
    const { result } = renderHook(() => useStaticServer(devConfig));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.url).toBeNull();
    expect(result.current.error?.message).toBe(
      "Could not detect TV IP address",
    );
  });

  test("devMode without a devServerUrl serves the bundle as usual", async () => {
    const { result } = renderHook(() => useStaticServer({ devMode: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(FakeStaticServer.instances).toHaveLength(1);
    expect(result.current.url).toBe(
      `http://192.168.1.20:${DEFAULT_HTTP_PORT}/index.html`,
    );
  });
});

describe("useStaticServer in production", () => {
  test("serves staticDir on all interfaces and returns the LAN URL", async () => {
    const { result } = renderHook(() =>
      useStaticServer({ port: 9000, staticDir: "/data/www" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [server] = FakeStaticServer.instances;
    expect(server?.startArgs).toEqual({
      port: 9000,
      rootDir: "/data/www",
      host: "0.0.0.0",
    });
    expect(result.current.url).toBe("http://192.168.1.20:9000/index.html");
    expect(result.current.error).toBeNull();
  });

  test("falls back to the iOS bundle's www directory", async () => {
    Paths.bundle = { uri: "file:///var/Bundle/Game.app/" };
    const { result } = renderHook(() => useStaticServer({}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(FakeStaticServer.instances[0]?.startArgs?.rootDir).toBe(
      "/var/Bundle/Game.app/www",
    );
    expect(FakeStaticServer.instances[0]?.startArgs?.port).toBe(
      DEFAULT_HTTP_PORT,
    );
  });

  test("errors when there is neither a staticDir nor a bundle", async () => {
    Paths.bundle = undefined;
    const { result } = renderHook(() => useStaticServer({}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toContain("No staticDir provided");
    expect(result.current.url).toBeNull();
    expect(FakeStaticServer.instances).toHaveLength(0);
  });

  test("falls back to localhost when the LAN address is unknown", async () => {
    network.ip = "127.0.0.1";
    const { result } = renderHook(() =>
      useStaticServer({ port: 9000, staticDir: "/data/www" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.url).toBe("http://localhost:9000/index.html");
  });

  test("a failed start sets error and clears loading", async () => {
    FakeStaticServer.nextStartError = new Error("EADDRINUSE");
    const { result } = renderHook(() =>
      useStaticServer({ staticDir: "/data/www" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("EADDRINUSE");
    expect(result.current.url).toBeNull();
  });

  test("unmount stops a running server", async () => {
    const { result, unmount } = renderHook(() =>
      useStaticServer({ staticDir: "/data/www" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(FakeStaticServer.instances[0]?.stopCalls).toBe(1);
  });

  test("a server that finishes starting after unmount is stopped", async () => {
    FakeStaticServer.holdStart = true;
    const { result, unmount } = renderHook(() =>
      useStaticServer({ staticDir: "/data/www" }),
    );
    const [server] = FakeStaticServer.instances;
    expect(server).toBeDefined();

    unmount();
    const stopsAtUnmount = server!.stopCalls;

    await act(async () => {
      server!.finishStart();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Stopped again once actually up, and its result is never published.
    expect(server!.stopCalls).toBe(stopsAtUnmount + 1);
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  test("a config change replaces the server and drops the stale result", async () => {
    FakeStaticServer.holdStart = true;
    const { result, rerender } = renderHook(
      (config: CouchKitHostConfig) => useStaticServer(config),
      { initialProps: { port: 9000, staticDir: "/data/www" } },
    );
    const [first] = FakeStaticServer.instances;

    rerender({ port: 9100, staticDir: "/data/www" });
    const second = FakeStaticServer.instances[1];
    expect(second?.startArgs?.port).toBe(9100);

    await act(async () => {
      second!.finishStart();
      first!.finishStart();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(result.current.url).toBe("http://192.168.1.20:9100/index.html");
    expect(first!.stopCalls).toBeGreaterThanOrEqual(1);
    expect(second!.stopCalls).toBe(0);
  });
});
