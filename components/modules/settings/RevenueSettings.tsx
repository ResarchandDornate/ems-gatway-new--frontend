"use client";

/**
 * Settings → Revenue: the customer fills in what charging costs and what the
 * battery's discharge replaces, and sees the revenue that follows.
 *
 *   (A) cost of charging   (B) cost of discharging   (C) = B − A
 *   (E) units discharged   (D) revenue = E × C
 *
 * Saved on this app's server for everyone on the site (app/api/revenue-master);
 * the dashboard's Revenue card reads the same values.
 */

import { useEffect, useMemo, useState } from "react";
import type { Station } from "@/lib/api/types";
import {
  CHARGE_SOURCES, REPLACED_SOURCES, revenueFor, savingPerUnit,
  type ChargeSource, type ReplacedSource,
} from "@/lib/revenue/master";
import { useMonthlyDischarge, useRevenueMaster, useSaveRevenueMaster, useTariffTemplates } from "@/hooks/useRevenueMaster";
import { bestMonthKwh, istMonth } from "@/lib/revenue/monthly";
import { useCabinetReadings, useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { sumOver } from "@/lib/api/services/dashboardCentral.service";
import { useBessLiveCentral as useBessLive } from "@/hooks/useBessLiveCentral";
import { fmtINRCompact } from "@/lib/format";
import type { StateTariff, TariffSlot } from "@/lib/revenue/stateTariffs";

type PeriodId = "cycle" | "day" | "month" | "year" | "lifetime";
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "cycle", label: "Cycle" },
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "lifetime", label: "Lifetime" },
];

const rupee = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const kwhText = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-IN")} kWh`);

/** A ₹/kWh field's text, as a number when it is one. */
const asRate = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function RevenueSettings({ station }: { station: Station }) {
  const { data: saved, isLoading, isError, error } = useRevenueMaster();
  const save = useSaveRevenueMaster();
  const { data: templates } = useTariffTemplates();
  const tariffFor = (name: string) => (templates ?? []).find((t) => t.state === name);

  const [chargeSource, setChargeSource] = useState<ChargeSource>("solar");
  const [replacedSource, setReplacedSource] = useState<ReplacedSource>("grid");
  const [chargeCost, setChargeCost] = useState("");
  const [dischargeCost, setDischargeCost] = useState("");
  const [period, setPeriod] = useState<PeriodId>("month");
  const [stateName, setStateName] = useState("");

  /* Pick a state → fill the charge value (its solar price) and a representative
     discharge price (the base EC lifted to the evening peak slot). Both stay
     editable; the slots are shown so where the discharge price came from is
     visible, and whether the template is confirmed or indicative. */
  function applyState(name: string) {
    setStateName(name);
    const t = tariffFor(name);
    if (!t) return;
    const peak = t.slots.find((s) => /peak/i.test(s.name) && !/off/i.test(s.name));
    const disch = peak == null ? t.baseEnergyChargeRs
      : peak.modifierRs != null ? t.baseEnergyChargeRs + peak.modifierRs
      : Math.round(t.baseEnergyChargeRs * (1 + (peak.modifierPct ?? 0) / 100) * 100) / 100;
    setChargeSource("solar");
    setChargeCost(String(t.solarChargeValueRs));
    setDischargeCost(String(disch));
  }

  /* The form opens on what is saved. */
  useEffect(() => {
    if (!saved) return;
    setChargeSource(saved.chargeSource);
    setReplacedSource(saved.replacedSource);
    setChargeCost(String(saved.chargeCostRs));
    setDischargeCost(String(saved.dischargeCostRs));
    if (saved.state) setStateName(saved.state);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const a = asRate(chargeCost), b = asRate(dischargeCost);
  const draft = a != null && b != null ? { chargeCostRs: a, dischargeCostRs: b } : null;
  const saving = draft ? savingPerUnit(draft) : null;

  /* (E) for each period, over the cabinets the unit picker has selected —
     the figures Financials shows for the same selection (useFinancials). */
  const { all, selected } = useSelectedCabinets();
  const { data: readings } = useCabinetReadings();
  const { data: monthly } = useMonthlyDischarge();
  const live = useBessLive(station.id);
  const ids = all.map((c) => c.sourceId);
  const picked = selected.map((c) => c.sourceId);
  const units: Record<PeriodId, number | null> = useMemo(() => ({
    cycle: station.installedCapacity
      ? (station.installedCapacity * picked.length) / Math.max(1, ids.length)
      : null,
    day: live.dischargedKwh ?? null,
    month: bestMonthKwh(monthly, istMonth(Date.now()), picked, {
      nowKwh: sumOver(readings, picked, (c) => c.dcDischargeKwh),
      bmsNowKwh: sumOver(readings, picked, (c) => c.monthDischargeKwh),
    }),
    year: sumOver(readings, picked, (c) => c.yearDischargeKwh),
    lifetime: sumOver(readings, picked, (c) => c.dcDischargeKwh),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [station.installedCapacity, live.dischargedKwh, readings, monthly, picked.join("|"), ids.length]);
  const e = units[period];
  const d = revenueFor(draft, e);

  const changed = !saved || saved.chargeSource !== chargeSource || saved.replacedSource !== replacedSource
    || saved.chargeCostRs !== a || saved.dischargeCostRs !== b;
  const canSave = draft != null && changed && !save.isPending;

  const onSave = () => {
    if (!draft) return;
    save.mutate({ chargeSource, replacedSource, ...draft, state: stateName || undefined });
  };

  return (
    <div className="surface-card" style={{ padding: "var(--pad)" }}>
      <h3 className="card-title" style={{ marginBottom: 14 }}>Revenue Values</h3>

      <StatePicker value={stateName} onChange={applyState} templates={templates ?? []} />

      {isError && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--red)" }}>
          {(error as Error)?.message ?? "Could not load the saved values"}
        </div>
      )}

      <div className="settings-grid">
        <Field letter="A" label="Cost Of Charging">
          <Segmented options={CHARGE_SOURCES} value={chargeSource} onChange={setChargeSource} />
          <RateInput value={chargeCost} onChange={setChargeCost} disabled={isLoading} />
        </Field>

        <Field letter="B" label="Cost Of Discharging">
          <Segmented options={REPLACED_SOURCES} value={replacedSource} onChange={setReplacedSource} />
          <RateInput value={dischargeCost} onChange={setDischargeCost} disabled={isLoading} />
        </Field>
      </div>

      <div className="settings-calc">
        <Calc letter="C" label="Saving Per Unit" formula="B − A" value={saving == null ? "—" : `${rupee(saving)} / kWh`} warn={saving != null && saving < 0} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          <span className="card-eyebrow">Period</span>
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.id} onClick={() => setPeriod(p.id)} className={period === p.id ? "on" : undefined} aria-pressed={period === p.id}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Calc letter="E" label="Units Discharged" value={kwhText(e)} />
        <Calc letter="D" label="Revenue" formula="E × C" value={d == null ? "—" : fmtINRCompact(d)} strong warn={d != null && d < 0} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn-primary" onClick={onSave} disabled={!canSave} style={{ opacity: canSave ? 1 : 0.5 }}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <span style={{ fontSize: 11.5, color: save.isError ? "var(--red)" : "var(--muted)" }}>
          {save.isError
            ? (save.error as Error).message
            : draft == null && (chargeCost || dischargeCost)
              ? "Enter Both Costs As Numbers"
              : saved?.updatedAt
                ? `Saved By ${saved.updatedBy ?? "—"} · ${new Date(saved.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`
                : "Not Saved Yet"}
        </span>
      </div>
    </div>
  );
}

/** State dropdown that fills the rates from a ToD template, with the slots and
 *  whether they are a published figure or the framework default. */
function StatePicker({ value, onChange, templates }: { value: string; onChange: (v: string) => void; templates: StateTariff[] }) {
  const t = value ? templates.find((x) => x.state === value) : undefined;
  const names = templates.map((x) => x.state).sort((a, b) => a.localeCompare(b));
  const slotMod = (s: TariffSlot) =>
    s.modifierRs != null
      ? `${s.modifierRs > 0 ? "+" : ""}₹${s.modifierRs.toFixed(2)}`
      : `${(s.modifierPct ?? 0) > 0 ? "+" : ""}${s.modifierPct ?? 0}%`;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>State</span>
        <select className="filter-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 220 }}
                disabled={names.length === 0}>
          <option value="">{names.length ? "Select a state to auto-fill…" : "Loading states…"}</option>
          {names.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {t && (
          <span className={`pill ${t.verified ? "green" : "gray"}`} style={{ fontSize: 10.5 }}>
            <span className="dot" />{t.verified ? "Verified" : "Indicative"} · {t.financialYear}{t.discom ? ` · ${t.discom}` : ""}
          </span>
        )}
      </div>
      {t && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {t.slots.map((s) => (
            <span key={s.name} style={{ fontSize: 11, color: "var(--ink2)", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px" }}>
              <b style={{ color: "var(--ink)" }}>{s.name}</b> {s.start}–{s.end} · {slotMod(s)}
            </span>
          ))}
        </div>
      )}
      {t?.note && <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", maxWidth: 640 }}>{t.note}</div>}
    </div>
  );
}

function Field({ letter, label, children }: { letter: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <Letter>{letter}</Letter>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Calc({ letter, label, formula, value, strong, warn }: {
  letter: string; label: string; formula?: string; value: string; strong?: boolean; warn?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)", marginTop: letter === "C" ? 0 : 10 }}>
      <Letter>{letter}</Letter>
      <span style={{ fontSize: 12.5, color: "var(--ink3)" }}>{label}</span>
      {formula && <span style={{ fontSize: 11, color: "var(--muted)" }}>= {formula}</span>}
      <span style={{
        marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        fontSize: strong ? 20 : 14, fontWeight: strong ? 700 : 600,
        color: warn ? "var(--red)" : "var(--ink)",
      }}>{value}</span>
    </div>
  );
}

function Letter({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: 999, flex: "0 0 auto",
      fontSize: 10.5, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--line2)",
    }}>{children}</span>
  );
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className={value === o.id ? "on" : undefined} aria-pressed={value === o.id}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RateInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>₹</span>
      <input
        className="filter-input"
        type="number" inputMode="decimal" min={0} step="0.01"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 110 }}
      />
      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>/ kWh</span>
    </label>
  );
}
