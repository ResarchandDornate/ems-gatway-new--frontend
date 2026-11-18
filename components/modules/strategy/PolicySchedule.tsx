"use client";

import { useState } from "react";
import { CalendarPlus, RotateCcw } from "lucide-react";
import {
  usePolicyTemplates, usePolicyPeriods, useSavePolicyPeriod, useDeletePolicyPeriod,
} from "@/hooks/useStrategy";
import {
  MONTHS, MONTH_DAYS, formatMonthDay, periodCovers, periodDays, uncoveredDays,
  validatePolicyPeriod, type PolicyPeriod,
} from "@/lib/api/services/policyTemplate.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState }   from "@/components/shared/EmptyState";
import { ConfirmInline } from "./ConfirmInline";

const th = "text-left py-3 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold";
const td = "py-2.5 px-4";
const link = "text-[12px] font-medium underline underline-offset-2 hover:opacity-80";

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's "MM-DD" on the local clock — the station's day, not UTC's. */
function todayMonthDay() {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day + month picker producing "MM-DD", or "" until both are chosen. */
function MonthDayPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [m, d] = value ? value.split("-").map(Number) : [0, 0];
  const maxDay = m ? MONTH_DAYS[m - 1] : 31;
  const emit = (month: number, day: number) =>
    onChange(month && day ? `${pad(month)}-${pad(Math.min(day, MONTH_DAYS[month - 1]))}` : "");
  // Hold a half-chosen value locally so picking the month first does not clear the day.
  const [draft, setDraft] = useState<{ m: number; d: number }>({ m, d });
  const cur = value ? { m, d } : draft;

  return (
    <div className="flex items-center gap-1.5">
      <select value={cur.d || ""} aria-label={`${label} day`} className="filter-input h-8 text-[11.5px] w-[64px]"
        onChange={e => { const day = Number(e.target.value); setDraft({ m: cur.m, d: day }); emit(cur.m, day); }}>
        <option value="">Day</option>
        {Array.from({ length: cur.m ? MONTH_DAYS[cur.m - 1] : maxDay }, (_, k) => k + 1).map(n => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <select value={cur.m || ""} aria-label={`${label} month`} className="filter-input h-8 text-[11.5px] w-[76px]"
        onChange={e => { const month = Number(e.target.value); setDraft({ m: month, d: cur.d }); emit(month, cur.d); }}>
        <option value="">Month</option>
        {MONTHS.map((name, k) => <option key={name} value={k + 1}>{name}</option>)}
      </select>
    </div>
  );
}

/**
 * Charge-discharge policy by date range. Where the reference screen fixes one
 * template per calendar month, this assigns a template to any run of days —
 * 20 Jan → 15 Feb is one row — and the schedule repeats every year.
 */
export function PolicySchedule({ stationId }: { stationId: string }) {
  const templates = usePolicyTemplates(stationId);
  const periods   = usePolicyPeriods(stationId);
  const save      = useSavePolicyPeriod(stationId);
  const remove    = useDeletePolicyPeriod(stationId);

  const [from, setFrom]         = useState("");
  const [to, setTo]             = useState("");
  const [templateId, setTplId]  = useState("");
  const [editingId, setEditing] = useState<string | null>(null);
  const [deletingId, setDeleting] = useState<string | null>(null);
  const [errors, setErrors]     = useState<string[]>([]);
  // Remounts the pickers on reset/edit so their half-chosen drafts clear too.
  const [formKey, setFormKey]   = useState(0);

  const list    = periods.data ?? [];
  const tpls    = templates.data ?? [];
  const nameOf  = (id: string) => tpls.find(t => t.id === id)?.name;
  const today   = todayMonthDay();
  const current = list.find(p => periodCovers(p, today));
  const gaps    = uncoveredDays(list);

  function reset() {
    setFrom(""); setTo(""); setTplId(""); setEditing(null); setErrors([]); setFormKey(k => k + 1);
  }

  function edit(p: PolicyPeriod) {
    setFrom(p.from); setTo(p.to); setTplId(p.templateId); setEditing(p.id); setErrors([]); setFormKey(k => k + 1);
  }

  async function submit() {
    const input = { from, to, templateId };
    const errs = validatePolicyPeriod(input, list, editingId ?? undefined);
    setErrors(errs);
    if (errs.length) return;
    try {
      await save.mutateAsync({ input, id: editingId ?? undefined });
      reset();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not save the period."]);
    }
  }

  function doDelete(p: PolicyPeriod) {
    remove.mutate(p.id);
    setDeleting(null);
    if (editingId === p.id) reset();
  }

  if (templates.isLoading || periods.isLoading) return <LoadingState rows={4} />;

  return (
    <div className="flex flex-col gap-4">
      {/* Assign a template to a date range */}
      <div className="surface-card p-4 flex flex-col gap-3">
        <div key={formKey} className="flex items-center gap-3 flex-wrap">
          <span className="text-[11.5px] text-ink3">From</span>
          <MonthDayPicker label="From" value={from} onChange={setFrom} />
          <span className="text-[11.5px] text-ink3">To</span>
          <MonthDayPicker label="To" value={to} onChange={setTo} />
          <span className="text-[11.5px] text-ink3 ml-1">Template</span>
          <select value={templateId} onChange={e => setTplId(e.target.value)} disabled={!tpls.length}
            aria-label="Template" className="filter-input h-8 text-[11.5px] w-auto min-w-[180px]">
            <option value="">{tpls.length ? "Select Template" : "No Templates Yet"}</option>
            {tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={submit} disabled={save.isPending || !tpls.length} className="btn-primary disabled:opacity-50">
            <CalendarPlus size={12} />{editingId ? "Save" : "Assign"}
          </button>
          <button onClick={reset} className="btn-outline"><RotateCcw size={12} />{editingId ? "Cancel" : "Reset"}</button>
          {from && to && (
            <span className="text-[11px] text-muted font-mono">{periodDays(from, to)} Days</span>
          )}
        </div>
        {!tpls.length && (
          <p className="text-[11.5px] text-muted">No Templates</p>
        )}
        {errors.length > 0 && (
          <ul role="alert" className="text-[11.5px] text-[var(--bad-ink)] list-disc pl-5 space-y-0.5">
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap text-[12px] text-ink2 px-1">
        <span>
          Today ({formatMonthDay(today)}):{" "}
          {current
            ? <span className="font-semibold text-accent">{nameOf(current.templateId) ?? "Deleted Template"}</span>
            : <span className="text-muted">No Policy Scheduled</span>}
        </span>
        {list.length > 0 && (
          <span className="text-muted">{gaps === 0 ? "Every Day Covered" : `${gaps} Days Without Policy`}</span>
        )}
      </div>

      <div className="surface-card overflow-hidden">
        {list.length === 0 ? (
          <EmptyState title="No Policy Periods" description="" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  {["Serial", "From", "To", "Days", "Template", "Action"].map(h => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => {
                  const name   = nameOf(p.templateId);
                  const active = periodCovers(p, today);
                  return (
                    <tr key={p.id} className={`border-b border-line/40 last:border-none ${editingId === p.id ? "bg-accent/10" : i % 2 === 0 ? "bg-surface2/15" : ""}`}>
                      <td className={`${td} font-mono text-ink3`}>{i + 1}</td>
                      <td className={`${td} text-ink2`}>{formatMonthDay(p.from)}</td>
                      <td className={`${td} text-ink2`}>{formatMonthDay(p.to)}</td>
                      <td className={`${td} font-mono tabular-nums text-ink2`}>{periodDays(p.from, p.to)}</td>
                      <td className={`${td} ${name ? "text-ink" : "text-[var(--bad-ink)]"}`}>
                        {name ?? "Deleted Template"}
                        {active && <span className="ml-2 text-[11px] font-mono tracking-[1px] text-accent">Active Today</span>}
                      </td>
                      <td className={td}>
                        {deletingId === p.id ? (
                          <ConfirmInline
                            message="Remove this period?"
                            onConfirm={() => doDelete(p)}
                            onCancel={() => setDeleting(null)}
                          />
                        ) : (
                          <div className="flex gap-4">
                            <button onClick={() => edit(p)} className={`${link} text-accent`}>Edit</button>
                            <button onClick={() => setDeleting(p.id)} className={`${link} text-[var(--red)]`}>Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
