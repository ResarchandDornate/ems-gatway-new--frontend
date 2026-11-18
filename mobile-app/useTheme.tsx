"use client";

/**
 * Theme, shared across the mobile app.
 *
 * Deliberately the SAME `ems-theme` key and `html.light` class the web app
 * already uses, so one product has one theme rather than two that disagree
 * after a user switches surface. app/layout.tsx applies the class before paint.
 *
 * This is a context rather than a plain hook because more than the header cares:
 * the 3D hero has to re-light itself for the light ground, and a per-instance
 * useState would leave it on the dark rig until the next full reload.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

interface ThemeCtx { theme: Theme; toggle: () => void }

const Ctx = createContext<ThemeCtx>({ theme: "dark", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // Read what the pre-paint script in app/layout.tsx already decided.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.classList.toggle("light") ? "light" : "dark";
    try { localStorage.setItem("ems-theme", next); } catch { /* private mode */ }
    setTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
