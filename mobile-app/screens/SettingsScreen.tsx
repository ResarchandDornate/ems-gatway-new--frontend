"use client";

/**
 * Settings — theme, notification preferences, session, about.
 *
 * The notification toggles are stored locally and marked as such. They are not
 * wired to a push service because none exists yet (§12 is a backend build), and
 * a toggle that silently does nothing is worse than one that says so.
 */

import { useEffect, useState } from "react";
import { Moon, Bell, TriangleAlert, Info, Building2, ChevronRight } from "lucide-react";
import { useMobileStation } from "../data";
import { Header } from "../components/Header";
import { FloatingCard, SectionHeader, ListItem, Toggle } from "../components";
import { useTheme } from "../useTheme";

const PREF_KEY = "EMS_M_NOTIFY";

type Prefs = { critical: boolean; warning: boolean; advisory: boolean };
const DEFAULTS: Prefs = { critical: true, warning: true, advisory: false };

export function SettingsScreen() {
  const { theme, toggle } = useTheme();
  const { station, stations } = useMobileStation();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch { /* private mode — defaults stand */ }
  }, []);

  const set = (k: keyof Prefs) => (v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <>
      <Header />

      <div style={{ padding: "0 4px 18px" }}>
        <span className="m-h1 m-ink">Settings</span>
      </div>

      <SectionHeader title="Appearance" />
      <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ListItem
          leading={<Moon size={17} />}
          title="Dark theme"
          subtitle="Shared with the web app"
          trailing={<Toggle checked={theme === "dark"} onChange={toggle} label="Dark theme" />}
        />
      </FloatingCard>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Notifications" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<TriangleAlert size={17} />}
            title="Critical faults"
            subtitle="Fire, isolation, thermal"
            trailing={<Toggle checked={prefs.critical} onChange={set("critical")} label="Critical faults" />}
          />
          <ListItem
            leading={<Bell size={17} />}
            title="Warnings"
            subtitle="Comms loss, derate, imbalance"
            trailing={<Toggle checked={prefs.warning} onChange={set("warning")} label="Warnings" />}
          />
          <ListItem
            leading={<Info size={17} />}
            title="Advisory digest"
            subtitle="Daily summary"
            trailing={<Toggle checked={prefs.advisory} onChange={set("advisory")} label="Advisory digest" />}
          />
        </FloatingCard>
        <div className="m-label m-ink3" style={{ padding: "10px 6px 0", lineHeight: 1.5 }}>
          Saved on this device only. Push delivery needs the alarm engine and APNs/FCM
          from §12, which are not deployed yet.
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Account" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<Building2 size={17} />}
            title="Stations"
            subtitle={`${stations.length} assigned · ${station?.powerStationEnglishName ?? "none selected"}`}
            trailing={<ChevronRight size={16} className="m-ink3" />}
          />
        </FloatingCard>
      </div>

      <div className="m-label m-ink3" style={{ textAlign: "center", padding: "26px 0 6px", lineHeight: 1.6 }}>
        UnityESS · Ornate Agencies Pvt. Ltd.<br />
        Mobile prototype · design system v1.0
      </div>
    </>
  );
}
