"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Volume2, VolumeX, ChevronDown, User, Users, LogOut, Sun, Moon, Activity, Settings } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { logout, getSession, subscribe, activeSiteName } from "@/lib/central";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchAlarms as fetchAlarmsCentral } from "@/lib/api/services/alarmsCentral.service";
import { ackKey, ackedAt, acksVersion, subscribeAcks } from "@/lib/alarms/ack";
import { PushAlerts } from "@/components/alarms/PushAlerts";

const TABS: { label: string; path: string }[] = [
  { label: "Dashboard",                 path: "/dashboard" },
  /* The only tab currently backed by live data: S1 fast-BESS off the central
     backend. The rest still read the disabled NorthBound seam and render
     empty — see docs/central-backend-s1-contract.md. */
  // Hidden from the nav for now; the page itself still works at its URL.
  // { label: "Live BESS",              path: "/live-bess" },
  /* S2: everything the gateway reads outside the battery and inverter. */
  // Hidden from the nav for now; the page itself still works at its URL.
  // { label: "Assets",                 path: "/asset-telemetry" },
  // History — hidden with the page itself; see app/(ems)/history/page.tsx,
  // which keeps the original component commented out. Restore both together.
  // { label: "History",                path: "/history" },
  { label: "Power Station",             path: "/power-station" },
  { label: "Equipment",                 path: "/equipment" },
  { label: "Alarms",                    path: "/alarms" },
  /* Named Genie; the address stays /curve-report so links keep working. */
  { label: "Genie",                     path: "/curve-report" },
  { label: "Analysis",                  path: "/data-analysis" },
  { label: "Strategy",                  path: "/strategy" },
  /* Gateway Health is NOT here. It describes the backend link rather than the
     plant, so it lives in the account menu below, next to the identity it
     belongs with, rather than competing with the monitoring tabs. */
  // SCADA and Tag Mapping are switched off for now — see their page.tsx files.
  // { label: "SCADA",                     path: "/scada" },
  // { label: "Tag Mapping",               path: "/tag-mapping" },
];

/**
 * How many alarm flags are raised right now, for the bell.
 *
 * The same derivation Alarm Monitoring lists (alarmsCentral: fault bits in S2
 * that are unitless, not a `_value`, named for a failure, and non-zero) — there
 * is no alarm endpoint, so this is a count of raised flags, not of events.
 * It reads all nine S2 substreams, so it polls once a minute rather than on
 * the 30 s cadence — including while the tab is hidden, because the alarm
 * sound depends on it. undefined = not known, which is not zero.
 */
function useActiveAlarms() {
  const { gatewayId } = useAppConfig();
  const { data } = useQuery({
    queryKey: ["central", "alarmCount", gatewayId],
    queryFn: () => fetchAlarmsCentral(gatewayId, { page: 1, size: 200 }),
    enabled: gatewayId.length > 0,
    refetchInterval: 60_000,
    /* Keeps polling in a background tab: the sound is for when nobody is looking. */
    refetchIntervalInBackground: true,
    staleTime: 110_000,
    retry: false,
  });
  return data;
}

/* ── The alarm sound ──────────────────────────────────────────────────────────
   Any active alarm this browser has not acknowledged sounds as soon as it is
   seen, then again every 15 minutes until it clears, is acknowledged on the
   Alarms page, or the speaker is muted. Mute is remembered per browser.

   Browsers start audio only after the page has had a click, tap or key press.
   One AudioContext is kept and unlocked on the first gesture; a sound due
   before then plays at that gesture rather than being lost. On phones a touch
   counts on touchend / pointerup, not pointerdown, so all are listened for.
   iOS plays Web Audio through the ringer channel, which the silent switch
   mutes — the "playback" audio session (Safari 17+) takes it off that channel.
   Android also vibrates. A phone that has locked its screen or put the browser
   in the background runs no script at all, so nothing here can sound then. */
const MUTE_KEY = "ems.alarmMuted";
const REPEAT_MS = 15 * 60_000;

let audio: AudioContext | null = null;
let pendingSound = false;

function audioCtx(): AudioContext | null {
  if (audio) return audio;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    audio = new Ctx();
  } catch { /* no audio: the badge still shows */ }
  return audio;
}

/** Three bursts of a two-tone siren, about two seconds. */
function alarmSound() {
  try { navigator.vibrate?.([400, 150, 400, 150, 400]); } catch { /* not supported (iOS) */ }
  const ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state !== "running") {
    pendingSound = true;
    void ctx.resume().then(() => { if (ctx.state === "running" && pendingSound) { pendingSound = false; play(ctx); } }).catch(() => {});
    return;
  }
  play(ctx);
}

function play(ctx: AudioContext) {
  const t0 = ctx.currentTime + 0.02;
  for (let burst = 0; burst < 3; burst++) {
    [0, 0.22].forEach((at, i) => {
      const start = t0 + burst * 0.7 + at;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = i ? 660 : 880;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(start); o.stop(start + 0.22);
    });
  }
}

/* Unlock on the first gesture, and play anything that came due before it. */
function useAudioUnlock() {
  useEffect(() => {
    const unlock = () => {
      const ctx = audioCtx();
      if (!ctx) return;
      void ctx.resume().then(() => {
        if (pendingSound && ctx.state === "running") { pendingSound = false; play(ctx); }
      }).catch(() => {});
    };
    const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    /* A phone that comes back from the lock screen hands back a suspended or
       "interrupted" context; the next tap above resumes it. */
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);
}

function useAlarmSound(records: { id: string; raisedAt?: string; status: string }[] | undefined, muted: boolean) {
  useAudioUnlock();
  const acks = useSyncExternalStore(subscribeAcks, acksVersion, () => "");
  const heard = useRef(new Set<string>());
  const lastSound = useRef(0);

  /* Alarms that should be making noise: active, not acknowledged here. */
  const ringing = (records ?? [])
    .filter((a) => a.status === "active" && ackedAt(a) == null)
    .map(ackKey);
  const ringKey = ringing.join("|");

  useEffect(() => {
    if (muted) { pendingSound = false; return; }
    if (!ringing.length) { pendingSound = false; return; }
    const fresh = ringing.some((k) => !heard.current.has(k));
    ringing.forEach((k) => heard.current.add(k));
    if (fresh || Date.now() - lastSound.current >= REPEAT_MS) {
      lastSound.current = Date.now();
      alarmSound();
    }
    const id = window.setInterval(() => {
      lastSound.current = Date.now();
      alarmSound();
    }, REPEAT_MS - (Date.now() - lastSound.current));
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringKey, muted, acks]);
}

/* ── The alarm aura ───────────────────────────────────────────────────────────
   The same alarms that sound (active, not acknowledged here) also flash a red
   glow round the whole portal: when first seen, then every 5 minutes until they
   clear or are acknowledged. Muting the speaker does not stop it — it is the
   alarm for a room that cannot hear. A hidden tab skips the flash it cannot
   show; the next one comes 5 minutes later. Returns a counter that changes on
   each flash, used as the overlay's key so its animation restarts. */
const AURA_MS = 5 * 60_000;

function useAlarmAura(records: { id: string; raisedAt?: string; status: string }[] | undefined) {
  const acks = useSyncExternalStore(subscribeAcks, acksVersion, () => "");
  const seen = useRef(new Set<string>());
  const last = useRef(0);
  const [flash, setFlash] = useState(0);

  const ringing = (records ?? [])
    .filter((a) => a.status === "active" && ackedAt(a) == null)
    .map(ackKey);
  const ringKey = ringing.join("|");

  useEffect(() => {
    if (!ringing.length) { setFlash(0); return; }
    const fire = () => { last.current = Date.now(); setFlash((n) => n + 1); };
    const fresh = ringing.some((k) => !seen.current.has(k));
    ringing.forEach((k) => seen.current.add(k));
    if (fresh || Date.now() - last.current >= AURA_MS) fire();
    let id = 0;
    const timeout = window.setTimeout(() => {
      fire();
      id = window.setInterval(fire, AURA_MS);
    }, Math.max(0, AURA_MS - (Date.now() - last.current)));
    return () => { window.clearTimeout(timeout); window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringKey, acks]);

  return flash;
}

export function TopBar() {
  const pathname = usePathname();
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    try { setMutedState(localStorage.getItem(MUTE_KEY) === "1"); } catch { /* default: sound on */ }
  }, []);
  const setMuted = (m: boolean) => {
    setMutedState(m);
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* session only */ }
    if (!m) alarmSound();   // unmuting plays it once, so the operator knows what to listen for
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLight, setIsLight] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* The session lives in browser storage, so it is read through an external
     store rather than during render — the server has no token and would
     otherwise render a different name than the client hydrates with. */
  const session = useSyncExternalStore(subscribe, () => getSession(), () => null);

  /* The account as the gateway knows it. There is no display name to fall back
     to: gateway accounts are usernames (`customer`, `customer_admin`), not
     people with first and last names, and inventing one would be inventing a
     person. */
  const displayName = session?.username ?? "Account";

  const alarmData = useActiveAlarms();
  const alarmCount = alarmData?.total;
  useAlarmSound(alarmData?.records, muted);
  const auraFlash = useAlarmAura(alarmData?.records);

  // Sync theme state on mount
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function toggleTheme() {
    const html = document.documentElement;
    const next = !html.classList.contains("light");
    html.classList.toggle("light", next);
    try { localStorage.setItem("ems-theme", next ? "light" : "dark"); } catch {}
    setIsLight(next);
  }

  function handleSignOut() {
    logout();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }

  return (
    <>
    {auraFlash > 0 && <div key={auraFlash} className="alarm-aura" aria-hidden />}
    {/* No bottom border: the SubHeader directly beneath carries one, and two
        stacked hairlines made the chrome read as two separate strips rather than
        one block of page furniture. */}
    <header className="sticky top-0 z-40 bg-surface2 border-b border-line">
      <div className="app-shell min-h-12 flex flex-wrap items-center gap-x-4">
        {/* Brand. Two renders of the wordmark, one per theme: the dark one has
            light lettering and a lifted teal so it reads on navy. */}
        <Link href="/dashboard" className="flex items-center flex-shrink-0" aria-label="UnityESS home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/unityess-logo.png" alt="UnityESS" width={141} height={20} className="brand-light h-4 sm:h-5 w-auto" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/unityess-logo-dark.png" alt="UnityESS" width={141} height={20} className="brand-dark h-4 sm:h-5 w-auto" />
        </Link>

        {/*
          Tabs. From 1280px they sit between the brand and the icons; below that
          they don't fit beside them, so they take a full-width row of their own
          and scroll sideways. They never wrap within that row — a header that
          changes height as you navigate makes the whole page jump.
        */}
        <nav className="order-last w-full pb-2 xl:order-none xl:w-auto xl:flex-1 xl:pb-0 min-w-0 flex justify-start xl:justify-center">
          <div className="nav-track max-w-full overflow-x-auto no-scrollbar">
            {TABS.map(({ label, path }) => {
              const isActive = pathname === path || (path !== "/dashboard" && pathname.startsWith(path));
              return (
                <Link
                  key={path}
                  href={path}
                  aria-current={isActive ? "page" : undefined}
                  className={isActive ? "nav-pill on" : "nav-pill"}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Right icons */}
        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0 h-12">
          {/* Links to Alarm Monitoring. The badge shows only when something is
              raised; an unknown count shows no badge rather than a 0. */}
          <Link
            href="/alarms"
            title={
              alarmCount === undefined ? "Alarms — count not available"
              : alarmCount === 0 ? "No active alarms"
              : `${alarmCount} active alarm${alarmCount === 1 ? "" : "s"}`
            }
            className="relative w-9 h-9 grid place-items-center rounded-full text-ink3 hover:text-ink hover:bg-surface3/80 transition-colors"
          >
            <Bell size={15} />
            {alarmCount !== undefined && alarmCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-bad text-white text-[9px] font-semibold leading-[15px] text-center">
                {alarmCount > 99 ? "99+" : alarmCount}
              </span>
            )}
          </Link>
          {/* On phones too: the alarm sounds there, so it must be mutable there. */}
          <IconButton
            title={muted ? "Alarm sound off — tap to turn on" : "Alarm sound on: sounds for each active alarm, every 15 min until acknowledged — tap to mute"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={15} className="opacity-60" /> : <Volume2 size={15} />}
          </IconButton>
          <IconButton title={isLight ? "Switch to dark" : "Switch to light"} onClick={toggleTheme}>
            {isLight ? <Moon size={15} /> : <Sun size={15} />}
          </IconButton>
          <div className="hidden sm:block w-px h-5 bg-line2 mx-2" />

          {/* Profile dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="h-9 pl-1.5 pr-1.5 sm:pr-2.5 flex items-center gap-2 rounded-full border border-line hover:border-line2 hover:bg-surface3/70 text-[12.5px] text-ink2 transition-colors"
              title="Profile"
            >
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-surface3 to-surface2 ring-1 ring-line2 grid place-items-center text-ink3">
                <User size={11} />
              </span>
              <span className="hidden sm:inline font-medium text-ink">{displayName}</span>
              <ChevronDown
                size={13}
                className={`text-muted transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-60 rounded-xl bg-surface2 border border-line z-50 py-1 overflow-hidden"
                style={{ boxShadow: "var(--shadow-pop)" }}
              >
                <div className="px-3 py-2 border-b border-line">
                  <div className="text-[12px] font-semibold text-ink">{displayName}</div>
                  {/* Which backend this account is signed in to, not an email.
                      It said "NorthBound Gateway" until 24 Sep 2026; the session
                      is now minted by the central backend, and naming the wrong
                      one here would misreport where the data comes from. */}
                  <div className="text-[11px] text-muted truncate">
                    {activeSiteName() || "UnityESS Central EMS"}
                  </div>
                </div>
                <Link
                  href="/gateway-health"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-ink3 hover:bg-surface3 transition-colors"
                >
                  <Activity size={13} />
                  Gateway Health
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-ink3 hover:bg-surface3 transition-colors"
                >
                  <Settings size={13} />
                  Settings
                </Link>
                <Link
                  href="/admin-users"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-ink3 hover:bg-surface3 transition-colors"
                >
                  <Users size={13} />
                  User Monitor
                </Link>
                <PushAlerts />
                <div className="border-t border-line" />
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-bad hover:bg-bad/10 transition-colors"
                >
                  <LogOut size={13} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
    </>
  );
}

function IconButton({
  children, onClick, title,
}: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      // Surface token rather than white/[.04]: a white overlay is invisible on
      // the light theme's white chrome, so the hover state vanished there.
      className="w-9 h-9 grid place-items-center rounded-full text-ink3 hover:text-ink hover:bg-surface3/80 transition-colors"
    >
      {children}
    </button>
  );
}
