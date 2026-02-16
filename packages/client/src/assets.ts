import { useState, useEffect, useRef } from "react";
import { MessageTypes } from "@couch-kit/core";

export interface PreloadResult {
  /** Whether all assets have finished loading (including failures). */
  loaded: boolean;
  /** Loading progress as a percentage (0-100). */
  progress: number;
  /** Asset URLs that failed to load. */
  failedAssets: string[];
}

/**
 * Shallow-compare two string arrays by length and element identity.
 * Returns `true` when the arrays are considered equal.
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Preloads a list of asset URLs (images via `Image()`, others via `fetch()`).
 *
 * Returns `loaded` (all done), `progress` (0-100), and `failedAssets` (URLs
 * that failed to load). Failed assets still count toward progress so the hook
 * always reaches 100 % — check `failedAssets.length` to decide how to react.
 */
export function usePreload(
  assets: string[],
  sendMessage?: (msg: { type: string; payload: unknown }) => void,
): PreloadResult {
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failedAssets, setFailedAssets] = useState<string[]>([]);

  // Stable ref for the callback to avoid re-triggering the effect
  // when the caller passes a new function reference each render.
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // Stable reference to the last asset list so we don't depend on
  // `JSON.stringify(assets)` — which creates a new string every render.
  const prevAssets = useRef<string[]>(assets);

  // Only update the ref (and re-trigger the effect) when the content changes.
  if (!arraysEqual(prevAssets.current, assets)) {
    prevAssets.current = assets;
  }

  const stableAssets = prevAssets.current;

  useEffect(() => {
    if (stableAssets.length === 0) {
      setLoaded(true);
      setProgress(100);
      setFailedAssets([]);
      sendMessageRef.current?.({
        type: MessageTypes.ASSETS_LOADED,
        payload: true,
      });
      return;
    }

    let loadedCount = 0;
    const total = stableAssets.length;
    const failed: string[] = [];
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      loadedCount++;
      setProgress(Math.round((loadedCount / total) * 100));
      if (loadedCount === total) {
        setFailedAssets([...failed]);
        setLoaded(true);
        sendMessageRef.current?.({
          type: MessageTypes.ASSETS_LOADED,
          payload: true,
        });
      }
    };

    // Reset state for a fresh load cycle
    setLoaded(false);
    setProgress(0);
    setFailedAssets([]);

    stableAssets.forEach((src) => {
      if (src.match(/\.(jpeg|jpg|gif|png|webp)$/)) {
        const img = new Image();
        img.onload = tick;
        img.onerror = () => {
          failed.push(src);
          tick();
        };
        img.src = src;
      } else {
        fetch(src)
          .then(tick)
          .catch(() => {
            failed.push(src);
            tick();
          });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stableAssets]);

  return { loaded, progress, failedAssets };
}
