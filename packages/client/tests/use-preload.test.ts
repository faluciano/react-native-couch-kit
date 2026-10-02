import { registerDom, unregisterDom } from "./helpers/dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MessageTypes } from "@couch-kit/core";
import { usePreload } from "../src/assets";

/**
 * An `Image` whose load the test decides: nothing happens until
 * {@link FakeImage.load} or {@link FakeImage.fail} is called for its URL.
 */
class FakeImage {
  static created: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";

  constructor() {
    FakeImage.created.push(this);
  }

  private static find(src: string): FakeImage {
    const image = FakeImage.created.find((candidate) => candidate.src === src);
    if (!image) throw new Error(`No image requested for ${src}`);
    return image;
  }

  static load(src: string): void {
    act(() => FakeImage.find(src).onload?.());
  }

  static fail(src: string): void {
    act(() => FakeImage.find(src).onerror?.());
  }
}

/** A `fetch` whose responses the test settles per URL. */
const requests = new Map<
  string,
  { resolve: (status: number) => void; reject: (error: Error) => void }
>();
const fakeFetch = mock(
  (url: string) =>
    new Promise<Response>((resolve, reject) => {
      requests.set(url, {
        resolve: (status) => resolve(new Response("", { status })),
        reject,
      });
    }),
);

/** Settles a fetch: `true` is a 200, `false` a network error, a number that HTTP status. */
async function settleFetch(url: string, ok: boolean | number): Promise<void> {
  const request = requests.get(url);
  if (!request) throw new Error(`No fetch issued for ${url}`);
  await act(async () => {
    if (ok === false) request.reject(new Error("network down"));
    else request.resolve(ok === true ? 200 : ok);
  });
}

const realImage = globalThis.Image;
const realFetch = globalThis.fetch;

beforeEach(() => {
  FakeImage.created = [];
  requests.clear();
  fakeFetch.mockClear();
  globalThis.Image = FakeImage as unknown as typeof Image;
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.Image = realImage;
  globalThis.fetch = realFetch;
});

beforeAll(registerDom);

afterAll(() => {
  unregisterDom();
});

describe("usePreload", () => {
  test("an empty list is loaded immediately and reported", () => {
    const sendMessage = mock(() => {});
    const { result } = renderHook(() => usePreload([], sendMessage));

    expect(result.current).toEqual({
      loaded: true,
      progress: 100,
      failedAssets: [],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: MessageTypes.ASSETS_LOADED,
      payload: true,
    });
  });

  test("works without a sendMessage callback", () => {
    const { result } = renderHook(() => usePreload([]));
    expect(result.current.loaded).toBe(true);
  });

  test("loads images through Image and everything else through fetch", () => {
    renderHook(() =>
      usePreload([
        "/a.png",
        "/b.jpg",
        "/c.jpeg",
        "/d.gif",
        "/e.webp",
        "/sound.mp3",
        "/data.json",
      ]),
    );

    expect(FakeImage.created.map((image) => image.src)).toEqual([
      "/a.png",
      "/b.jpg",
      "/c.jpeg",
      "/d.gif",
      "/e.webp",
    ]);
    expect(fakeFetch.mock.calls.map(([url]) => url)).toEqual([
      "/sound.mp3",
      "/data.json",
    ]);
  });

  test("reports progress as each asset finishes", async () => {
    const sendMessage = mock(() => {});
    const assets = ["/a.png", "/b.png", "/c.mp3", "/d.mp3"];
    const { result } = renderHook(() => usePreload(assets, sendMessage));

    expect(result.current).toEqual({
      loaded: false,
      progress: 0,
      failedAssets: [],
    });

    FakeImage.load("/a.png");
    expect(result.current.progress).toBe(25);

    await settleFetch("/c.mp3", true);
    expect(result.current.progress).toBe(50);

    FakeImage.load("/b.png");
    expect(result.current.progress).toBe(75);
    expect(result.current.loaded).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();

    await settleFetch("/d.mp3", true);
    expect(result.current).toEqual({
      loaded: true,
      progress: 100,
      failedAssets: [],
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: MessageTypes.ASSETS_LOADED,
      payload: true,
    });
  });

  test("rounds progress to a whole percentage", () => {
    const { result } = renderHook(() =>
      usePreload(["/a.png", "/b.png", "/c.png"]),
    );
    FakeImage.load("/a.png");
    expect(result.current.progress).toBe(33);
    FakeImage.load("/b.png");
    expect(result.current.progress).toBe(67);
  });

  test("failed assets still complete the load and are listed", async () => {
    const sendMessage = mock(() => {});
    const { result } = renderHook(() =>
      usePreload(["/ok.png", "/broken.png", "/missing.mp3"], sendMessage),
    );

    FakeImage.load("/ok.png");
    FakeImage.fail("/broken.png");
    // Failures are only published once everything has finished.
    expect(result.current.failedAssets).toEqual([]);
    await settleFetch("/missing.mp3", false);

    expect(result.current.loaded).toBe(true);
    expect(result.current.progress).toBe(100);
    expect(result.current.failedAssets).toEqual([
      "/broken.png",
      "/missing.mp3",
    ]);
    // Still reported: the controller decides what to do about failures.
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test("an HTTP error response counts as a failure", async () => {
    const { result } = renderHook(() => usePreload(["/gone.mp3"]));

    // fetch resolves on a 404; only the status says the asset is missing.
    await settleFetch("/gone.mp3", 404);

    expect(result.current.loaded).toBe(true);
    expect(result.current.failedAssets).toEqual(["/gone.mp3"]);
  });

  test("a new array with the same contents does not restart loading", () => {
    const { result, rerender } = renderHook(
      ({ assets }: { assets: string[] }) => usePreload(assets),
      { initialProps: { assets: ["/a.png", "/b.png"] } },
    );
    FakeImage.load("/a.png");

    rerender({ assets: ["/a.png", "/b.png"] });

    expect(FakeImage.created).toHaveLength(2);
    expect(result.current.progress).toBe(50);
  });

  test("a changed list restarts loading and ignores the old cycle", () => {
    const sendMessage = mock(() => {});
    const { result, rerender } = renderHook(
      ({ assets }: { assets: string[] }) => usePreload(assets, sendMessage),
      { initialProps: { assets: ["/old.png"] } },
    );

    rerender({ assets: ["/new-1.png", "/new-2.png"] });
    expect(result.current).toEqual({
      loaded: false,
      progress: 0,
      failedAssets: [],
    });

    // The abandoned image finishing late changes nothing.
    FakeImage.load("/old.png");
    expect(result.current.progress).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();

    FakeImage.load("/new-1.png");
    FakeImage.load("/new-2.png");
    expect(result.current.loaded).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test("uses the latest sendMessage without restarting the load", () => {
    const first = mock(() => {});
    const second = mock(() => {});
    const { rerender } = renderHook(
      ({ send }: { send: typeof first }) => usePreload(["/a.png"], send),
      { initialProps: { send: first } },
    );

    rerender({ send: second });
    FakeImage.load("/a.png");

    expect(FakeImage.created).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("assets finishing after unmount are ignored", async () => {
    const sendMessage = mock(() => {});
    const { unmount } = renderHook(() =>
      usePreload(["/a.png", "/b.mp3"], sendMessage),
    );

    unmount();
    FakeImage.load("/a.png");
    await settleFetch("/b.mp3", true);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
