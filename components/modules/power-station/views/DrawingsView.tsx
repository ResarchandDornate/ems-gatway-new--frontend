"use client";

/**
 * Electrical drawings for Main Wiring Diagram and Network Topology.
 *
 * Files come from app/api/drawings with the session's bearer, as blobs — an
 * <img src> cannot send the header, and the drawings are not public. Only
 * this site's drawings are listed; the picker shows once there is more than one.
 */

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Minus, Plus, Maximize2 } from "lucide-react";
import { getSession } from "@/lib/central";
import { DRAWINGS, type Drawing, type DrawingKind } from "@/lib/drawings";
import { LoadingState } from "@/components/shared/LoadingState";
import { useAppConfig } from "@/hooks/useAppConfig";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";

/** This site's drawings carry the site's own name, spelled as everywhere else. */
function useSiteName(d: Drawing): string {
  const { gatewayId } = useAppConfig();
  return d.thisSite ? (SITE_OVERLAY_FOR(gatewayId).powerStationEnglishName ?? d.site) : d.site;
}

const ZOOMS = [1, 1.5, 2, 3];

function useDrawingBlob(file: string | undefined) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!file) return;
    let url: string | null = null;
    let live = true;
    setState({ url: null, error: null });
    const s = getSession();
    fetch(`/api/drawings/${encodeURIComponent(file)}`, {
      headers: s ? { authorization: `Bearer ${s.token}` } : {},
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(
            r.status === 401 ? "Sign in again to view drawings."
            : r.status === 403 ? "Site drawings are not part of the demo."
            : `Could not load the drawing (${r.status}).`,
          );
        }
        url = URL.createObjectURL(await r.blob());
        if (live) setState({ url, error: null });
      })
      .catch((e: Error) => live && setState({ url: null, error: e.message }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return state;
}

function IconButton({ onClick, label, children, disabled }: { onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label} disabled={disabled}
      className="w-8 h-8 grid place-items-center rounded-lg border border-line text-ink3 hover:text-ink hover:bg-surface3/70 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Viewer({ d }: { d: Drawing }) {
  const preview = useDrawingBlob(d.preview);
  const original = useDrawingBlob(d.original);
  const [zoom, setZoom] = useState(0);
  const siteName = useSiteName(d);
  useEffect(() => setZoom(0), [d.id]);

  const openOriginal = () => {
    const url = original.url ?? preview.url;
    if (url) window.open(url, "_blank", "noopener");
  };
  const download = () => {
    const url = original.url ?? preview.url;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = d.original ?? d.preview;
    a.click();
  };

  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`pill ${d.thisSite ? "cyan" : "gray"}`}>{d.thisSite ? "This Site" : "Other Project"}</span>
            <span className="text-[11.5px] text-muted">{siteName}</span>
          </div>
          <h3 className="text-[13.5px] font-semibold text-ink mt-1.5">{d.title}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0}><Minus size={14} /></IconButton>
          <span className="text-[11px] text-muted w-10 text-center tabular-nums">{Math.round(ZOOMS[zoom] * 100)}%</span>
          <IconButton label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1}><Plus size={14} /></IconButton>
          <IconButton label="Fit to width" onClick={() => setZoom(0)} disabled={zoom === 0}><Maximize2 size={14} /></IconButton>
          <IconButton label={d.original ? "Open the PDF" : "Open full size"} onClick={openOriginal} disabled={!preview.url}><ExternalLink size={14} /></IconButton>
          <IconButton label="Download" onClick={download} disabled={!preview.url}><Download size={14} /></IconButton>
        </div>
      </div>

      <div className="rounded-lg border border-line overflow-auto bg-white" style={{ maxHeight: "calc(100vh - 300px)", minHeight: 320 }}>
        {preview.error ? (
          <p className="text-[12px] text-ink3 p-6">{preview.error}</p>
        ) : !preview.url ? (
          <div className="p-5"><LoadingState rows={4} /></div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={d.title} style={{ width: `${ZOOMS[zoom] * 100}%`, maxWidth: "none", display: "block" }} />
        )}
      </div>
    </div>
  );
}

export function DrawingsView({ kind }: { kind: DrawingKind }) {
  const list = useMemo(
    () => DRAWINGS.filter((d) => d.kind.includes(kind)).sort((a, b) => Number(b.thisSite) - Number(a.thisSite)),
    [kind],
  );
  const [id, setId] = useState(list[0]?.id);
  const { gatewayId } = useAppConfig();
  const thisSiteName = SITE_OVERLAY_FOR(gatewayId).powerStationEnglishName ?? "";
  const active = list.find((d) => d.id === id) ?? list[0];
  if (!active) return null;

  return (
    <div className="flex flex-col gap-3">
      {list.length > 1 && <div className="flex flex-wrap gap-2" role="tablist" aria-label="Drawings">
        {list.map((d) => (
          <button
            key={d.id} type="button" role="tab" aria-selected={d.id === active.id}
            onClick={() => setId(d.id)}
            className={`text-left rounded-lg border px-3 py-2 transition-colors ${d.id === active.id ? "border-[var(--accent)] bg-[rgb(var(--color-accent)/0.08)]" : "border-line hover:bg-surface3/60"}`}
            style={{ maxWidth: 260 }}
          >
            <div className="text-[12px] font-semibold text-ink">{d.thisSite ? thisSiteName : d.site}</div>
            <div className="text-[11px] text-muted truncate">{d.label} · {d.original ? "PDF" : "Image"}</div>
          </button>
        ))}
      </div>}
      <Viewer d={active} />
    </div>
  );
}
