"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession } from "@/lib/central";
import type { RevenueMaster } from "@/lib/revenue/master";
import type { LifetimeDoc, MonthlyDoc } from "@/lib/revenue/monthly";

const KEY = ["revenueMaster"] as const;

async function call(init?: RequestInit): Promise<RevenueMaster | null> {
  const s = getSession();
  if (!s) throw new Error("Not signed in");
  const r = await fetch("/api/revenue-master", {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(r.status === 422 ? "Check the values and try again" : `Could not reach the server (${r.status})`);
  return ((await r.json()) as { master: RevenueMaster | null }).master;
}

/** The site's revenue master, or null when nobody has filled it in yet. */
export function useRevenueMaster() {
  return useQuery({ queryKey: KEY, queryFn: () => call(), staleTime: 60_000, retry: 1 });
}

export function useSaveRevenueMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: RevenueMaster) => call({ method: "POST", body: JSON.stringify(m) }),
    onSuccess: (saved) => qc.setQueryData(KEY, saved),
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
