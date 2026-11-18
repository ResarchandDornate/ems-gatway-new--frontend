"use client";

/**
 * Which screen a URL under /k resolves to.
 *
 * Next needs a file under app/ per route, so the alternative was five
 * near-identical page files sitting outside this folder. One catch-all route
 * plus this map keeps the routing table here, with the screens it names.
 */

import {
  DashboardScreen, SignalsScreen, HistoryScreen, AlarmsScreen, SettingsScreen,
  ControlScreen, SiteScreen, AdvisorScreen, EnergyScreen, SupportScreen,
} from "./screens";
import { DASH_SECTIONS } from "./screens/DashboardScreen";

const SCREENS = {
  "":         DashboardScreen,
  /* Energy is the calendar view — a named day, week or month — and History is
     the rolling one. They are separate screens rather than two modes of one
     because a period control cannot serve both: a rolling "24h" and a calendar
     "3 September" are different windows, and a screen offering both ends up
     putting one's heading over the other's chart. */
  energy:     EnergyScreen,
  /* Not in the dock. It is reached from System, which is where somebody
     already goes when they want something about the app rather than about the
     plant — and the dock has no room, as the note in FloatingNavigation
     records. */
  support:    SupportScreen,
  /* Every unit at once. Not in the dock — that is full at six slots on a 375pt
     phone — and reached instead from the unit picker, which is where someone
     already goes when the question is about more than one BESS. */
  site:       SiteScreen,
  signals:    SignalsScreen,
  history:    HistoryScreen,
  alarms:     AlarmsScreen,
  advisor:    AdvisorScreen,
  settings:   SettingsScreen,
  /* Routable for anyone who types the path; whether the dock offers it is
     FloatingNavigation's decision. The screen itself re-checks the role, the
     proxy refuses the write without GW_ALLOW_WRITES, and the gateway enforces
     internal_admin on every request — so reaching this route is not the same
     as being able to use it. */
  control:    ControlScreen,

  /* The dashboard's own detail sections — /k/battery, /k/inverter and the
     rest. They resolve back to the screen that owns them, so the reader stays
     on the overview's URL family rather than being sent to a fifth-level path
     nobody would recognise.

     Spread from DashboardScreen's exported list rather than retyped, because
     three files have to agree on these keys and a mismatch here fails the way
     every routing mismatch does — silently, as a fallback to the dashboard
     that looks almost right. */
  ...Object.fromEntries(DASH_SECTIONS.map((k) => [k, DashboardScreen])),
} as const;

export type ScreenKey = keyof typeof SCREENS;

export function ScreenRouter({ slug }: { slug?: string[] }) {
  const key = (slug?.[0] ?? "") as ScreenKey;
  /* An unknown path falls back to the dashboard rather than rendering nothing.
     The dock cannot produce one; a typed URL can. */
  const Screen = SCREENS[key] ?? DashboardScreen;
  return <Screen />;
}
