import { Platform, fs, resetNativeFakes } from "./helpers/native-fakes";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

// Loaded after the native mocks are registered.
const { useExtractAssets } = await import("../src/assets");
type AssetManifest = import("../src/assets").AssetManifest;
type ExtractAssetsResult = import("../src/assets").ExtractAssetsResult;

const DOCS = "file:///data/user/0/com.game/files";
const WWW = `${DOCS}/www`;

const bytes = (text: string) => new TextEncoder().encode(text);

/** Puts `files` inside the fake APK under `asset:///www/`. */
function bundle(files: Record<string, string>): AssetManifest {
  for (const [path, content] of Object.entries(files)) {
    fs.assets.set(`asset:///www/${path}`, bytes(content));
  }
  return { files: Object.keys(files) };
}

const originalWarn = console.warn;

beforeEach(() => {
  resetNativeFakes();
  console.warn = () => {};
});

afterEach(() => {
  cleanup();
  console.warn = originalWarn;
});

describe("useExtractAssets", () => {
  test("skips extraction outside Android", async () => {
    Platform.OS = "ios";
    const manifest = bundle({ "index.html": "<html>" });
    const { result } = renderHook(() => useExtractAssets(manifest));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.staticDir).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(fs.log).toHaveLength(0);
  });

  test("copies every manifest file out of the APK on Android", async () => {
    const manifest = bundle({
      "index.html": "<html>",
      "assets/index-abc.js": "console.log(1)",
      "assets/fonts/a.woff2": "font",
    });
    const { result } = renderHook(() => useExtractAssets(manifest));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The file:// prefix is stripped for the native server.
    expect(result.current.staticDir).toBe(WWW.replace(/^file:\/\//, ""));
    expect(result.current.error).toBeNull();
    expect(new TextDecoder().decode(fs.files.get(`${WWW}/index.html`))).toBe(
      "<html>",
    );
    expect(fs.files.has(`${WWW}/assets/index-abc.js`)).toBe(true);
    expect(fs.files.has(`${WWW}/assets/fonts/a.woff2`)).toBe(true);
    // Subdirectories are created before their files are written.
    expect(fs.log.indexOf(`mkdir ${WWW}/assets`)).toBeLessThan(
      fs.log.indexOf(`write ${WWW}/assets/index-abc.js`),
    );
    expect(fs.dirs.has(`${WWW}/assets/fonts`)).toBe(true);
  });

  test("creates a shared subdirectory only once", async () => {
    const manifest = bundle({ "assets/a.js": "a", "assets/b.js": "b" });
    const { result } = renderHook(() => useExtractAssets(manifest));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fs.log.filter((op) => op === `mkdir ${WWW}/assets`)).toHaveLength(1);
  });

  test("replaces a previous extraction so app updates ship fresh assets", async () => {
    fs.dirs.add(WWW);
    fs.files.set(`${WWW}/stale.js`, bytes("old"));
    const manifest = bundle({ "index.html": "<html>" });

    const { result } = renderHook(() => useExtractAssets(manifest));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fs.log[0]).toBe(`rm ${WWW}`);
    expect(fs.files.has(`${WWW}/stale.js`)).toBe(false);
    expect(fs.files.has(`${WWW}/index.html`)).toBe(true);
  });

  test("reports a missing asset as an error", async () => {
    const manifest: AssetManifest = { files: ["missing.js"] };
    const { result } = renderHook(() => useExtractAssets(manifest));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(
      "Asset not found: asset:///www/missing.js",
    );
    expect(result.current.staticDir).toBeUndefined();
  });

  test("reports a failed write as an error", async () => {
    const manifest = bundle({ "index.html": "<html>" });
    fs.failWriteAt = `${WWW}/index.html`;
    const { result } = renderHook(() => useExtractAssets(manifest));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Disk full");
  });

  test("an empty manifest still yields the www directory", async () => {
    const { result } = renderHook(() => useExtractAssets({ files: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.staticDir).toBe(WWW.replace(/^file:\/\//, ""));
  });
});

describe("useExtractAssets types", () => {
  test("AssetManifest accepts a files array", () => {
    const manifest: AssetManifest = {
      files: ["index.html", "assets/index-abc.js", "assets/style-def.css"],
    };

    expect(manifest.files).toHaveLength(3);
    expect(manifest.files[0]).toBe("index.html");
  });

  test("ExtractAssetsResult has the expected shape", () => {
    const result: ExtractAssetsResult = {
      staticDir: undefined,
      loading: true,
      error: null,
    };

    expect(result.staticDir).toBeUndefined();
    expect(result.loading).toBe(true);
    expect(result.error).toBeNull();
  });

  test("ExtractAssetsResult allows staticDir as string", () => {
    const result: ExtractAssetsResult = {
      staticDir: "/data/user/0/com.app/files/www/",
      loading: false,
      error: null,
    };

    expect(result.staticDir).toBe("/data/user/0/com.app/files/www/");
    expect(result.loading).toBe(false);
  });

  test("ExtractAssetsResult allows error as string", () => {
    const result: ExtractAssetsResult = {
      staticDir: undefined,
      loading: false,
      error: "Document directory is not available",
    };

    expect(result.error).toBe("Document directory is not available");
  });
});
