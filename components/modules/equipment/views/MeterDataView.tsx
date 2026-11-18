"use client";

import { useMeterData } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import { EmptyState }   from "@/components/shared/EmptyState";

const TOD_COLS = ["Peak", "Shoulder", "Flat", "Valley", "Total"] as const;

function MeterTable({ title, rows }: { title: string; rows: { label: string; peak: number; shoulder: number; flat: number; valley: number; total: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({ peak: acc.peak + r.peak, shoulder: acc.shoulder + r.shoulder, flat: acc.flat + r.flat, valley: acc.valley + r.valley, total: acc.total + r.total }),
    { peak: 0, shoulder: 0, flat: 0, valley: 0, total: 0 }
  );

  return (
    <div className="surface-card overflow-hidden flex-1">
      <div className="px-5 py-4 border-b border-line">
        <h4 className="text-[12.5px] font-semibold text-ink">{title}</h4>
        <p className="text-[11px] font-mono tracking-[1.3px] text-muted mt-0.5">kWh · Time-Of-Day Bucketed</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface2/40">
              <th className="text-left py-2.5 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Date</th>
              {TOD_COLS.map(c => (
                <th key={c} className="text-right py-2.5 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-line/40 last:border-none ${i % 2 === 0 ? "bg-surface2/15" : ""}`}>
                <td className="py-2.5 px-4 text-ink2">{r.label}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-ink2">{r.peak.toFixed(2)}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-ink2">{r.shoulder.toFixed(2)}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-ink2">{r.flat.toFixed(2)}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-ink2">{r.valley.toFixed(2)}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-ink">{r.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface2/40">
              <td className="py-2.5 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Total</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-accent">{totals.peak.toFixed(2)}</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-accent">{totals.shoulder.toFixed(2)}</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-accent">{totals.flat.toFixed(2)}</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-accent">{totals.valley.toFixed(2)}</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-accent">{totals.total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function MeterDataView({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = useMeterData(stationId);

  if (isLoading) return <LoadingState rows={5} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;
  if (!data?.length) return <EmptyState title="No Meter Data" />;

  return (
    <div className="flex flex-col gap-6">
      {data.map(meter => (
        <div key={meter.meterId}>
          <div className="mb-3">
            <h3 className="text-[13px] font-semibold text-ink">{meter.meterName}</h3>
            <p className="text-[10.5px] text-muted font-mono mt-0.5">Meter ID: {meter.meterId} · {meter.date}</p>
          </div>
          <div className="flex flex-col lg:flex-row gap-4">
            <MeterTable
              title="kWh Charge (kWh)"
              rows={[{ label: meter.date, ...meter.charge }]}
            />
            <MeterTable
              title="kWh Discharge (kWh)"
              rows={[{ label: meter.date, ...meter.discharge }]}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
