"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { disablePush, enablePush, pushState, testPush, type PushState } from "@/lib/push/client";

/* A short status word in place of On / Off when the toggle cannot work here. */
const STATUS: Partial<Record<PushState, string>> = {
  "ios-needs-home": "Add To Home Screen",
  unconfigured: "Not Set Up",
  denied: "Blocked",
  unsupported: "Unsupported",
};

/**
 * The account menu's lock-screen alerts row: alarm notifications that reach
 * this device even while it is locked (lib/server/push/push.ts).
 */
export function PushAlerts() {
  const { gatewayId } = useAppConfig();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);

  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true); setMsg(null);
    try { setState(await fn()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  if (state === null) return null;
  const on = state === "on";
  const canToggle = on || state === "off";

  return (
    <div className="px-3 py-2 border-t border-line">
      <button
        disabled={!canToggle || busy}
        onClick={() => run(on ? disablePush : enablePush)}
        className="w-full flex items-center gap-2.5 text-[12.5px] text-ink3 hover:text-ink disabled:opacity-60 transition-colors"
      >
        {on ? <BellRing size={13} className="text-good" /> : <BellOff size={13} />}
        <span className="flex-1 text-left">Lock-Screen Alerts</span>
        <span className={`text-[11px] font-mono ${on ? "text-good" : "text-muted"}`}>{busy ? "…" : on ? "On" : STATUS[state] ?? "Off"}</span>
      </button>
      {on && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true); setMsg(null);
            try {
              const r = await testPush(gatewayId);
              setMsg(r.sent ? (r.ringing ? `Sent: ${r.ringing} Active Alarm${r.ringing === 1 ? "" : "s"}` : "Test Alert Sent") : "Not Delivered");
            } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
          }}
          className="mt-1 text-[11px] text-accent hover:underline disabled:opacity-60"
        >
          Send A Test Alert
        </button>
      )}
      {msg && <p className="mt-1 text-[11px] text-muted leading-snug">{msg}</p>}
    </div>
  );
}
