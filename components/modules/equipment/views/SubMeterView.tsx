"use client";

/**
 * Sub Meter — per-cabinet metering.
 *
 * Same screen as the site meter, different truth behind it: the Northbound
 * gateway dictionary carries exactly one meter asset, `utility_meter`, and no
 * sub-metering signal of any kind across all 1,422 points per source. This
 * needs a register set before it needs a feed.
 */

import { EmptyState } from "@/components/shared/EmptyState";

export function SubMeterView() {
  /* No figures at all, rather than the site meter's figures under a per-cabinet
     heading, and rather than the invented set that used to be here. Both would
     be claims about a measurement point that does not exist: the gateway
     carries exactly one meter asset across all 1,422 points per source, and it
     is at the point of common coupling. */
  return (
    <EmptyState
      title="No Sub-Meter On This Gateway"
      description="This plant has one meter asset, utility_meter, and it is the site meter at the point of common coupling — its readings are on Main Electricity Meter. Per-cabinet metering needs a register set before it needs a feed."
    />
  );
}
