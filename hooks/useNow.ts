"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock that is safe to render.
 *
 * Returns null on the server and on the first client render, then the current
 * time every `intervalMs`. The null phase is deliberate: reading Date.now()
 * during render makes the server and client markup disagree, and any UI that
 * ages data needs a clock that both sides agree on before it draws.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
