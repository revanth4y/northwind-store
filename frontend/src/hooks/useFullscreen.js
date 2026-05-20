/**
 * useFullscreen
 * ─────────────
 * Thin wrapper around the Fullscreen API.
 * Targets the provided ref element (or document.documentElement as fallback).
 */

import { useCallback, useEffect, useState } from "react";

export function useFullscreen(targetRef) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async () => {
    const el = targetRef?.current ?? document.documentElement;
    try { await el.requestFullscreen(); } catch { /* ignored */ }
  }, [targetRef]);

  const exit = useCallback(async () => {
    try { await document.exitFullscreen(); } catch { /* ignored */ }
  }, []);

  const toggle = useCallback(() => {
    isFullscreen ? exit() : enter();
  }, [isFullscreen, enter, exit]);

  return { isFullscreen, toggle, enter, exit };
}
