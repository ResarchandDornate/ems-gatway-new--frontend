"use client";

import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStations } from "@/hooks/useStations";
import { getActiveGateway, setActiveGateway } from "@/lib/central/activeGateway";
import { fetchScadaDevices, type ScadaDevice } from "@/lib/api/services/scada.service";
import type { StationSelection } from "@/components/StationSelect";
import type { Station } from "@/lib/api/types/index";

const SEL_KEY    = "EMS_STATION_SEL";
const DEVICE_KEY = "EMS_DEVICE_SEL";

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

type StationCtx = {
  sel: StationSelection;
  setSel: (v: StationSelection) => void;
  station: Station | null;
  stations: Station[];
  /** Devices belonging to the selected station. Empty until they load. */
  devices: ScadaDevice[];
  devicesLoading: boolean;
  /**
   * The device every screen should read from, or "" before one is resolved.
   *
   * A station can own several devices, and plant config previously always
   * picked the GXORN-named one (falling back to the first). That is a sane
   * default but not a choice — selecting a device here overrides it, and
   * because usePlantConfig threads this through, every screen downstream
   * follows without knowing the selector exists.
   */
  deviceId: string;
  setDeviceId: (id: string) => void;
};

const StationContext = createContext<StationCtx>({
  sel: { mode: "station", id: "" },
  setSel: () => {},
  station: null,
  stations: [],
  devices: [],
  devicesLoading: false,
  deviceId: "",
  setDeviceId: () => {},
});

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSelState] = useState<StationSelection>(
    () => readLS<StationSelection>(SEL_KEY, { mode: "station", id: "" })
  );
  const { data: stations = [] } = useStations();

  function setSel(v: StationSelection) {
    setSelState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEL_KEY, JSON.stringify(v));
    }
  }

  // Once stations load, default to the first one if nothing is persisted —
  // or if what is persisted is a station this account does not have.
  useEffect(() => {
    if (stations.length > 0 && sel.mode === "station" && (sel.id === "" || !stations.some((s) => s.id === sel.id))) {
      setSel({ mode: "station", id: stations[0].id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations]);

  const station =
    sel.mode === "station"
      ? (stations.find((s) => s.id === sel.id) ?? null)
      : null;

  /* The picked station's gateway drives every screen (hooks/useAppConfig).
     On the Group Screen the last one stays; a stored gateway this account
     does not have falls back to the first. */
  useEffect(() => {
    if (station?.gatewayId) { setActiveGateway(station.gatewayId); return; }
    if (stations.length && !stations.some((s) => s.gatewayId === getActiveGateway())) {
      setActiveGateway(stations[0].gatewayId ?? stations[0].id);
    }
  }, [station, stations]);

  // ── Device selection ────────────────────────────────────────────────────────
  const customerId = station?.id ?? "";

  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ["stationDevices", customerId],
    queryFn:  () => fetchScadaDevices(customerId),
    enabled:  !!customerId,
    staleTime: 5 * 60_000,
  });

  // Persisted per station, so switching away and back keeps your choice rather
  // than snapping to whichever device happens to be first.
  const [deviceByStation, setDeviceByStation] = useState<Record<string, string>>(
    () => readLS<Record<string, string>>(DEVICE_KEY, {})
  );

  const deviceId = useMemo(() => {
    const saved = deviceByStation[customerId];
    if (saved && devices.some((d) => d.id === saved)) return saved;
    return devices[0]?.id ?? "";
  }, [deviceByStation, customerId, devices]);

  function setDeviceId(id: string) {
    setDeviceByStation((prev) => {
      const next = { ...prev, [customerId]: id };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DEVICE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  return (
    <StationContext.Provider
      value={{ sel, setSel, station, stations, devices, devicesLoading, deviceId, setDeviceId }}
    >
      {children}
    </StationContext.Provider>
  );
}

export function useStation() {
  return useContext(StationContext);
}

/**
 * The site a one-site page (Equipment, Power Station, Curves, Strategy) shows.
 *
 * On the Group Screen no station is selected, and those pages were handed an
 * empty id: Power Station read "Failed to load data", Equipment sat on
 * "Loading…" for good. With a single site the group IS that site, so it
 * stands in; with several, `needsPick` says the page should ask for one
 * rather than guess.
 */
export function usePageStation(): { station: Station | null; needsPick: boolean } {
  const { station, stations } = useStation();
  const site = station ?? (stations.length === 1 ? stations[0] : null);
  return { station: site, needsPick: !site && stations.length > 1 };
}
