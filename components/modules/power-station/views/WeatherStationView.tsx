"use client";

/**
 * WeatherStationView — rendered only when PlantConfig.wms === true.
 *
 * On the NorthBound EMS Gateway that is never true, and this view is a stated
 * absence rather than a chart with no data in it.
 *
 * The gateway polls nine asset kinds — bms_1, pcs_1, ems_system, utility_meter,
 * liquid_cooling, fire_protection, dehumidifier, io_module, remote_control —
 * and none of them is a weather station. Nothing in the 2,844-point telemetry
 * dictionary measures irradiance, wind or module temperature.
 *
 * Two readings come close enough to be worth ruling out explicitly, because
 * they are what somebody restoring this view would reach for first:
 * `liquid_cooling.outdoor_temperature` and `dehumidifier.current_temperature`
 * are cabinet-adjacent thermometers, not meteorological instruments. Plotting
 * either under a WMS heading would put a plant-room temperature on an axis
 * labelled ambient, and the performance figures this view used to feed — CUF,
 * performance ratio, specific yield — would then be computed from it.
 *
 * The previous implementation auto-discovered WMS keys from a UGX data logger
 * and drew irradiance, module temperature and daily irradiation. It is in the
 * git history at the commit that removed the UGX client, and is the place to
 * start if a weather station is ever added to this gateway's asset list.
 */

import { CloudOff } from "lucide-react";

/* `stationId` is accepted and unused. The caller passes it and there is no
   reason to make the caller change for a view that has nothing to fetch. */
export function WeatherStationView(_props: { stationId?: string }) {
  return (
    <div className="surface-card p-8 grid place-items-center text-center">
      <div className="w-11 h-11 rounded-ctl bg-muted/10 ring-1 ring-line grid place-items-center mb-3">
        <CloudOff size={18} className="text-muted" />
      </div>
      <h3 className="text-[14px] font-semibold text-ink mb-1.5">No Weather Station</h3>
      <p className="text-[12px] text-muted leading-relaxed max-w-[420px]">
        This plant&rsquo;s gateway polls nine assets and none of them measures
        irradiance, wind or module temperature. Nothing on this page can be
        shown without one.
      </p>
    </div>
  );
}

export default WeatherStationView;
