"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { usePolicyTemplates, usePolicyPeriods, useSavePolicyTemplate, useDeletePolicyTemplate } from "@/hooks/useStrategy";
import { getSession } from "@/lib/central";
import {
  validatePolicyTemplate, actionMovesPower, uncoveredHours, POLICY_ACTIONS, SOC_FLOOR, SOC_CEILING,
  type PolicyTemplate, type PolicyAction, type PolicyTemplateInput, type PolicySlot,
} from "@/lib/api/services/policyTemplate.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState }   from "@/components/shared/EmptyState";
import { ConfirmInline } from "./ConfirmInline";
import { TemplateChart } from "./TemplateChart";

const PAGE_SIZES = [10, 20, 50];

const th = "text-left py-3 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold";
const td = "py-2.5 px-4";
const link = "text-[12px] font-medium underline underline-offset-2 hover:opacity-80";

/** A new row starts where the last one ended, so the day stays unbroken. */
const newSlot = (after?: PolicySlot): PolicySlot => ({
  start: after?.end ?? "", end: "", action: "charging",
  powerKw: 0, reactiveKvar: 0,
  socMin: SOC_FLOOR, socMax: SOC_CEILING,
});

const ACTION_LABEL: Record<PolicyAction, string> = {
  charging: "Charging", discharging: "Discharging", standby: "Standby", shutdown: "Shutdown",
};

/** "" for an empty cell, so a 0 the user cleared does not reappear as 0. */
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function fmtTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── Add / Edit / Detail dialog ────────────────────────────────────────────────

type DialogMode = { kind: "add" } | { kind: "edit" | "detail"; template: PolicyTemplate };

function TemplateDialog({ stationId, mode, onClose }: { stationId: string; mode: DialogMode; onClose: () => void }) {
  const src = mode.kind === "add" ? null : mode.template;
  const readOnly = mode.kind === "detail";
  const [name,   setName]   = useState(src?.name ?? "");
  const [nameEn, setNameEn] = useState(src?.nameEn ?? "");
  const [slots,  setSlots]  = useState<PolicySlot[]>(src?.slots.map(s => ({ ...s })) ?? [newSlot()]);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useSavePolicyTemplate(stationId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setSlot = (i: number, patch: Partial<PolicySlot>) =>
    setSlots(list => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function confirm() {
    const input: PolicyTemplateInput = { name: name.trim(), nameEn: nameEn.trim(), slots };
    const errs = validatePolicyTemplate(input);
    setErrors(errs);
    if (errs.length) return;
    /* The signed-in account that saved it, from the central backend's session.
       This read the retired NorthBound session, which is always null, so every
       template said "—". Logins are usernames, not full names. */
    const u = getSession();
    try {
      await save.mutateAsync({ input, creator: u?.username ?? "—", id: src?.id });
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not save the template."]);
    }
  }

  const uncovered = uncoveredHours(slots);

  const title = mode.kind === "add" ? "Add Template" : mode.kind === "edit" ? "Edit Template" : "Template Detail";
  const cell  = "filter-input h-8 text-[12px] w-full";

  return (
    <div
      className="fixed inset-0 z-50 bg-bg/70 backdrop-blur-sm grid place-items-center px-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="tpl-title" className="surface-card w-full max-w-[1040px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 id="tpl-title" className="text-[15px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
          <label className="grid sm:grid-cols-[170px_1fr] items-center gap-2">
            <span className="text-[12px] text-ink2"><span className="text-[var(--red)]">* </span>Template Name</span>
            <input value={name} onChange={e => setName(e.target.value)} disabled={readOnly}
              placeholder="Please Enter Template Name" className="filter-input h-9 text-[12.5px]" autoFocus={!readOnly} />
          </label>
          <label className="grid sm:grid-cols-[170px_1fr] items-center gap-2">
            <span className="text-[12px] text-ink2"><span className="text-[var(--red)]">* </span>Template Name (English)</span>
            <input value={nameEn} onChange={e => setNameEn(e.target.value)} disabled={readOnly}
              placeholder="Enter English Name" className="filter-input h-9 text-[12.5px]" />
          </label>

          <TemplateChart slots={slots} />

          <div className="eq-card overflow-x-auto">
            <table className="w-full text-[12px] min-w-[860px]">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  <th className={th}>Start Time</th>
                  <th className={th}>End Time</th>
                  <th className={th}>Action</th>
                  <th className={th}>Power (kW)</th>
                  <th className={th}>Reactive Power (kVar)</th>
                  <th className={th}>SOC Lower (%)</th>
                  <th className={th}>SOC Upper (%)</th>
                  {!readOnly && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {slots.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-6 text-muted">No Time Slots — Add A Row.</td></tr>
                )}
                {slots.map((s, i) => (
                  <tr key={i} className="border-b border-line/40 last:border-none">
                    <td className="py-2 px-3">
                      <input type="time" value={s.start} disabled={readOnly} aria-label={`Row ${i + 1} start time`}
                        onChange={e => setSlot(i, { start: e.target.value })} className={cell} />
                    </td>
                    <td className="py-2 px-3">
                      <input type="time" value={s.end} disabled={readOnly} aria-label={`Row ${i + 1} end time`}
                        onChange={e => setSlot(i, { end: e.target.value })} className={cell} />
                    </td>
                    <td className="py-2 px-3">
                      <select value={s.action} disabled={readOnly} aria-label={`Row ${i + 1} action`}
                        onChange={e => {
                          /* Standby and shutdown hold no set point, so drop the
                             numbers rather than keeping a power the cabinet will
                             never apply. Switching back starts them at 0. */
                          const action = e.target.value as PolicyAction;
                          const moves  = actionMovesPower(action);
                          setSlot(i, {
                            action,
                            powerKw:      moves ? (s.powerKw ?? 0) : null,
                            reactiveKvar: moves ? (s.reactiveKvar ?? 0) : null,
                          });
                        }} className={cell}>
                        {POLICY_ACTIONS.map(v => <option key={v} value={v}>{ACTION_LABEL[v]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      {actionMovesPower(s.action) ? (
                        <input type="number" min={0} step="any" value={s.powerKw ?? ""} disabled={readOnly}
                          aria-label={`Row ${i + 1} power (kW)`} placeholder="0"
                          onChange={e => setSlot(i, { powerKw: numOrNull(e.target.value) })} className={`${cell} tabular-nums`} />
                      ) : (
                        <span className="text-muted text-[11.5px]" title={`Not set on ${ACTION_LABEL[s.action].toLowerCase()}`}>—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {actionMovesPower(s.action) ? (
                        <input type="number" step="any" value={s.reactiveKvar ?? ""} disabled={readOnly}
                          aria-label={`Row ${i + 1} reactive power (kVar)`} placeholder="0"
                          onChange={e => setSlot(i, { reactiveKvar: numOrNull(e.target.value) })} className={`${cell} tabular-nums`} />
                      ) : (
                        <span className="text-muted text-[11.5px]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={SOC_FLOOR} max={SOC_CEILING} step="any" value={s.socMin} disabled={readOnly}
                        aria-label={`Row ${i + 1} SOC lower limit (%)`}
                        onChange={e => setSlot(i, { socMin: Number(e.target.value) })} className={`${cell} tabular-nums`} />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={SOC_FLOOR} max={SOC_CEILING} step="any" value={s.socMax} disabled={readOnly}
                        aria-label={`Row ${i + 1} SOC upper limit (%)`}
                        onChange={e => setSlot(i, { socMax: Number(e.target.value) })} className={`${cell} tabular-nums`} />
                    </td>
                    {!readOnly && (
                      <td className="py-2 pr-3">
                        <button onClick={() => setSlots(l => l.filter((_, j) => j !== i))}
                          aria-label={`Delete row ${i + 1}`} className="text-muted hover:text-[var(--red)]">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly && (
              <div className="flex justify-end px-3 py-2.5 border-t border-line">
                <button onClick={() => setSlots(l => [...l, newSlot(l[l.length - 1])])} className="btn-outline"><Plus size={12} />Add Row</button>
              </div>
            )}
          </div>

          {uncovered.length > 0 && errors.length === 0 && (
            <p className="text-[11.5px] text-muted">Not Covered: {uncovered.join(", ")}</p>
          )}

          {errors.length > 0 && (
            <ul role="alert" className="text-[11.5px] text-[var(--bad-ink)] list-disc pl-5 space-y-0.5">
              {errors.map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
          <button onClick={onClose} className="btn-outline">{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && (
            <button onClick={confirm} disabled={save.isPending} className="btn-primary">
              {save.isPending ? "Saving…" : "Confirm"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template list ─────────────────────────────────────────────────────────────

export function PolicyTemplates({ stationId }: { stationId: string }) {
  const { data = [], isLoading } = usePolicyTemplates(stationId);
  const remove = useDeletePolicyTemplate(stationId);
  const periods = usePolicyPeriods(stationId).data ?? [];
  const [dialog,   setDialog]   = useState<DialogMode | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page,     setPage]     = useState(1);
  const [deletingId, setDeleting] = useState<string | null>(null);

  const pages = Math.max(1, Math.ceil(data.length / pageSize));
  const cur   = Math.min(page, pages);
  const rows  = data.slice((cur - 1) * pageSize, cur * pageSize);

  function deletePrompt(t: PolicyTemplate) {
    const used = periods.filter(p => p.templateId === t.id).length;
    return used
      ? `Used on ${used} date range${used === 1 ? "" : "s"}, which will be left without a template. Delete?`
      : "Delete this template?";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setDialog({ kind: "add" })} className="btn-primary"><Plus size={12} />Add</button>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? <div className="p-5"><LoadingState rows={3} /></div> : data.length === 0 ? (
          <EmptyState title="No Templates Yet" description="" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  {["Serial", "Policy Name", "Creator", "Create Time", "Action"].map(h => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={t.id} className={`border-b border-line/40 last:border-none ${i % 2 === 0 ? "bg-surface2/15" : ""}`}>
                    <td className={`${td} font-mono text-ink3`}>{(cur - 1) * pageSize + i + 1}</td>
                    <td className={`${td} text-ink`}>{t.name}</td>
                    <td className={`${td} text-ink2`}>{t.creator}</td>
                    <td className={`${td} font-mono tabular-nums text-ink2`}>{fmtTime(t.createdAt)}</td>
                    <td className={td}>
                      {deletingId === t.id ? (
                        <ConfirmInline
                          message={deletePrompt(t)}
                          onConfirm={() => { remove.mutate(t.id); setDeleting(null); }}
                          onCancel={() => setDeleting(null)}
                        />
                      ) : (
                        <div className="flex gap-4">
                          <button onClick={() => setDialog({ kind: "edit", template: t })}   className={`${link} text-accent`}>Edit</button>
                          <button onClick={() => setDialog({ kind: "detail", template: t })} className={`${link} text-ink2`}>Detail</button>
                          <button onClick={() => setDeleting(t.id)} className={`${link} text-[var(--red)]`}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-t border-line text-[11.5px] text-muted">
            <span>Total {data.length} Item{data.length === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                aria-label="Rows per page" className="filter-input h-7 text-[11.5px] w-auto">
                {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / Page</option>)}
              </select>
              <button onClick={() => setPage(cur - 1)} disabled={cur <= 1} aria-label="Previous page" className="btn-outline h-7 px-2 disabled:opacity-40"><ChevronLeft size={12} /></button>
              <span className="font-mono tabular-nums text-ink2">{cur} / {pages}</span>
              <button onClick={() => setPage(cur + 1)} disabled={cur >= pages} aria-label="Next page" className="btn-outline h-7 px-2 disabled:opacity-40"><ChevronRight size={12} /></button>
            </div>
          </div>
        )}
      </div>

      {dialog && <TemplateDialog stationId={stationId} mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
