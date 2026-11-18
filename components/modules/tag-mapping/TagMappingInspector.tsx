"use client";

/**
 * Tag Mapping Inspector.
 *
 * Answers two operational questions without reading source:
 *
 *   "Where does this number on screen come from?"
 *      → the Coverage table: every canonical metric and the vendor tag(s) the
 *        active profile reads for it, including scaling and derivations.
 *
 *   "This site publishes a tag we don't show — why?"
 *      → the Discovered tab: every tag the selected station actually publishes,
 *        matched against the profile, with the unmatched ones listed so they
 *        can be mapped.
 *
 * Mapping a new tag is one `fallbacks` entry in the profile
 * (lib/api/metrics/profiles/*.profile.ts) — this screen shows the result.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Tag, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  activeProfile, auditProfile, classifyTags, PROFILES,
} from "@/lib/api/metrics";
import { getPlantKeyMap } from "@/lib/api/services/plantKeyMap.service";
import { LoadingState } from "@/components/shared/LoadingState";

type Tab = "coverage" | "discovered";

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  field:    { label: "direct",    cls: "bg-good/10 text-good" },
  derived:  { label: "derived",   cls: "bg-accent/15 text-accent" },
  array:    { label: "array",     cls: "bg-blue-400/15 text-blue-300" },
  unmapped: { label: "no source", cls: "bg-bad/10 text-bad" },
  missing:  { label: "missing",   cls: "bg-bad/10 text-bad" },
};

function Pill({ kind }: { kind: string }) {
  const s = KIND_STYLE[kind] ?? KIND_STYLE.missing;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function TagMappingInspector({ stationId }: { stationId?: string }) {
  const [tab, setTab]       = useState<Tab>("coverage");
  const [search, setSearch] = useState("");
  const [profileId, setProfileId] = useState(activeProfile().id);

  const profile = PROFILES[profileId] ?? activeProfile();
  const rows = useMemo(() => auditProfile(profile), [profile]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.metric.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const counts = useMemo(() => {
    const c = { field: 0, derived: 0, array: 0, unmapped: 0, missing: 0 };
    for (const r of rows) c[r.kind as keyof typeof c] = (c[r.kind as keyof typeof c] ?? 0) + 1;
    return c;
  }, [rows]);

  // Tags this station actually publishes — only fetched on the Discovered tab.
  const { data: keyMap, isLoading: keysLoading } = useQuery({
    queryKey: ["plantKeyMap", stationId],
    queryFn:  () => getPlantKeyMap(stationId!),
    enabled:  tab === "discovered" && !!stationId,
    staleTime: Infinity,
  });

  const discovered = useMemo(() => {
    if (!keyMap) return null;
    const tags = [...new Set(keyMap.all.map((k) => k.key))];
    return classifyTags(profile, tags);
  }, [keyMap, profile]);

  return (
    <div className="flex flex-col gap-4">

      {/* ── Hero strip ─────────────────────────────────────────── */}
      {/* The three coverage counts were a mono footnote in the header; as hero
          stats they carry the colour coding that makes "no source" legible. */}
      <div className="surface-card ps-hero">
        <div>
          <h1 className="ps-hero-title">
            <Tag size={18} className="inline-block mr-2 -mt-0.5 text-accent" />
            Tag Mapping
          </h1>
          <p className="ps-hero-sub">
            Which canonical metrics resolve to a real tag on this device, under the selected profile.
          </p>
          <label className="flex items-center gap-2 text-[11px] text-muted mt-2.5">
            Profile
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="filter-input w-auto text-[11.5px]"
            >
              {Object.values(PROFILES).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="ps-hero-stats">
          <div>
            <div className="ps-stat-k">Direct</div>
            <div className="ps-stat-v" style={{ color: "var(--green)" }}>{counts.field + counts.array}</div>
          </div>
          <div>
            <div className="ps-stat-k">Derived</div>
            <div className="ps-stat-v" style={{ color: "var(--accent)" }}>{counts.derived}</div>
          </div>
          <div>
            <div className="ps-stat-k">No source</div>
            <div className="ps-stat-v" style={{ color: counts.unmapped + counts.missing > 0 ? "var(--red)" : "var(--ink)" }}>
              {counts.unmapped + counts.missing}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs + search ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-surface2 rounded-lg p-0.5">
          {([["coverage", "Coverage"], ["discovered", "Discovered tags"]] as [Tab, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={[
                  "px-3 py-1 rounded-md text-[11px] font-mono tracking-[1.2px] transition-colors",
                  tab === id ? "bg-accent/15 text-accent" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {label}
              </button>
            )
          )}
        </div>

        <div className="relative max-w-[260px] w-full">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search metric or tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input w-full pl-7 text-[11.5px]"
          />
        </div>
      </div>

      {/* ── Coverage ───────────────────────────────────────────── */}
      {tab === "coverage" && (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-muted font-mono tracking-[1.4px] bg-surface2/30 border-b border-line">
                  <th className="px-5 py-2.5 font-semibold w-[230px]">Metric</th>
                  <th className="px-4 py-2.5 font-semibold w-[190px]">Shown as</th>
                  <th className="px-4 py-2.5 font-semibold w-[60px]">Unit</th>
                  <th className="px-4 py-2.5 font-semibold w-[100px]">Source</th>
                  <th className="px-5 py-2.5 font-semibold">Vendor tag / rule</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.metric} className="border-b border-line/60 hover:bg-surface2/20">
                    <td className="px-5 py-2 font-mono text-[11.5px] text-ink">{r.metric}</td>
                    <td className="px-4 py-2 text-ink2">{r.label}</td>
                    <td className="px-4 py-2 font-mono text-muted">{r.unit || "—"}</td>
                    <td className="px-4 py-2"><Pill kind={r.kind} /></td>
                    <td className="px-5 py-2 font-mono text-[11px] text-muted2">{r.detail}</td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[11px] text-muted">No metrics match “{search}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Discovered ─────────────────────────────────────────── */}
      {tab === "discovered" && (
        <div className="surface-card p-5">
          {!stationId ? (
            <p className="text-[11.5px] text-muted">Select a station to list the tags it publishes.</p>
          ) : keysLoading ? (
            <LoadingState rows={4} />
          ) : !discovered ? (
            <p className="text-[11.5px] text-muted">No telemetry keys found for this station.</p>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-4 text-[11.5px]">
                <span className="flex items-center gap-1.5 text-good">
                  <CheckCircle2 size={13} /> {Object.keys(discovered.mapped).length} mapped
                </span>
                <span className="flex items-center gap-1.5 text-accent">
                  <AlertTriangle size={13} /> {discovered.unmapped.length} unmapped
                </span>
              </div>

              {discovered.unmapped.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono tracking-[1.4px] text-muted mb-2">
                    Published but not mapped
                  </p>
                  <p className="text-[11px] text-muted2 mb-3 leading-relaxed">
                    This station publishes these tags and nothing reads them. To surface one, add it to the
                    matching metric’s <code className="font-mono text-accent">fallbacks</code> in{" "}
                    <code className="font-mono">lib/api/metrics/profiles/{profile.id}.profile.ts</code>.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {discovered.unmapped
                      .filter((t) => !search || t.toLowerCase().includes(search.toLowerCase()))
                      .map((t) => (
                        <span key={t} className="px-2 py-1 rounded-md border border-line bg-surface2 font-mono text-[11px] text-ink2">
                          {t}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-mono tracking-[1.4px] text-muted mb-2">Mapped tags</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[11px] text-muted font-mono tracking-[1.4px] bg-surface2/30 border-b border-line">
                        <th className="px-3 py-2 font-semibold w-[220px]">Tag</th>
                        <th className="px-3 py-2 font-semibold w-[230px]">Metric</th>
                        <th className="px-3 py-2 font-semibold w-[90px]">Matched by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(discovered.mapped)
                        .filter(([tag, m]) =>
                          !search ||
                          tag.toLowerCase().includes(search.toLowerCase()) ||
                          m.metric.toLowerCase().includes(search.toLowerCase()))
                        .map(([tag, m]) => (
                          <tr key={tag} className="border-b border-line/60">
                            <td className="px-3 py-1.5 font-mono text-[11.5px] text-ink">{tag}</td>
                            <td className="px-3 py-1.5 font-mono text-[11.5px] text-ink2">{m.metric}</td>
                            <td className="px-3 py-1.5">
                              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono tracking-[1px] bg-surface2 text-muted">
                                {m.via}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
