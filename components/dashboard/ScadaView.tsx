"use client";

/**
 * ScadaView — full-screen BESS operator dashboard.
 *
 * Data sources:
 *  • useBessLive(station.id)  → polls UGX every 30 s
 *  • useIntradayData(id)      → 24-hour intraday for the bottom charts
 *  • useStationSummary(id)    → KPIs & alarm count
 */

import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import type { Station } from "@/lib/api/types";
import { useStationSummary, useIntradayData } from "@/hooks/usePowerStation";
import { useBessLiveCentral as useBessLive } from "@/hooks/useBessLiveCentral";

// ── Palette ───────────────────────────────────────────────────────────────────
const P = {
  bg:      "#050A12",
  panel:   "#0A1020",
  panel2:  "#0D1528",
  border:  "#182030",
  hdr:     "#0B1422",
  cyan:    "#00DCFF",
  amber:   "#FFB300",
  green:   "#00E676",
  red:     "#FF3B30",
  blue:    "#5B8DEF",
  white:   "#F0F4F8",
  muted:   "#5A6880",
  grid:    "#111C2A",
  navyBg:  "#06101E",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRunDays(iso: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function fmtKw(v: number): string {
  return `${Math.abs(v).toFixed(2)} kW`;
}

/** Format a possibly-missing reading; null → "—" (never a fabricated number). */
function fmtOrDash(v: number | null, digits: number, suffix = ""): string {
  return v == null ? "—" : v.toFixed(digits) + suffix;
}

function fmtInstall(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit" });
}

const tooltipStyle = {
  background:   "rgba(5,10,18,.97)",
  border:       "1px solid #182030",
  borderRadius: 6,
  fontSize:     11,
  color:        "#F0F4F8",
  padding:      "6px 10px",
};

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick:     { fill: "#5A6880", fontSize: 10 },
} as const;

// ── EnergyFlow — single-line diagram + BATTERY · LIVE panel ──────────────────
//
// Topology mirrors the site: GRID ──(import)── ┬ ──(site load)── LOAD
//                                              │            ▲
//                                          BATTERY·PCS    SOLAR
// Every figure comes from the live hook; null renders "—" and dims its branch.

function Chip({ x, y, value, caption, color, active }: {
  x: number; y: number; value: string; caption: string; color: string; active: boolean;
}) {
  const w = Math.max(86, value.length * 8 + 26);
  return (
    <g opacity={active ? 1 : 0.45}>
      <rect x={x - w / 2} y={y - 19} width={w} height={38} rx={9}
        fill="#050B14" stroke={color} strokeWidth="1.3" opacity="0.97"/>
      <text x={x} y={y - 2} textAnchor="middle" fill="#F0F4F8" fontSize="13.5" fontWeight="700">{value}</text>
      <text x={x} y={y + 12} textAnchor="middle" fill={color} fontSize="8" fontWeight="700" letterSpacing="1.2">{caption}</text>
    </g>
  );
}

/** ● label under an icon — dot goes green when the branch is live. */
function NodeLabel({ x, y, text, active, color = "#8FA8C0" }: {
  x: number; y: number; text: string; active: boolean; color?: string;
}) {
  return (
    <g>
      <circle cx={x - text.length * 3.6 - 8} cy={y - 3.5} r="2.5" fill={active ? "#00E676" : "#3A5068"}/>
      <text x={x} y={y} textAnchor="middle" fill={active ? color : "#3A5068"}
        fontSize="11" fontWeight="700" letterSpacing="3">{text}</text>
    </g>
  );
}

function PanelRow({ label, value, unit, color = "#F0F4F8", big = false }: {
  label: string; value: string; unit?: string; color?: string; big?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "clamp(4px,0.6vh,9px) 0", borderBottom: "1px solid #16283C" }}>
      <span style={{ color: "#7090B0", fontSize: "clamp(9px,0.72vw,11.5px)", letterSpacing: "1.6px", fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontSize: big ? "clamp(20px,1.7vw,28px)" : "clamp(13px,1.05vw,17px)", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: "0.62em", fontWeight: 500, color: "#7090B0", marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function EnergyFlow({
  gridKw, loadKw, battKw, solarKw, soc, soh, maxCellTempC, gridHz,
  chargedKwh, dischargedKwh,
}: {
  gridKw: number | null; loadKw: number | null; battKw: number | null; solarKw: number | null;
  soc: number | null; soh: number | null; maxCellTempC: number | null; gridHz: number | null;
  chargedKwh: number | null; dischargedKwh: number | null;
}) {
  // null = no reading; the branch dims and its chip shows "—".
  const gridVal = gridKw ?? 0;
  const loadVal = loadKw ?? 0;
  const battVal = battKw ?? 0;
  const solarVal = solarKw ?? 0;
  const socPct = soc == null ? 0 : Math.min(100, Math.max(0, soc));
  const socColor = socPct > 20 ? "#00E676" : "#FF3B30";

  const isCharging    = battVal < 0;
  const isDischarging = battVal > 0;
  const gridActive  = Math.abs(gridVal)  > 0.001;
  const loadActive  = Math.abs(loadVal)  > 0.001;
  const battActive  = Math.abs(battVal)  > 0.001;
  const solarActive = Math.abs(solarVal) > 0.001;
  const hasSolar    = solarKw != null;

  const battLineColor  = isCharging ? "#00E676" : "#00DCFF";
  const statusText  = battKw == null ? "—" : battVal === 0 ? "Idle" : isCharging ? "Charging" : "Discharging";
  const statusColor = battKw == null || battVal === 0 ? "#5A6880" : isCharging ? "#4AA8FF" : "#00E676";

  const gridDur  = Math.max(1.4, 3.2 - Math.abs(gridVal) / 80);
  const loadDur  = Math.max(1.4, 3.2 - Math.abs(loadVal) / 80);
  const battDur  = Math.max(1.4, 3.0 - Math.abs(battVal) / 80);
  const solarDur = Math.max(1.4, 3.0 - Math.abs(solarVal) / 80);

  const fmtChip = (v: number | null) => (v == null ? "—" : `${Math.abs(v).toFixed(1)} kW`);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, gap: "clamp(8px,0.9vw,16px)" }}>

      {/* ═════════ DIAGRAM ═════════ */}
      <svg viewBox="0 0 1080 430" style={{ flex: 1, minWidth: 0, height: "100%" }}
        xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="ef-bg" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#0A1A2E"/><stop offset="60%" stopColor="#06101E"/><stop offset="100%" stopColor="#030810"/>
          </radialGradient>
          <radialGradient id="ef-pedestal" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3A8BFF" stopOpacity="0.55"/><stop offset="55%" stopColor="#1E4A8C" stopOpacity="0.30"/><stop offset="100%" stopColor="#0A1A2E" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="ef-pedestal-o" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF9E3A" stopOpacity="0.45"/><stop offset="55%" stopColor="#8C5A1E" stopOpacity="0.25"/><stop offset="100%" stopColor="#0A1A2E" stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="ef-tower-shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3A4858"/><stop offset="100%" stopColor="#7A8898"/>
          </linearGradient>
          <linearGradient id="ef-bldg-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D8DFE8"/><stop offset="100%" stopColor="#9CA8B8"/>
          </linearGradient>
          <linearGradient id="ef-bldg-side" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7A8898"/><stop offset="100%" stopColor="#4A5868"/>
          </linearGradient>
          <linearGradient id="ef-bldg-roof" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E8EFF8"/><stop offset="100%" stopColor="#B0BCCC"/>
          </linearGradient>
          <linearGradient id="ef-batt-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2E8F0"/><stop offset="100%" stopColor="#A0AAB8"/>
          </linearGradient>
          <linearGradient id="ef-batt-side" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7A8898"/><stop offset="100%" stopColor="#4A5868"/>
          </linearGradient>
          <linearGradient id="ef-batt-roof" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F0F4F8"/><stop offset="100%" stopColor="#B0BCCC"/>
          </linearGradient>
          <linearGradient id="ef-sol-cell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2A4A7A"/><stop offset="100%" stopColor="#16283C"/>
          </linearGradient>
          <radialGradient id="ef-dot-c" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF"/><stop offset="35%" stopColor="#7EEEFF"/><stop offset="100%" stopColor="#00DCFF" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="ef-dot-o" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF"/><stop offset="35%" stopColor="#FFD089"/><stop offset="100%" stopColor="#FF8C00" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="ef-dot-g" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF"/><stop offset="35%" stopColor="#8FF5BB"/><stop offset="100%" stopColor="#00E676" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="ef-dot-y" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF"/><stop offset="35%" stopColor="#FFE28A"/><stop offset="100%" stopColor="#F0A500" stopOpacity="0"/>
          </radialGradient>
          <filter id="ef-glow-sm" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <pattern id="ef-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#14304A" opacity="0.5"/>
          </pattern>

          {/* Motion paths (separate reverse ids so direction follows sign) */}
          <path id="ef-pg"   d="M195,225 L505,225" fill="none"/>
          <path id="ef-pg-r" d="M505,225 L195,225" fill="none"/>
          <path id="ef-pl"   d="M505,225 L940,225" fill="none"/>
          <path id="ef-pb-d" d="M505,240 L505,325" fill="none"/>
          <path id="ef-pb-u" d="M505,325 L505,240" fill="none"/>
          <path id="ef-ps"   d="M760,150 L760,225" fill="none"/>
        </defs>

        {/* Background: vignette + dot grid */}
        <rect x="0" y="0" width="1080" height="430" fill="url(#ef-bg)" rx="12"/>
        <rect x="14" y="14" width="1052" height="402" fill="url(#ef-dots)" rx="8"/>

        {/* Corner brackets */}
        {[
          "M30,58 L30,32 L56,32", "M1050,58 L1050,32 L1024,32",
          "M30,372 L30,398 L56,398", "M1050,372 L1050,398 L1024,398",
        ].map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#2E5A80" strokeWidth="2" opacity="0.7"/>
        ))}

        {/* ─── Connection lines ─── */}
        {/* dim base tracks */}
        <line x1="195" y1="225" x2="940" y2="225" stroke="#0F2238" strokeWidth="3"/>
        <line x1="505" y1="240" x2="505" y2="325" stroke="#0F2238" strokeWidth="3"/>
        {hasSolar && <line x1="760" y1="150" x2="760" y2="225" stroke="#0F2238" strokeWidth="3"/>}

        {/* grid → junction (cyan) */}
        <line x1="195" y1="225" x2="505" y2="225" stroke="#00DCFF" strokeWidth="7" opacity={gridActive ? 0.12 : 0} filter="url(#ef-glow-sm)"/>
        <line x1="195" y1="225" x2="505" y2="225" stroke="#00DCFF" strokeWidth="3" opacity={gridActive ? 1 : 0.22}/>

        {/* junction → load (orange) */}
        <line x1="505" y1="225" x2="940" y2="225" stroke="#FF8C00" strokeWidth="7" opacity={loadActive ? 0.12 : 0} filter="url(#ef-glow-sm)"/>
        <line x1="505" y1="225" x2="940" y2="225" stroke="#FF8C00" strokeWidth="3" opacity={loadActive ? 1 : 0.22}/>

        {/* junction ↕ battery */}
        <line x1="505" y1="240" x2="505" y2="325" stroke={battLineColor} strokeWidth="7" opacity={battActive ? 0.12 : 0} filter="url(#ef-glow-sm)"/>
        <line x1="505" y1="240" x2="505" y2="325" stroke={battLineColor} strokeWidth="3" opacity={battActive ? 1 : 0.22}/>

        {/* solar ↓ line (amber) */}
        {hasSolar && (<>
          <line x1="760" y1="150" x2="760" y2="225" stroke="#F0A500" strokeWidth="7" opacity={solarActive ? 0.12 : 0} filter="url(#ef-glow-sm)"/>
          <line x1="760" y1="150" x2="760" y2="225" stroke="#F0A500" strokeWidth="3" opacity={solarActive ? 1 : 0.22}/>
        </>)}

        {/* junction nodes */}
        <circle cx="505" cy="225" r="10" fill="#040A14" stroke="#00DCFF" strokeWidth="1.5"/>
        <circle cx="505" cy="225" r="4.5" fill="#00DCFF">
          {(battActive || loadActive) && <animate attributeName="opacity" values="0.95;0.4;0.95" dur="2s" repeatCount="indefinite"/>}
        </circle>
        {hasSolar && (<>
          <circle cx="760" cy="225" r="8" fill="#040A14" stroke="#F0A500" strokeWidth="1.4" opacity={solarActive ? 1 : 0.4}/>
          <circle cx="760" cy="225" r="3.5" fill="#F0A500" opacity={solarActive ? 0.95 : 0.3}/>
        </>)}
        {/* inline rings */}
        <circle cx="330" cy="225" r="8" fill="#040A14" stroke="#00DCFF" strokeWidth="1.4" opacity={gridActive ? 1 : 0.4}/>
        <circle cx="330" cy="225" r="3" fill="#00DCFF" opacity={gridActive ? 0.95 : 0.3}/>
        <circle cx="505" cy="282" r="7" fill="#040A14" stroke={battLineColor} strokeWidth="1.3" opacity={battActive ? 1 : 0.4}/>
        <circle cx="505" cy="282" r="2.5" fill={battLineColor} opacity={battActive ? 0.95 : 0.3}/>

        {/* ─── Animated dots ─── */}
        {gridActive && [0, gridDur / 3, (2 * gridDur) / 3].map((begin, i) => (
          <circle key={"g" + i} r={5.5} fill="url(#ef-dot-c)" filter="url(#ef-glow-sm)">
            <animateMotion dur={gridDur + "s"} begin={begin + "s"} repeatCount="indefinite">
              <mpath href={gridVal >= 0 ? "#ef-pg" : "#ef-pg-r"}/>
            </animateMotion>
          </circle>
        ))}
        {loadActive && [0, loadDur / 3, (2 * loadDur) / 3].map((begin, i) => (
          <circle key={"l" + i} r={5.5} fill="url(#ef-dot-o)" filter="url(#ef-glow-sm)">
            <animateMotion dur={loadDur + "s"} begin={begin + "s"} repeatCount="indefinite"><mpath href="#ef-pl"/></animateMotion>
          </circle>
        ))}
        {battActive && [0, battDur / 2].map((begin, i) => (
          <circle key={"b" + i} r={5} fill={isCharging ? "url(#ef-dot-g)" : "url(#ef-dot-c)"} filter="url(#ef-glow-sm)">
            <animateMotion dur={battDur + "s"} begin={begin + "s"} repeatCount="indefinite">
              <mpath href={isCharging || !isDischarging ? "#ef-pb-d" : "#ef-pb-u"}/>
            </animateMotion>
          </circle>
        ))}
        {solarActive && [0, solarDur / 2].map((begin, i) => (
          <circle key={"s" + i} r={5} fill="url(#ef-dot-y)" filter="url(#ef-glow-sm)">
            <animateMotion dur={solarDur + "s"} begin={begin + "s"} repeatCount="indefinite"><mpath href="#ef-ps"/></animateMotion>
          </circle>
        ))}

        {/* ─── Pedestals ─── */}
        <ellipse cx="135" cy="330" rx="46" ry="9" fill="url(#ef-pedestal)" opacity={gridActive ? 1 : 0.45}/>
        <ellipse cx="505" cy="404" rx="46" ry="9" fill="url(#ef-pedestal)" opacity={battActive ? 1 : 0.45}/>
        <ellipse cx="950" cy="330" rx="46" ry="9" fill="url(#ef-pedestal-o)" opacity={loadActive ? 1 : 0.45}/>

        {/* ═══ GRID TOWER ═══ */}
        <g transform="translate(135,304)" opacity={gridActive ? 1 : 0.55}>
          <polygon points="-22,12 0,20 22,12 0,4" fill="#3A4858" stroke="#2A3848" strokeWidth="0.6"/>
          <polygon points="-14,8 -10,8 -4,-46 -5,-46" fill="url(#ef-tower-shade)" stroke="#2A3848" strokeWidth="0.4"/>
          <polygon points="14,8 10,8 4,-46 5,-46" fill="url(#ef-tower-shade)" stroke="#2A3848" strokeWidth="0.4"/>
          {[6, -6, -18, -30, -40].map((y, i) => {
            const w = Math.max(5, 14 - (6 - y) * 0.18);
            return <line key={i} x1={-w} y1={y} x2={w} y2={y} stroke="#8090A4" strokeWidth="0.9"/>;
          })}
          {[[6, -6], [-6, -18], [-18, -30], [-30, -40]].map(([y1, y2], i) => {
            const w1 = Math.max(5, 14 - (6 - y1) * 0.18);
            const w2 = Math.max(5, 14 - (6 - y2) * 0.18);
            return (
              <g key={i}>
                <line x1={-w1} y1={y1} x2={w2} y2={y2} stroke="#8090A4" strokeWidth="0.7"/>
                <line x1={w1} y1={y1} x2={-w2} y2={y2} stroke="#8090A4" strokeWidth="0.7"/>
              </g>
            );
          })}
          <rect x="-5" y="-46" width="10" height="2" fill="#9CA8B8"/>
          <line x1="0" y1="-46" x2="0" y2="-58" stroke="#A0AAB8" strokeWidth="1.1"/>
          <circle cx="0" cy="-60" r="1.2" fill="#FF3030" opacity={gridActive ? 1 : 0.4}>
            {gridActive && <animate attributeName="opacity" values="1;0.25;1" dur="1.5s" repeatCount="indefinite"/>}
          </circle>
          <g stroke="#9CA8B8" strokeWidth="0.9" strokeLinecap="round">
            <line x1="-12" y1="-22" x2="12" y2="-22"/><line x1="-14" y1="-34" x2="14" y2="-34"/>
          </g>
          <g fill="#D8DFE8">
            <circle cx="-10" cy="-22" r="1.1"/><circle cx="0" cy="-22" r="1.1"/><circle cx="10" cy="-22" r="1.1"/>
            <circle cx="-12" cy="-34" r="1.1"/><circle cx="12" cy="-34" r="1.1"/>
          </g>
        </g>
        <NodeLabel x={135} y={352} text="GRID" active={gridActive}/>

        {/* ═══ BATTERY · PCS CABINET (below junction) ═══ */}
        <g transform="translate(505,376)" opacity={battActive ? 1 : 0.7}>
          <polygon points="-28,12 0,22 28,12 0,2" fill="#3A4858" stroke="#2A3848" strokeWidth="0.8"/>
          <polygon points="-28,12 -28,16 0,26 0,22" fill="#2A3848"/>
          <polygon points="28,12 28,16 0,26 0,22" fill="#1E2C3C"/>
          <polygon points="14,-30 14,6 0,12 0,-24" fill="url(#ef-batt-side)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-14,-30 14,-30 14,6 -14,6" fill="url(#ef-batt-face)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-14,-30 14,-30 0,-24 -28,-24" fill="url(#ef-batt-roof)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-28,-24 -28,-18 -14,-22 -14,-28" fill="#5A6878"/>
          <line x1="-22" y1="-26" x2="-3" y2="-21" stroke="#3A4858" strokeWidth="0.4"/>
          <line x1="-21" y1="-23" x2="-4" y2="-18" stroke="#3A4858" strokeWidth="0.4"/>
          <rect x="-6" y="-22" width="12" height="14" fill="#1A2838" rx="1.5" stroke="#0A1220" strokeWidth="0.3"/>
          <path d="M2,-20 L-4,-13 L0,-13 L-3,-9 L4,-15 L0,-15 Z" fill={battActive ? "#FFFFFF" : "rgba(255,255,255,0.45)"}>
            {battActive && <animate attributeName="opacity" values="1;0.55;1" dur="1.2s" repeatCount="indefinite"/>}
          </path>
          <rect x="-10" y="-4" width="20" height="2.4" fill="#0D1E32" rx="1"/>
          <rect x="-10" y="-4" width={Math.round(20 * socPct / 100)} height="2.4" fill={socColor} rx="1" opacity="0.95">
            {battActive && <animate attributeName="opacity" values="0.95;0.55;0.95" dur="1.6s" repeatCount="indefinite"/>}
          </rect>
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#5A6878" strokeWidth="0.4" opacity="0.6"/>
          <line x1="-10" y1="2" x2="10" y2="2" stroke="#5A6878" strokeWidth="0.4" opacity="0.6"/>
        </g>
        <NodeLabel x={505} y={424} text="BATTERY · PCS" active={battActive}/>

        {/* ═══ SOLAR (above, hybrid sites only) ═══ */}
        {hasSolar && (<>
          <g transform="translate(760,118)" opacity={solarActive ? 1 : 0.55}>
            {/* pole + tilted panel, isometric */}
            <line x1="0" y1="30" x2="0" y2="8" stroke="#7A8898" strokeWidth="2"/>
            <polygon points="-34,2 10,-16 34,-4 -10,14" fill="url(#ef-sol-cell)" stroke="#4A78B0" strokeWidth="1"/>
            {/* cell grid lines */}
            {[-23,-12,-1,10,21].map((o, i) => (
              <line key={"a"+i} x1={o} y1={2 - (o + 23) * 0.16} x2={o + 24} y2={-8 - (o + 23) * 0.16} stroke="#0E1E32" strokeWidth="0.8" opacity="0.9"/>
            ))}
            <polygon points="-34,2 10,-16 34,-4 -10,14" fill="none" stroke="#6AA8F0" strokeWidth="0.5" opacity="0.5"/>
            {/* small sensor */}
            <rect x="-18" y="-26" width="10" height="4" rx="1" fill="#3A4858"/>
          </g>
          <NodeLabel x={760} y={82} text="SOLAR" active={solarActive}/>
        </>)}

        {/* ═══ LOAD BUILDING ═══ */}
        <g transform="translate(950,304)" opacity={loadActive ? 1 : 0.55}>
          <polygon points="-22,12 0,20 22,12 0,4" fill="#3A4858" stroke="#2A3848" strokeWidth="0.6"/>
          <polygon points="14,-50 14,6 0,12 0,-56" fill="url(#ef-bldg-side)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-14,-50 14,-50 14,6 -14,6" fill="url(#ef-bldg-face)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-14,-50 14,-50 0,-56 -28,-56" fill="url(#ef-bldg-roof)" stroke="#2A3848" strokeWidth="0.5"/>
          <polygon points="-14,-50 -28,-56 -28,0 -14,6" fill="#0A1220" opacity="0.4"/>
          <line x1="8" y1="-56" x2="8" y2="-70" stroke="#A0AAB8" strokeWidth="1"/>
          <circle cx="8" cy="-72" r="1.4" fill="#FF3030" opacity={loadActive ? 1 : 0.4}>
            {loadActive && <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite"/>}
          </circle>
          {Array.from({ length: 5 }).map((_, row) =>
            Array.from({ length: 3 }).map((__, col) => {
              const wx = -11 + col * 8;
              const wy = -45 + row * 10;
              const lit = loadActive && ((row * 3 + col) % 3 !== 0);
              return (
                <rect key={`w${row}${col}`} x={wx} y={wy} width="5" height="6.5"
                  fill={lit ? "rgba(120,210,255,0.78)" : "rgba(80,120,160,0.20)"}
                  stroke="rgba(20,30,40,0.4)" strokeWidth="0.25" rx="0.4">
                  {lit && <animate attributeName="opacity" values="1;0.55;1" dur={(2 + (row * 3 + col) * 0.17) + "s"} repeatCount="indefinite"/>}
                </rect>
              );
            })
          )}
          <rect x="-3" y="-3" width="6" height="9" fill="#1A2838" stroke="#0A1220" strokeWidth="0.3" rx="0.4"/>
        </g>
        <NodeLabel x={950} y={352} text="LOAD" active={loadActive} color="#FFB25A"/>

        {/* ─── Value chips ─── */}
        <Chip x={330} y={188} value={fmtChip(gridKw)}
          caption={gridKw != null && gridVal < 0 ? "EXPORT" : "IMPORT"} color="#2E6090" active={gridActive}/>
        <Chip x={588} y={282} value={fmtChip(battKw)}
          caption={battKw == null ? "BATTERY" : isCharging ? "CHARGING" : isDischarging ? "DISCHARGING" : "IDLE"}
          color={battLineColor} active={battActive}/>
        <Chip x={648} y={188} value={fmtChip(loadKw)} caption="SITE LOAD" color="#B06A20" active={loadActive}/>
        {hasSolar && (
          <Chip x={856} y={165} value={fmtChip(solarKw)} caption="SOLAR" color="#B08420" active={solarActive}/>
        )}
      </svg>

      {/* ═════════ BATTERY · LIVE PANEL ═════════ */}
      <div style={{
        width: "clamp(200px, 19vw, 290px)", flexShrink: 0, alignSelf: "stretch",
        border: "1.5px solid #2E5A80", borderRadius: 16,
        background: "linear-gradient(180deg, rgba(10,26,46,0.85), rgba(4,10,20,0.9))",
        padding: "clamp(10px,1.2vh,18px) clamp(12px,1.1vw,20px)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: "clamp(6px,0.8vh,12px)", borderBottom: "1px solid #24405C" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00E676", boxShadow: "0 0 8px #00E676" }}/>
          <span style={{ color: "#C8D8E8", fontSize: "clamp(11px,0.9vw,14px)", fontWeight: 700, letterSpacing: "3px" }}>BATTERY · LIVE</span>
        </div>

        {/* SOC + gradient bar */}
        <div style={{ padding: "clamp(6px,0.9vh,14px) 0 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "#7090B0", fontSize: "clamp(10px,0.8vw,13px)", letterSpacing: "3px", fontWeight: 600 }}>SOC</span>
            <span style={{ color: "#F0F4F8", fontSize: "clamp(24px,2.2vw,34px)", fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" as const }}>
              {soc == null ? "—" : Math.round(socPct)}
              {soc != null && <span style={{ fontSize: "0.45em", fontWeight: 500, color: "#7090B0", marginLeft: 2 }}>%</span>}
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "#0D1E32", marginTop: "clamp(5px,0.7vh,10px)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${socPct}%`, borderRadius: 4,
              background: "linear-gradient(90deg, #00E676, #4AA8FF)", transition: "width 0.6s" }}/>
          </div>
        </div>

        <div style={{ marginTop: "clamp(4px,0.6vh,10px)" }}>
          <PanelRow label="STATUS" value={statusText} color={statusColor} big={false}/>
          <PanelRow label="BATTERY POWER" value={battKw == null ? "—" : Math.abs(battKw).toFixed(1)} unit={battKw == null ? undefined : "kW"}/>
          <PanelRow label="MAX CELL TEMP" value={maxCellTempC == null ? "—" : maxCellTempC.toFixed(1)} unit={maxCellTempC == null ? undefined : "°C"}/>
          <PanelRow label="GRID FREQUENCY" value={gridHz == null ? "—" : gridHz.toFixed(2)} unit={gridHz == null ? undefined : "Hz"}/>
          <PanelRow label="STATE OF HEALTH" value={soh == null ? "—" : soh.toFixed(1)} unit={soh == null ? undefined : "%"} color="#00E676"/>
          <PanelRow label="CHARGED TODAY" value={chargedKwh == null ? "—" : chargedKwh.toFixed(1)} unit={chargedKwh == null ? undefined : "kWh"}/>
          <PanelRow label="DISCHARGED TODAY" value={dischargedKwh == null ? "—" : dischargedKwh.toFixed(1)} unit={dischargedKwh == null ? undefined : "kWh"}/>
        </div>
      </div>
    </div>
  );
}

// ── Info panel primitives ─────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ color: "#00DCFF", fontSize: "clamp(9px, 0.75vw, 12px)", fontWeight: 700, marginBottom: "clamp(3px, 0.4vh, 7px)"}}>
      {title}
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "clamp(2px, 0.35vh, 5px) 0", borderBottom: "1px solid #182030", gap: 8 }}>
      <span style={{ color: "#5A6880", fontSize: "clamp(10px, 0.78vw, 13px)", whiteSpace: "nowrap" as const }}>{label}</span>
      <span style={{ color: valueColor ?? "#F0F4F8", fontSize: "clamp(10px, 0.82vw, 13px)", fontWeight: 500, textAlign: "right" as const }}>{value}</span>
    </div>
  );
}

function StatusVal({ value, good }: { value: string; good: boolean }) {
  return <span style={{ color: good ? "#00E676" : "#FF3B30", fontWeight: 700, fontSize: "clamp(10px, 0.82vw, 13px)" }}>{value}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScadaView({ station, onExit }: { station: Station; onExit?: () => void }) {
  const { data: summary } = useStationSummary(station.id);
  const { data: intradayRaw = [] } = useIntradayData(station.id);
  const live = useBessLive(station.id);

  // Show the full day from 00:00 to now — the backend gap-fills empty slots.
  const intraday = intradayRaw;

  const isOnline       = station.status === "online";
  const runDays        = safeRunDays(station.operationTime);
  const capacityMwh    = ((station.installedCapacity || 0) / 1000).toFixed(2);
  const hasAlarm       = (summary?.todayAlarms ?? 0) > 0;
  // null = lifetime energy not published by this device → show "—", not 0.
  const totalCycles: number | null =
    live.totalChargedKwh != null && live.totalChargedKwh > 0 && station.installedCapacity > 0
      ? Math.round(live.totalChargedKwh / station.installedCapacity) : null;
  // Cycle life depends on the installed cell rating, which UGX does not
  // publish. Without it, remaining life is unknown rather than a guess against
  // an assumed 4000-cycle datasheet figure.
  const remainingCycles: number | null = null;

  const tickInterval = Math.max(0, Math.ceil(intraday.length / 5) - 1);
  const socData = intraday.map(d => ({ t: d.t, soc: d.soc }));
  const pwrData = intraday.map(d => ({ t: d.t, power: d.power }));
  // Reactive power is not published on this feed. It used to be drawn as
  // active × 0.12, which looked like a measurement. null leaves a gap in the
  // chart rather than a flat zero line that reads as a real zero reading.
  const arData  = intraday.map(d => ({ t: d.t, active: d.power, reactive: null as number | null }));

  // ── Chart line-style selector ─────────────────────────────────────────────
  type LineStyle = "monotone" | "linear" | "stepAfter" | "natural";
  const LINE_STYLES: { key: LineStyle; label: string }[] = [
    { key: "monotone",  label: "Smooth"  },
    { key: "linear",    label: "Spikes"  },
    { key: "stepAfter", label: "Plateau" },
    { key: "natural",   label: "Wavy"    },
  ];
  const [lineStyle, setLineStyle] = useState<LineStyle>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("ems_line_style") as LineStyle) ?? "monotone";
    }
    return "monotone";
  });
  useEffect(() => {
    localStorage.setItem("ems_line_style", lineStyle);
  }, [lineStyle]);

  return (
    <div style={{ background: "#050A12", color: "#F0F4F8", fontFamily: "var(--font-chivo,Inter,system-ui,sans-serif)", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* TOP STRIP */}
      <div style={{ background: "#0B1422", borderBottom: "1px solid #182030", display: "flex", alignItems: "center", padding: "0 clamp(12px,1.2vw,24px)", gap: 0, flexShrink: 0, minHeight: 40, height: "clamp(40px,4vh,56px)" }}>

        {/* Site name + live badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(6px,0.6vw,12px)", flexShrink: 0 }}>
          <span style={{ color: "#5A6880", fontSize: "clamp(8px,0.65vw,10px)"}}>Site</span>
          <span style={{ color: "#F0F4F8", fontSize: "clamp(11px,0.9vw,15px)", fontWeight: 700 }}>
            {station.powerStationEnglishName || station.id.toUpperCase()}
          </span>
          {live.isLive
            ? <span style={{ fontSize: "clamp(8px,0.62vw,10px)", color: "#00E676", fontWeight: 700, letterSpacing: "1px", background: "rgba(0,230,118,.08)", border: "1px solid rgba(0,230,118,.25)", borderRadius: 4, padding: "1px 6px" }}>● LIVE</span>
            : <span style={{ fontSize: "clamp(8px,0.62vw,10px)", color: "#5A6880", fontWeight: 600, letterSpacing: "1px", background: "rgba(90,104,128,.08)", border: "1px solid #182030", borderRadius: 4, padding: "1px 6px" }}>OFFLINE</span>
          }
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: "#182030", margin: "0 clamp(10px,1vw,20px)", flexShrink: 0 }}/>

        {/* Stats row */}
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px,1.6vw,28px)", flex: 1, overflow: "hidden" }}>
          {[
            ["Location",  station.stationLocation || "—",                    "#F0F4F8"],
            ["Cabinets",  String(station.energyStorageCabinetNum ?? 0),       "#F0F4F8"],
            ["Installed", fmtInstall(station.operationTime),                  "#F0F4F8"],
            ["Capacity",  capacityMwh + " MWh",                               "#00DCFF"],
            ["Run Days",  String(runDays) + " d",                             "#F0F4F8"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flexShrink: 0 }}>
              <span style={{ color: "#5A6880", fontSize: "clamp(7.5px,0.6vw,9.5px)", lineHeight: 1 }}>{label}</span>
              <span style={{ color, fontSize: "clamp(10px,0.82vw,13px)", fontWeight: 600, lineHeight: 1.4 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: "#182030", margin: "0 clamp(10px,1vw,20px)", flexShrink: 0 }}/>

        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
          <span style={{ color: "#5A6880", fontSize: "clamp(7.5px,0.6vw,9.5px)", lineHeight: 1 }}>System by</span>
          <span style={{ color: "#F0F4F8", fontSize: "clamp(11px,0.9vw,15px)", fontWeight: 700, lineHeight: 1.4 }}>UnityESS</span>
        </div>
      </div>

      {/* MIDDLE ROW: [System Info+Status] | [Energy Flow] | [Health+Alarms] */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "clamp(180px, 20%, 300px) 1fr clamp(180px, 20%, 300px)",
        borderTop: "1px solid #182030",
        borderBottom: "1px solid #182030",
        // Tall enough for the single-line diagram plus the BATTERY · LIVE
        // panel's 7 rows without clipping (~230px at minimum content), but
        // capped well short of 46vh — at that height the diagram/panel ate
        // most of the row and the time-series charts below were squeezed
        // down to a sliver.
        flex: "0 0 clamp(280px, 34vh, 380px)",
        minHeight: 0,
      }}>

        {/* LEFT: System Information + System Status stacked */}
        <div style={{ borderRight: "1px solid #182030", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ borderBottom: "1px solid #182030", padding: "clamp(6px,0.7vh,12px) clamp(8px,0.9vw,16px)" }}>
            <SectionHeader title="System Information"/>
            <Row label="Total Capacity"    value={capacityMwh + " MWh"}/>
            <Row label="DC Bus Voltage"    value={fmtOrDash(live.voltDC, 0, " V")} valueColor="#00DCFF"/>
            <Row label="Stack Current"     value={fmtOrDash(live.currA, 1, " A")}/>
            <Row label="Bank Power"        value={fmtOrDash(live.battKw, 2, " kW")}/>
          </div>
          <div style={{ padding: "8px 12px", flex: 1 }}>
            <SectionHeader title="System Status"/>
            <Row label="Current Status"
              value={<StatusVal value={isOnline ? "On" : "Offline"} good={isOnline}/>}/>
            <Row label="Charging / Discharging"
              value={
                <span style={{ color: live.battKw == null || live.battKw === 0 ? "#5A6880" : live.battKw < 0 ? "#FFB300" : "#00E676", fontWeight: 700, fontSize: 11.5 }}>
                  {live.battKw == null ? "—" : live.battKw === 0 ? "Idle" : live.battKw < 0 ? "Charging" : "Discharging"}
                </span>
              }/>
            <Row label="Ambient Temp" value={fmtOrDash(live.tempC, 1, " °C")}/>
            <Row label="SOC"          value={fmtOrDash(live.soc, 1, "%")} valueColor="#00E676"/>
          </div>
        </div>

        {/* CENTER: Energy Flow diagram */}
        {/* minWidth 0 — grid items default to min-width:auto, and the SVG's
            aspect-ratio-derived width would inflate this cell's min-content,
            blowing out the 1fr track and pushing the right column off-screen. */}
        <div style={{ padding: "6px 10px", minWidth: 0, overflow: "hidden" }}>
          <EnergyFlow
            gridKw={live.gridKw} loadKw={live.loadKw} battKw={live.battKw} solarKw={live.solarKw}
            soc={live.soc} soh={live.soh} maxCellTempC={live.maxCellTempC} gridHz={live.gridHz}
            chargedKwh={live.chargedKwh} dischargedKwh={live.dischargedKwh}
          />
        </div>

        {/* RIGHT: Health Data + Status & Alarms stacked */}
        <div style={{ borderLeft: "1px solid #182030", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ borderBottom: "1px solid #182030", padding: "clamp(6px,0.7vh,12px) clamp(8px,0.9vw,16px)" }}>
            <SectionHeader title="Health Data"/>
            <Row label="SOH"                value={fmtOrDash(live.soh, 1, "%")} valueColor="#00E676"/>
            <Row label="Cycles (total)"     value={totalCycles == null ? "—" : totalCycles.toLocaleString("en-IN")}/>
            <Row label="Safe Run Days"      value={runDays + " days"}/>
            <Row label="Lifetime Discharge" value={live.totalDischargedKwh == null ? "—" : live.totalDischargedKwh.toLocaleString("en-IN") + " kWh"}/>
          </div>
          <div style={{ padding: "8px 12px", flex: 1 }}>
            <SectionHeader title="Status and Alarms"/>
            <Row label="Alarms Today"           value={summary?.todayAlarms != null ? String(summary.todayAlarms) : "—"}
              valueColor={hasAlarm ? "#FF3B30" : "#00E676"}/>
            <Row label="Over-Temp Warning"      value={
              live.tempC == null
                ? <span style={{ color: "#5A6880", fontWeight: 700, fontSize: "clamp(10px, 0.82vw, 13px)" }}>—</span>
                : <StatusVal value={live.tempC > 45 ? "Yes" : "No"} good={live.tempC <= 45}/>
            }/>
            <Row label="Comms Status"           value={<StatusVal value={isOnline ? "Normal" : "Fault"} good={isOnline}/>}/>
          </div>
        </div>
      </div>

      {/* TIME SERIES CHARTS */}
      <div style={{ flex: "1 1 clamp(140px, 26vh, 260px)", minHeight: 140, overflow: "hidden", display: "flex", flexDirection: "column", padding: "clamp(6px,0.7vh,12px) clamp(8px,0.9vw,16px) clamp(8px,0.8vh,14px)" }}>
        <div style={{ color: "#5A6880", fontSize: "clamp(8px,0.65vw,11px)", fontWeight: 600, textAlign: "center", marginBottom: "clamp(4px,0.5vh,8px)"}}>
          Time Series Data of the Site
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "clamp(6px,0.8vw,14px)", flex: 1, minHeight: 0 }}>

          {/* SoC */}
          <div style={{ background: "#0A1020", borderRadius: 8, border: "1px solid #182030", padding: "clamp(6px,0.7vh,10px) clamp(4px,0.5vw,8px) clamp(3px,0.4vh,6px)", display: "flex", flexDirection: "column" }}>
            {/* Title + line-style pills */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "clamp(2px,0.3vh,5px)", gap: 6 }}>
              <div style={{ color: "#00DCFF", fontSize: "clamp(9px,0.72vw,12px)", fontWeight: 600, flex: 1, textAlign: "center" }}>SoC with Time</div>
              <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {LINE_STYLES.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setLineStyle(key)}
                    style={{
                      fontSize: 8.5, fontWeight: 600, letterSpacing: "0.4px",
                      padding: "2px 6px", borderRadius: 4, cursor: "pointer",
                      border: lineStyle === key ? "1px solid #00DCFF" : "1px solid #182030",
                      background: lineStyle === key ? "rgba(0,220,255,0.12)" : "transparent",
                      color: lineStyle === key ? "#00DCFF" : "#5A6880",
                      transition: "all 0.15s",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={socData} margin={{ top: 12, right: 6, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#111C2A" vertical={false}/>
                  <XAxis dataKey="t" {...axisProps} interval={tickInterval}/>
                  <YAxis {...axisProps} domain={[0,100]} tickFormatter={v => v+"%"} width={34}/>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toFixed(1)+"%","SoC"]}/>
                  <Line type={lineStyle} dataKey="soc" stroke="#00E676" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#00E676", strokeWidth: 0 }}/>
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Power */}
          <div style={{ background: "#0A1020", borderRadius: 8, border: "1px solid #182030", padding: "clamp(6px,0.7vh,10px) clamp(4px,0.5vw,8px) clamp(3px,0.4vh,6px)", display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#00DCFF", fontSize: "clamp(9px,0.72vw,12px)", fontWeight: 600, textAlign: "center", marginBottom: "clamp(2px,0.3vh,5px)" }}>Power with Time</div>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pwrData} margin={{ top: 2, right: 6, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#111C2A" vertical={false}/>
                  <XAxis dataKey="t" {...axisProps} interval={tickInterval}/>
                  <YAxis {...axisProps} width={42} domain={[(dataMin: number) => Math.min(dataMin * 1.1 - 1, -5), (dataMax: number) => Math.max(dataMax * 1.1 + 1, 5)]}/>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toFixed(1)+" kW","Power"]}/>
                  <ReferenceLine y={0} stroke="#5A6880" strokeDasharray="3 3"/>
                  <Bar dataKey="power" fill="#FFB300" radius={[2,2,0,0]} maxBarSize={6}/>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Active / Reactive */}
          <div style={{ background: "#0A1020", borderRadius: 8, border: "1px solid #182030", padding: "clamp(6px,0.7vh,10px) clamp(4px,0.5vw,8px) clamp(3px,0.4vh,6px)", display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#00DCFF", fontSize: 11, fontWeight: 600, textAlign: "center", marginBottom: 3 }}>Active and Reactive Power</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 3 }}>
              {[["#FFB300","Active"],["#5B8DEF","Reactive"]].map(([c,l]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, color: "#F0F4F8" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }}/>
                  {l}
                </span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={arData} margin={{ top: 2, right: 6, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#111C2A" vertical={false}/>
                  <XAxis dataKey="t" {...axisProps} interval={tickInterval}/>
                  <YAxis {...axisProps} width={42} domain={[(dataMin: number) => Math.min(dataMin * 1.1 - 1, -5), (dataMax: number) => Math.max(dataMax * 1.1 + 1, 5)]}/>
                  <Tooltip contentStyle={tooltipStyle}/>
                  <ReferenceLine y={0} stroke="#5A6880" strokeDasharray="3 3"/>
                  <Line type={lineStyle} dataKey="active"   name="Active (kW)"    stroke="#FFB300" strokeWidth={1.5} dot={false}/>
                  <Line type={lineStyle} dataKey="reactive" name="Reactive (kVAR)" stroke="#5B8DEF" strokeWidth={1.5} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
