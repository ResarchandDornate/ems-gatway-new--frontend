"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession } from "@/lib/central";
import { useAppConfig } from "@/hooks/useAppConfig";
import type { RevenueMaster, ChargeSource, ReplacedSource } from "@/lib/revenue/master";
import type { StateTariff } from "@/lib/revenue/stateTariffs";
import type { LifetimeDoc, MonthlyDoc } from "@/lib/revenue/monthly";

const KEY = (gw: string) => ["revenueMaster", gw] as const;

/* The tariff now lives in the backend (src/financials), reached through the
   /api/central proxy. Field names cross snake_case ↔ camelCase here. */
interface BackendConfig {
  state?: string | null;
  charge_source: string;
  charge_cost_rs: number;
  replaced_source: string;
  discharge_cost_rs: number;
  base_energy_charge_rs?: number | null;
  solar_charge_value_rs?: number | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

const toMaster = (c: BackendConfig | null): RevenueMaster | null =>
  c == null ? null : {
    chargeSource: c.charge_source as ChargeSource,
    chargeCostRs: c.charge_cost_rs,
    replacedSource: c.replaced_source as ReplacedSource,
    dischargeCostRs: c.discharge_cost_rs,
    state: c.state ?? undefined,
    updatedBy: c.updated_by ?? undefined,
    updatedAt: c.updated_at ? Date.parse(c.updated_at) : undefined,
  };

async function fetchConfig(gw: string): Promise<RevenueMaster | null> {
  const s = getSession();
  if (!s || !gw) return null;
  const r = await fetch(`/api/central/financials/revenue-config?gateway_id=${encodeURIComponent(gw)}`, {
    headers: { authorization: `Bearer ${s.token}` }, cache: "no-store",
  });
  if (!r.ok) throw new Error(`Could not reach the server (${r.status})`);
  return toMaster(((await r.json()) as { config: BackendConfig | null }).config);
}

async function saveConfig(gw: string, m: RevenueMaster & { state?: string }): Promise<RevenueMaster | null> {
  const s = getSession();
  if (!s) throw new Error("Not signed in");
  if (!gw) throw new Error("No gateway selected");
  const body = {
    state: m.state ?? null,
    charge_source: m.chargeSource,
    charge_cost_rs: m.chargeCostRs,
    replaced_source: m.replacedSource,
    discharge_cost_rs: m.dischargeCostRs,
  };
  const r = await fetch(`/api/central/financials/revenue-config?gateway_id=${encodeURIComponent(gw)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(r.status === 422 ? "Check the values and try again" : `Could not reach the server (${r.status})`);
  return toMaster(((await r.json()) as { config: BackendConfig | null }).config);
}

/** The site's revenue master, or null when nobody has filled it in yet. */
export function useRevenueMaster() {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: KEY(gatewayId),
    queryFn: () => fetchConfig(gatewayId),
    enabled: !!gatewayId,
    staleTime: 60_000, retry: 1,
  });
}

export function useSaveRevenueMaster() {
  const qc = useQueryClient();
  const { gatewayId } = useAppConfig();
  return useMutation({
    mutationFn: (m: RevenueMaster & { state?: string }) => saveConfig(gatewayId, m),
    onSuccess: (saved) => qc.setQueryData(KEY(gatewayId), saved),
  });
}

/* ── ToD tariff templates (backend reference data) ──────────────────────── */

interface BackendTemplate {
  state: string;
  discom?: string | null;
  financial_year: string;
  verified: boolean;
  base_energy_charge_rs: number;
  solar_charge_value_rs: number;
  note?: string | null;
  slots: { name: string; start: string; end: string; modifier_pct?: number | null; modifier_rs?: number | null }[];
}

const toTariff = (t: BackendTemplate): StateTariff => ({
  state: t.state,
  discom: t.discom ?? undefined,
  financialYear: t.financial_year,
  verified: t.verified,
  baseEnergyChargeRs: t.base_energy_charge_rs,
  solarChargeValueRs: t.solar_charge_value_rs,
  note: t.note ?? undefined,
  slots: t.slots.map((s) => ({
    name: s.name, start: s.start, end: s.end,
    modifierPct: s.modifier_pct ?? undefined,
    modifierRs: s.modifier_rs ?? undefined,
  })),
});

/** Every state's ToD template, served by the backend (src/financials/templates). */
export function useTariffTemplates() {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["tariffTemplates"],
    queryFn: async (): Promise<StateTariff[]> => {
      const s = getSession();
      if (!s) throw new Error("Not signed in");
      const r = await fetch("/api/central/financials/tariff-templates", {
        headers: { authorization: `Bearer ${s.token}` }, cache: "no-store",
      });
      if (!r.ok) throw new Error(`Could not reach the server (${r.status})`);
      return ((await r.json()) as BackendTemplate[]).map(toTariff);
    },
    enabled: !!gatewayId,
    staleTime: 24 * 60 * 60_000,
  });
}

/** Each month's discharge counters as the server recorded them (lib/revenue/monthly). */
export function useMonthlyDischarge() {
  return useQuery({
    queryKey: ["monthlyDischarge"],
    queryFn: async (): Promise<{ months: MonthlyDoc; lifetime: LifetimeDoc }> => {
      const s = getSession();
      if (!s) throw new Error("Not signed in");
      const r = await fetch("/api/monthly-discharge", { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" });
      if (!r.ok) throw new Error(`Could not reach the server (${r.status})`);
      const j = (await r.json()) as { months?: MonthlyDoc; lifetime?: LifetimeDoc };
      return { months: j.months ?? {}, lifetime: j.lifetime ?? {} };
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
