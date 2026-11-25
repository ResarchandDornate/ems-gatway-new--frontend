"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAntiBackflowConfig, fetchDeviceSchedule, fetchCabinetSetpoints, fetchDemandConfig,
  fetchBackflowDay, fetchBackflowMeters,
} from "@/lib/api/services/strategyCentral.service";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import {
  fetchPolicyTemplates, savePolicyTemplate, deletePolicyTemplate, type PolicyTemplateInput,
  fetchPolicyPeriods, savePolicyPeriod, deletePolicyPeriod, type PolicyPeriodInput,
} from "@/lib/api/services/policyTemplate.service";

/* Keyed on the gateway, not the station overlay id — the strategy page's
   station id is not always the gateway's. Limits read from the shown cabinet. */
export const useAntiBackflow = (_stationId: string, date: string, meterId?: string) => {
  const { gatewayId, sourceId } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "antiBackflow", gatewayId, sourceId, date, meterId ?? ""],
    queryFn:  () => fetchBackflowDay(gatewayId, date, meterId, sourceId),
    enabled:  !!gatewayId && !!date,
    staleTime: 60_000,
  });
};

export const useBackflowMeters = (_stationId: string) => {
  const { gatewayId } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "backflowMeters", gatewayId],
    queryFn:  () => fetchBackflowMeters(gatewayId),
    enabled:  !!gatewayId,
    staleTime: 60_000,
  });
};

const templatesKey = (stationId: string) => ["strategy", "policyTemplates", stationId] as const;

export const usePolicyTemplates = (stationId: string) =>
  useQuery({
    queryKey: templatesKey(stationId),
    queryFn:  () => fetchPolicyTemplates(stationId),
    enabled:  !!stationId,
  });

export function useSavePolicyTemplate(stationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, creator, id }: { input: PolicyTemplateInput; creator: string; id?: string }) =>
      savePolicyTemplate(stationId, input, creator, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey(stationId) }),
  });
}

export function useDeletePolicyTemplate(stationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePolicyTemplate(stationId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey(stationId) }),
  });
}

const periodsKey = (stationId: string) => ["strategy", "policyPeriods", stationId] as const;

export const usePolicyPeriods = (stationId: string) =>
  useQuery({
    queryKey: periodsKey(stationId),
    queryFn:  () => fetchPolicyPeriods(stationId),
    enabled:  !!stationId,
  });

export function useSavePolicyPeriod(stationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, id }: { input: PolicyPeriodInput; id?: string }) => savePolicyPeriod(stationId, input, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: periodsKey(stationId) }),
  });
}

export function useDeletePolicyPeriod(stationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePolicyPeriod(stationId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: periodsKey(stationId) }),
  });
}

/* ── The cabinet's own configuration ──────────────────────────────────────── */

/**
 * What the equipment is actually set to, as opposed to what a template says.
 *
 * Both follow the unit picker: anti-backflow limits and the dispatch schedule
 * are per-cabinet registers, and a station is the site now, so the station id
 * cannot answer which cabinet.
 */
function useCabinetScope() {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  const shown = unit.sourceId ? unit : units.find((u) => u.sourceId);
  const sourceId = shown?.sourceId ?? "";
  return { gatewayId, sourceId, ready: !!gatewayId && !!sourceId, label: shown?.label ?? "", isFallback: !unit.sourceId };
}

/** Which cabinet the strategy screens read. Settings are per cabinet, so on
 *  Total they show the first one, and say so. */
export const useStrategyCabinet = () => {
  const { label, isFallback } = useCabinetScope();
  return { label, isFallback };
};

export const useAntiBackflowConfig = () => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "antiBackflowConfig", gatewayId, sourceId],
    queryFn:  () => fetchAntiBackflowConfig(gatewayId, sourceId),
    enabled:  ready,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
};

export const useDeviceSchedule = () => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "deviceSchedule", gatewayId, sourceId],
    queryFn:  () => fetchDeviceSchedule(gatewayId, sourceId),
    enabled:  ready,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
};

export const useCabinetSetpoints = () => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "cabinetSetpoints", gatewayId, sourceId],
    queryFn:  () => fetchCabinetSetpoints(gatewayId, sourceId),
    enabled:  ready,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
};

export const useDemandConfig = () => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: ["strategy", "demandConfig", gatewayId, sourceId],
    queryFn:  () => fetchDemandConfig(gatewayId, sourceId),
    enabled:  ready,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
};
