"use client";

/**
 * Control lock — a password re-check before any control write (pair charge/discharge, automation
 * save). The operator is signed in already, but a physical-dispatch action asks for the login
 * password once; after that controls stay unlocked for the rest of the page session.
 *
 * Verification reuses the real sign-in (POST /api/central/auth/login with the session email), so
 * no new backend surface — a 200 means the password is right. The returned token is ignored.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { getSession } from "@/lib/central";

// Module-level so one unlock covers every Strategy view; a reload re-locks.
let unlocked = false;
const subs = new Set<() => void>();
const isUnlocked = () => unlocked;
function emit() { subs.forEach((f) => f()); }
function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

async function verifyPassword(password: string): Promise<Response> {
  const s = getSession();
  return fetch("/api/central/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: s?.email ?? "", password }),
    cache: "no-store",
  });
}

export function usePasswordGate() {
  const on = useSyncExternalStore(subscribe, isUnlocked, () => false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /** Run `action` now if unlocked, else prompt for the password and run it on success. */
  const requireAuth = useCallback((action: () => void) => {
    if (isUnlocked()) { action(); return; }
    setErr(""); setPw(""); setPending(() => action); setOpen(true);
  }, []);

  const close = () => { setOpen(false); setPending(null); setPw(""); setErr(""); };

  const relock = useCallback(() => { unlocked = false; emit(); }, []);

  const submit = async () => {
    if (!pw) { setErr("Enter your password."); return; }
    setBusy(true); setErr("");
    try {
      const r = await verifyPassword(pw);
      if (r.status === 401) { setErr("Incorrect password."); return; }
      if (!r.ok) { setErr(`Verification failed (${r.status}).`); return; }
      unlocked = true; emit();
      const a = pending; close(); a?.();
    } catch {
      setErr("Could not verify — check your connection.");
    } finally { setBusy(false); }
  };

  const gate = open ? (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-sm mt-24 rounded-xl bg-surface2 border border-line p-5 shadow-xl">
        <div className="text-[14px] font-semibold text-ink mb-1">Confirm your password</div>
        <p className="text-[12px] text-muted mb-3">Control operations are protected. Enter your login password to unlock.</p>
        {err && <div className="text-[12px] text-bad mb-2">{err}</div>}
        <input type="password" autoFocus value={pw} autoComplete="current-password"
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full mb-4 px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink" />
        <div className="flex items-center justify-end gap-2">
          <button onClick={close} className="px-3 py-1.5 rounded-md border border-line text-[12.5px] text-ink3">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-1.5 rounded-md bg-accent text-white text-[12.5px] font-semibold disabled:opacity-60">
            {busy ? "Verifying…" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { unlocked: on, requireAuth, relock, gate };
}
