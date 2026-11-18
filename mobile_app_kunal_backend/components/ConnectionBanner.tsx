"use client";

/**
 * Says when what is on screen cannot be trusted as current, on whichever
 * screen the user happens to be on.
 *
 * Two separate facts, and the remedies differ, so they are two separate
 * sentences and never merged into one:
 *
 *   Unreachable — this phone cannot get to the proxy. A fact about the
 *                 connection. The readings on screen are the last ones that
 *                 got through, and History is still answerable from cache.
 *   Offline     — the app is being answered, but the newest reading it has is
 *                 old enough that nothing may be read in the present tense.
 *                 A fact about the plant, or about the logger behind it.
 *
 * Both used to be inferred from one failed request, which is why an
 * unreachable gateway and an offline BESS produced the same sentence.
 *
 * Mounted in the shell rather than on the dashboard, because Signals, History,
 * Alarms, System and Control go equally stale and would otherwise each stay
 * silent about it — Home carried the only statement in the app that the device
 * was not reporting, so every other screen presented hour-old figures with
 * nothing on them to say so.
 *
 * Deliberately not an error state. Being unreachable is a normal condition for
 * a field board on a tunnel — it is information, not a failure of the app, and
 * styling it as an alarm would put it in competition with the real ones. The
 * device being offline is the graver of the two and is coloured accordingly.
 */

import { CloudOff, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";

import { useConnectivity, agoLabel } from "../data";

/* Matches FloatingNavigation's own constant. Both builds route under /k — the
   Vite shim reports the same prefix precisely so this file compiles untouched
   in the packaged app. */
const BASE = "/k";

export function ConnectionBanner() {
  const c = useConnectivity();
  const pathname = usePathname();

  /* Reachability first: it is the more fundamental of the two. An app that
     cannot reach the proxy has no basis for any claim about the device, so
     saying "Offline" here would be reporting an inference as an observation.

     Only spoken once a request has actually failed. A pending first load is
     not an outage, and saying so during startup would cry wolf on every cold
     open. */
  /* Unreachable, AND the reading on screen has actually aged out.
   *
   * Both halves are load-bearing. `unreachable` goes true on the first failed
   * request, while the freshness rule holds a reading current for sixty
   * seconds — so for up to a minute this banner said "Can't reach the site,
   * nothing is newer than 52 sec ago" directly above a green card reading
   * "Online · Updated 52 sec ago". Two components, the same `ageMs`, opposite
   * conclusions, because each applied its own rule to it.
   *
   * There is no contradiction to arbitrate: a failed poll while the last one
   * is still current is a normal event on a field board behind a tunnel, and
   * not something to interrupt anybody about. The next poll is five seconds
   * away. What matters is a failure that has lasted long enough for the
   * numbers to go stale — and `status` is precisely that judgement, made once,
   * by the rule the card is already using.
   *
   * So the banner now speaks only when the card has stopped calling the
   * reading current, and the two can no longer disagree by construction. */
  if (c.unreachable && c.status !== "live") {
    return (
      <div className="m-offline" role="status">
        <CloudOff size={15} />
        <span>
          {c.atMs != null ? (
            <>
              Can&rsquo;t reach the site. Nothing on screen is newer than{" "}
              <b>{agoLabel(c.ageMs!)}</b>. History is still available.
            </>
          ) : (
            <>Can&rsquo;t reach the site. No readings have arrived yet.</>
          )}
        </span>
      </div>
    );
  }

  /* `offline` only — not `stale`, and not `none`.
  
     A delayed reading is already labelled as one everywhere it appears, by the
     "Last known " qualifier every metric runs through, so a banner for it
     would repeat what the screen has said. `none` is a cold start as often as
     it is a fault, and a red bar over an app that has simply not finished
     loading is the same cry-wolf the check above avoids. */
  if (c.status !== "offline") return null;

  /* Home says this already, in a card that has room for both halves of it —
     see StationStatus. Two of the same sentence fifty pixels apart reads as a
     bug rather than as emphasis, so the banner stands down where the fuller
     statement is already on screen. */
  if (pathname === BASE) return null;

  return (
    <div className="m-offline is-bad" role="status">
      <WifiOff size={15} />
      <span>
        <b>{c.label}</b> · {c.detail}
      </span>
    </div>
  );
}
