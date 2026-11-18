import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  XCircle,
  GitBranch,
} from "lucide-react";
import {
  SCADA_MAPPING,
  countByStatus,
  totalParameters,
  type CoverageStatus,
  type ScadaSection,
} from "@/lib/api/scada-mapping";

export const metadata = {
  title: "SCADA Parameter Coverage · UnityESS EMS",
};

/* The coverage data this page renders describes UGX, which is no longer the
   backend. See the header of lib/api/scada-mapping.ts. The banner below says so
   on screen rather than only in the source, because the page's whole purpose is
   to be quoted at somebody. */

const STATUS_META: Record<
  CoverageStatus,
  {
    label: string;
    color: string;
    ring: string;
    bg: string;
    icon: typeof CheckCircle2;
  }
> = {
  direct: {
    label: "Direct",
    color: "text-good",
    ring: "ring-good/30",
    bg: "bg-good/10",
    icon: CheckCircle2,
  },
  derivable: {
    label: "Derivable",
    color: "text-brand-300",
    ring: "ring-brand-400/30",
    bg: "bg-brand-400/10",
    icon: AlertCircle,
  },
  family: {
    label: "Family",
    color: "text-warn",
    ring: "ring-warn/30",
    bg: "bg-warn/10",
    icon: GitBranch,
  },
  unconfirmed: {
    label: "Unconfirmed",
    color: "text-ink3",
    ring: "ring-line2",
    bg: "bg-white/[.03]",
    icon: HelpCircle,
  },
  missing: {
    label: "Missing",
    color: "text-bad",
    ring: "ring-bad/30",
    bg: "bg-bad/10",
    icon: XCircle,
  },
};

export default function ScadaCoveragePage() {
  const counts = countByStatus();
  const total = totalParameters();

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface3/80 backdrop-blur-xl border-b border-line">
        <div className="h-14 px-5 flex items-center gap-4 max-w-[1600px] mx-auto">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-[12px] text-ink3 hover:text-ink transition-colors"
          >
            <ArrowLeft size={14} />
            Dashboard
          </Link>
          <div className="w-px h-5 bg-line" />
          <div>
            <div className="text-[13px] font-bold text-ink leading-tight">
              SCADA Parameter Coverage
            </div>
            <div className="text-[10px] text-muted font-mono uppercase tracking-[1.4px]">
              NTPC EMS Spec ↔ UGX Telemetry
            </div>
          </div>
        </div>
      </header>

      <main className="px-5 py-6 max-w-[1600px] mx-auto">
        <section className="rounded-lg ring-1 ring-warn/30 bg-warn/10 px-4 py-3 mb-6">
          <div className="text-[12px] text-ink leading-relaxed">
            <span className="font-semibold">This page describes UGX.</span>{" "}
            The app now reads the NorthBound EMS Gateway, and none of the
            coverage below has been re-checked against it. The NTPC requirement
            column is still correct; the right-hand column is a record of a
            platform this app no longer talks to.
          </div>
        </section>

        {/* Summary card */}
        <section className="surface-card p-5 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-ink">
              Coverage Summary
            </h2>
            <div className="text-[11px] text-muted font-mono uppercase tracking-[1.4px]">
              {total} parameters across {SCADA_MAPPING.length} sections
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(counts) as CoverageStatus[]).map((s) => {
              const meta = STATUS_META[s];
              const count = counts[s];
              const pct = total === 0 ? "0" : ((count / total) * 100).toFixed(0);
              const Icon = meta.icon;
              return (
                <div
                  key={s}
                  className={`rounded-lg ring-1 ${meta.ring} ${meta.bg} px-3 py-3`}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon size={13} className={meta.color} />
                    <span
                      className={`text-[10.5px] font-mono uppercase tracking-[1.4px] font-semibold ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[24px] font-semibold text-ink leading-none">
                      {count}
                    </span>
                    <span className="text-[11px] text-muted font-mono">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Legend */}
        <section className="mb-6 px-1">
          <div className="text-[10px] text-muted font-mono uppercase tracking-[1.4px] mb-2">
            Legend
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 text-[11.5px] text-ink3">
            <LegendItem status="direct">
              UGX key documented and maps 1:1 (SI conversion at most).
            </LegendItem>
            <LegendItem status="derivable">
              Computable from documented keys; caveats noted.
            </LegendItem>
            <LegendItem status="family">
              Likely covered by *_xfmr_9 or IO_* family — contents not
              enumerated.
            </LegendItem>
            <LegendItem status="unconfirmed">
              Likely on real device profile but absent from PDF sample.
            </LegendItem>
            <LegendItem status="missing">
              No UGX source; needs new key, new device, or out-of-band data.
            </LegendItem>
          </div>
        </section>

        {/* Sections */}
        <div className="space-y-5">
          {SCADA_MAPPING.map((section, idx) => (
            <SectionCard key={section.id} section={section} index={idx + 1} />
          ))}
        </div>

        {/* Footer */}
        <footer className="mt-8 px-1 py-4 border-t border-line text-[10.5px] text-muted font-mono uppercase tracking-[1.4px] flex flex-wrap gap-2 justify-between">
          <span>
            Source · NTPC Subsection-A 04 EMS · UGX API Reference v1.0
          </span>
          <span>UnityESS · scada-parameter-mapping branch</span>
        </footer>
      </main>
    </div>
  );
}

function LegendItem({
  status,
  children,
}: {
  status: CoverageStatus;
  children: React.ReactNode;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-2">
      <Icon size={12} className={`${meta.color} mt-0.5 shrink-0`} />
      <div>
        <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
        <span className="text-muted"> · {children}</span>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  index,
}: {
  section: ScadaSection;
  index: number;
}) {
  const sectionCounts = section.parameters.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<CoverageStatus, number>
  );

  return (
    <section className="surface-card overflow-hidden">
      {/* Section header */}
      <header className="px-5 py-4 border-b border-line bg-surface2/40">
        <div className="flex items-baseline justify-between gap-4 mb-1 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="text-[10.5px] text-brand-300 font-mono font-semibold tracking-[1.4px]">
              {String(index).padStart(2, "0")}
            </span>
            <h3 className="text-[14px] font-semibold text-ink">
              {section.title}
            </h3>
          </div>
          <div className="text-[10.5px] text-muted font-mono uppercase tracking-[1.4px] shrink-0">
            {section.ntpcReference}
          </div>
        </div>
        <p className="text-[12px] text-ink3 leading-relaxed">{section.scope}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(Object.keys(sectionCounts) as CoverageStatus[]).map((s) => {
            const meta = STATUS_META[s];
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-[1.2px] ${meta.bg} ${meta.color}`}
              >
                {sectionCounts[s]} {meta.label}
              </span>
            );
          })}
        </div>
      </header>

      {/* Parameter table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10px] text-muted font-mono uppercase tracking-[1.4px] bg-surface2/20">
              <th className="px-5 py-2.5 font-semibold w-[28%]">
                NTPC Parameter
              </th>
              <th className="px-3 py-2.5 font-semibold w-[14%]">Reference</th>
              <th className="px-3 py-2.5 font-semibold w-[24%]">UGX Key</th>
              <th className="px-3 py-2.5 font-semibold w-[10%]">Status</th>
              <th className="px-5 py-2.5 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {section.parameters.map((p, i) => {
              const meta = STATUS_META[p.status];
              const Icon = meta.icon;
              return (
                <tr
                  key={i}
                  className="border-t border-line hover:bg-surface2/30 transition-colors"
                >
                  <td className="px-5 py-2.5 text-ink2 align-top">
                    {p.ntpcParameter}
                  </td>
                  <td className="px-3 py-2.5 text-muted font-mono text-[11px] align-top">
                    {p.ntpcReference}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {p.ugxKey ? (
                      <code className="text-[11.5px] font-mono text-brand-200/90 bg-brand-400/5 px-1.5 py-0.5 rounded">
                        {p.ugxKey}
                      </code>
                    ) : (
                      <span className="text-muted2 italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span
                      className={`inline-flex items-center gap-1 ${meta.color}`}
                    >
                      <Icon size={12} />
                      <span className="text-[11px] font-mono uppercase tracking-[1.2px]">
                        {meta.label}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-ink3 leading-relaxed align-top">
                    {p.note ?? <span className="text-muted2">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
