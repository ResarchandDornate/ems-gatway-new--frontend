"use client";

/**
 * Header — site and BESS pill, provenance banner, theme.
 *
 * One addition over the UGX build: the provenance banner. When the proxy is
 * serving the bundled reference capture rather than a live gateway, the app
 * says so at the top of every screen. A dashboard that looks live and is not
 * is the single worst thing this build could do, so the statement is
 * unremovable and sits above the fold.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Moon, Sun, Cpu, Layers } from "lucide-react";
import { useLive } from "../data";
import { useGatewaySelection } from "../gateway/GatewayContext";
import { useSiteSelection } from "../gateway/SiteContext";
import { BottomSheet } from "./Overlays";
import { IconButton } from "./Controls";
import { ListItem } from "./ListItem";
import { StatusIndicator } from "./Status";
import { useTheme } from "../useTheme";

/**
 * What the EMS behind a unit is called.
 *
 * Exported because the Site screen labels the same units in its column heads,
 * and two spellings of "Chinese EMS 2" in one app is one more than there
 * should be.
 */
export const SOURCE_NAMES: Record<string, string> = {
  external_ems_1: "Chinese EMS 1",
  external_ems_2: "Chinese EMS 2",
};

const NAMES = SOURCE_NAMES;

/**
 * The selected unit's display name.
 *
 * From the list where the list has it. The fallback matters more than it
 * looks: with the gateway unreachable the list is empty, and returning the
 * source id put "external_ems_1" in the title bar where "BESS 1" belongs. The
 * source-to-BESS naming is the gateway's own and the alarm decoder already
 * relies on it; using it for a label is safe in a way that using it to filter
 * rows is not.
 */
function bessLabel(available: { sourceId: string; bessId: string }[], sourceId: string): string {
  const hit = available.find((a) => a.sourceId === sourceId);
  const id = hit?.bessId ?? sourceId.replace(/^external_ems_/, "bess_");
  return id.replace("bess_", "BESS ");
}

export function Header() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { sourceId, available, select } = useGatewaySelection();
  const { siteId, siteName, sites, multi, select: selectSite } = useSiteSelection();
  const live = useLive();

  return (
    <>
      {live.mode === "capture" && (
        <div className="m-demo-tag" role="status">
          <span className="m-demo-dot" />
          Reference capture · 2026-08-10 · not live telemetry
        </div>
      )}

      <header className="m-header">
        <button
          className="m-station-pill"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={
            multi
              ? `${siteName}, ${bessLabel(available, sourceId)}. Change site or unit.`
              : `BESS: ${bessLabel(available, sourceId)}. Change unit.`
          }
        >
          <span className="m-sp-mark"><Cpu size={16} strokeWidth={2.2} /></span>
          <span className="m-sp-text">
            <span className="m-sp-name">{bessLabel(available, sourceId)}</span>
            {/* With one site the name is a constant and says nothing, so the
                subtitle stays the EMS the unit sits behind — which is what it
                has always said. With several, which plant you are looking at
                is the more important of the two facts and leads. */}
            <span className="m-sp-loc">
              {multi ? `${siteName} · ${NAMES[sourceId] ?? sourceId}` : NAMES[sourceId] ?? sourceId}
            </span>
          </span>
          <ChevronDown size={15} style={{ marginLeft: "auto", flex: "none", opacity: .55 }} />
        </button>

        <IconButton label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} onClick={toggle}>
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </IconButton>
      </header>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={multi ? "Site and units" : "Battery units"}
      >
        {/* Only when there is a choice to make. A picker listing one site is a
            control that cannot do anything, and it would sit above the units on
            every screen of every single-site deployment — which is all of them
            today. */}
        {multi && (
          <>
            <div className="m-label m-ink3" style={{ padding: "2px 6px 8px" }}>Site</div>
            {sites.map((st) => (
              <ListItem
                key={st.id}
                title={st.name}
                subtitle={st.live ? undefined : "Reference capture — not live telemetry"}
                onClick={() => { selectSite(st.id); setOpen(false); }}
                className={st.id === siteId ? "is-current" : undefined}
              />
            ))}
            {/* Said once, here, rather than discovered at the login form.
                Each gateway issues its own accounts and validates its own
                tokens, so moving to a site this device has not signed into
                asks for credentials — that is the boundary being real, not the
                app forgetting who you are. */}
            <div className="m-label m-ink3" style={{ padding: "10px 6px 2px", lineHeight: 1.55 }}>
              Each site is a separate gateway with its own accounts. Switching to one you
              have not signed into on this device will ask you to sign in; the site you
              leave stays signed in.
            </div>
            <div className="m-label m-ink3" style={{ padding: "16px 6px 8px" }}>Battery units</div>
          </>
        )}

        {/* Above the units, because it is the answer to the question that
            brought someone here on a two-unit site: not "which one" but "what
            are both of them doing". Only offered when there is more than one —
            with a single unit the site view and the unit view are the same
            screen, and the second one would be a promise the plant cannot
            keep. */}
        {available.length > 1 && (
          <>
            <ListItem
              leading={<span className="m-metric-icon"><Layers size={15} /></span>}
              title="Site — both units"
              subtitle={`Compare all ${available.length} units, live and over time`}
              onClick={() => { setOpen(false); router.push("/k/site"); }}
            />
            <div className="m-label m-ink3" style={{ padding: "12px 6px 8px" }}>
              Or open one unit
            </div>
          </>
        )}

        {available.length === 0 && (
          <div className="m-empty">
            <span className="m-body m-ink3">The gateway has not reported a unit yet.</span>
          </div>
        )}

        {/* Every unit the gateway knows, selectable whether or not it is being
            logged this second. A unit that has stopped reporting is the one
            someone most needs to open: the historian holds ninety days, and
            "offline now" says nothing about whether there is history to read.
            The status says which state it is in; it does not gate the tap. */}
        {available.map((a) => (
          <ListItem
            key={a.sourceId}
            title={a.bessId.replace("bess_", "BESS ")}
            subtitle={NAMES[a.sourceId] ?? a.sourceId}
            trailing={
              <StatusIndicator
                tone={a.reporting ? "good" : "warn"}
                label={a.reporting ? "Reporting" : "History only"}
                live={a.reporting}
              />
            }
            onClick={() => { select(a.sourceId); setOpen(false); }}
            className={a.sourceId === sourceId ? "is-current" : undefined}
          />
        ))}

        {available.some((a) => !a.reporting) && (
          <div className="m-label m-ink3" style={{ padding: "12px 6px 2px", lineHeight: 1.55 }}>
            A unit marked <b>History only</b> is not in the one-second logger right now, so it
            has no live readings — those show as dashes. Its recorded history is unaffected and
            opens normally; the gateway keeps ninety days.
          </div>
        )}
      </BottomSheet>
    </>
  );
}
