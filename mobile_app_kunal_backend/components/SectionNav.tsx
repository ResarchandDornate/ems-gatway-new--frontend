"use client";

/**
 * SectionNav — the menu-first pattern.
 *
 * Screens in this app had grown to answer every question at once: the
 * dashboard stacked a summary strip, a banner, a flow row, a hero, five asset
 * tabs, a chart, four tiles and a link before anyone had said what they came
 * for. Everything on it was true and most of it was unwanted at any given
 * moment.
 *
 * So a dense screen now opens on its own contents page. The reader picks a
 * section, that section fills the screen, and a back row returns them. Nothing
 * is removed — every figure that used to be on the page is still reachable in
 * exactly one more tap, which is the trade this pattern makes and the only one
 * it makes.
 *
 * ── Two decisions worth keeping ───────────────────────────────────────────
 *
 * **The section lives in the URL, not in useState.** `/k/energy/trends` rather
 * than a piece of component state. This app is packaged with Capacitor and its
 * Android back button is mapped to the router — so with state, back from a
 * section would leave the app entirely, which on a phone reads as a crash. In
 * the URL, back means back. It also makes a section linkable, and survives the
 * reload that a hot restart performs.
 *
 * **A menu row carries its own headline figure.** A contents page listing five
 * words each is a page the reader has to open five things to use, which is
 * more work than the crowded screen it replaced, not less. Each row may carry
 * one number — the day's throughput, the live PV power — so the menu answers
 * the common question by itself and the section answers the rest.
 */

import type { ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight, ChevronLeft } from "lucide-react";

import { FloatingCard } from "./Surfaces";

export interface SectionItem {
  /** URL segment. `/k/<screen>/<key>`. */
  key: string;
  title: string;
  /** One line on what is inside. Keep it to what the section answers. */
  subtitle: string;
  icon: ReactNode;
  /**
   * A headline figure for the row, so the menu is readable on its own.
   * Optional: a section with no single number omits it rather than inventing
   * one, and the row is still a perfectly good way in.
   */
  value?: ReactNode;
  /**
   * Draw the row but refuse the tap, with `subtitle` explaining why. For a
   * section this deployment genuinely cannot fill — no PV inverter, no
   * counters — where hiding it would leave the reader wondering whether the
   * app has the feature at all.
   */
  disabled?: boolean;
}

/**
 * The contents page for one screen.
 *
 * Rendered as the same card-of-rows the System screen uses rather than as a
 * new kind of button, because the app already has a vocabulary for "a list of
 * places you can go" and a second one would be a second thing to learn.
 */
export function SectionMenu({ items, base }: { items: SectionItem[]; base: string }) {
  const router = useRouter();

  return (
    <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`m-row m-sectionrow${it.disabled ? " is-off" : " m-row-tap"}`}
          disabled={it.disabled}
          onClick={it.disabled ? undefined : () => router.push(`${base}/${it.key}`)}
        >
          <span className="m-row-lead">{it.icon}</span>
          <span className="m-row-body">
            <span className="m-label m-ink m-row-title">{it.title}</span>
            <span className="m-row-sub m-ink3">{it.subtitle}</span>
          </span>
          <span className="m-row-trail m-sectionrow-trail">
            {it.value != null && <span className="m-sectionrow-value">{it.value}</span>}
            {!it.disabled && <ChevronRight size={16} className="m-ink3" />}
          </span>
        </button>
      ))}
    </FloatingCard>
  );
}

/**
 * The row that gets you back out of a section.
 *
 * `router.push` to the screen root rather than `router.back()`. Back would be
 * right when the reader arrived from the menu and wrong the moment they
 * arrived any other way — a deep link, a hot restart, or another screen
 * linking into this section — and in those cases it leaves the app. Pushing
 * the parent always means the same thing.
 */
export function SectionBack({ title, base }: { title: string; base: string }) {
  const router = useRouter();
  return (
    <button type="button" className="m-secback" onClick={() => router.push(base)}>
      <ChevronLeft size={17} />
      <span>{title}</span>
    </button>
  );
}

/**
 * Which section a URL is asking for, given the screen's own base.
 *
 * Returns null on the screen root, which is the menu. An unknown segment also
 * returns null rather than an error: a stale link should land on the contents
 * page, not on a dead end.
 */
export function useSection(base: string, keys: readonly string[]): string | null {
  const pathname = usePathname();
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length).replace(/^\/+/, "").split("/")[0];
  return keys.includes(rest) ? rest : null;
}
