"use client";

/**
 * The single-line power flow scene, on the phone.
 *
 * The same EnergyStage the web dashboard mounts, reading this app's own data
 * layer through useGatewayEnergy. Not a copy of it: a second implementation of
 * an approved visualisation is two products that drift, and the whole reason
 * tokens.json exists is that this one cannot afford that. What is local here is
 * the source and the frame around it; everything inside the canvas is shared.
 *
 * Loaded lazily by its caller. three, fiber and drei are the largest thing in
 * the bundle and nobody should pay for them before the dashboard has painted —
 * the same treatment BessHero already gets, for the same reason.
 */

import { EnergyStage } from "@/components/energy3d/EnergyStage";

import { useGatewayEnergy } from "./gatewayEnergy";

export interface PowerFlowStageProps {
  /** Passed through to the source; see GatewayEnergyOptions. */
  ratedCapacityKwh?: number | null;
}

export function PowerFlowStage({ ratedCapacityKwh = null }: PowerFlowStageProps) {
  const source = useGatewayEnergy({ ratedCapacityKwh });

  /* No overlay. It carries run days, CO₂ avoided and lifetime yield, two of
     which this gateway cannot answer, and its orbit hint reads as a lie on a
     screen where the gesture is a drag rather than a mouse. The figures that
     matter are on the asset callouts inside the scene and in the cards above
     it. */
  return <EnergyStage source={source} kind="external" />;
}

export default PowerFlowStage;
