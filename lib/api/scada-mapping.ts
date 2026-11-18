/**
 * SCADA Parameter Mapping — NTPC EMS Spec ↔ UGX Telemetry
 *
 * HISTORICAL. This maps the NTPC requirement list against UGX, which is no
 * longer the backend — the app reads the NorthBound EMS Gateway. The NTPC
 * column is still the requirement and is still correct; every `status` and
 * `note` in the right-hand column describes a platform this app no longer
 * talks to, and none of them has been re-checked against the gateway.
 *
 * Kept because the left-hand column is a day's work and the exercise wants
 * repeating, not discarding: the gateway publishes 2,844 points against UGX's
 * few hundred, so most "missing" rows below are likely now covered. Redoing it
 * means walking the same NTPC list against
 * Northbound_EMS_Gateway_Telemetry_Data_Dictionary_20260810.csv. Until that
 * happens, /scada-coverage is reporting on the old backend and says so.
 *
 * Source documents:
 *   - NTPC: "Subsection-A 04 Energy Management System" (May 2026)
 *   - UGX:  "UGX API Reference v1.0" (May 2026)
 *
 * Coverage status per parameter:
 *   direct       — UGX key documented and maps 1:1 (SI conversion at most)
 *   derivable    — Computable from documented UGX keys (caveats noted)
 *   family       — Likely covered by a UGX key family (*_xfmr_9, IO_*) but
 *                  the family contents are not enumerated in the v1.0 PDF
 *   unconfirmed  — Likely exists on a real UnityESS device profile but not in
 *                  the documented sample (Dalmia DG-PV example)
 *   missing      — No UGX source; requires a new key on the device profile,
 *                  a new device on the platform, or out-of-band data
 *
 * Used by: app/scada/page.tsx (parameter coverage view).
 * When a key is confirmed by the backend dev, change `status` and `note`
 * here — the /scada page recomputes summary counts automatically.
 */

export type CoverageStatus =
  | "direct"
  | "derivable"
  | "family"
  | "unconfirmed"
  | "missing";

export interface ScadaParameterMap {
  ntpcParameter: string;
  ntpcReference: string;       // clause number for traceability
  ugxKey: string | null;       // null when missing
  status: CoverageStatus;
  note?: string;
}

export interface ScadaSection {
  id: string;
  title: string;
  scope: string;
  ntpcReference: string;
  parameters: ScadaParameterMap[];
}

export const SCADA_MAPPING: ScadaSection[] = [
  // ── 1. PCS DC Input ────────────────────────────────────────────────────────
  {
    id: "pcs-dc-input",
    title: "PCS DC Input (Battery → PCS)",
    scope:
      "Direct-current side of the Power Conversion System, between the battery cluster and the inverter bridge.",
    ntpcReference: "§3.00.00 (DAS), §11.00.00 row 1",
    parameters: [
      {
        ntpcParameter: "DC Power",
        ntpcReference: "§3.00.00 x, §11.00.00 row 1",
        ugxKey: "kW_dc_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "DC Voltage",
        ntpcReference: "§3.00.00 x, §11.00.00 row 1",
        ugxKey: "Vdc_inv_N (assumed)",
        status: "unconfirmed",
        note:
          "Not in documented key list; almost certainly exposed on real UnityESS device. Backend dev to confirm exact key name.",
      },
      {
        ntpcParameter: "DC Current",
        ntpcReference: "§3.00.00 x, §11.00.00 row 1",
        ugxKey: "Idc_inv_N (assumed)",
        status: "unconfirmed",
        note: "Same as DC voltage — not enumerated in PDF, presumed available.",
      },
      {
        ntpcParameter: "DC Fuse Blown",
        ntpcReference: "§3.00.00 xi",
        ugxKey: "IO_*",
        status: "family",
        note: "Likely under digital I/O family (IO_*) but exact key unknown.",
      },
      {
        ntpcParameter: "DC Leakage Current (battery-side ground fault)",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
        note:
          "No equivalent in UGX inverter telemetry. Typically a BMS parameter; partly out of scope for non-battery mapping.",
      },
    ],
  },

  // ── 2. PCS AC Output ───────────────────────────────────────────────────────
  {
    id: "pcs-ac-output",
    title: "PCS AC Output (PCS → Transformer / Grid)",
    scope:
      "Three-phase alternating-current terminals of the PCS, on the LT bus before the step-up transformer.",
    ntpcReference: "§3.00.00 x, §11.00.00 row 1",
    parameters: [
      {
        ntpcParameter: "AC Active Power (per PCS)",
        ntpcReference: "§3.00.00 x, §11.00.00 row 1",
        ugxKey: "kW_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "AC Active Power (station total)",
        ntpcReference: "§11.00.00 row 5",
        ugxKey: "kW_inv_all",
        status: "direct",
      },
      {
        ntpcParameter: "Phase A Voltage (line-neutral)",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Vr_inv_N",
        status: "direct",
        note:
          "R-phase (Indian R-Y-B, IS 1554) → A-phase (IEC). UGX gives line-to-neutral (~240 V on a 415 V LT system); multiply by √3 for line-to-line.",
      },
      {
        ntpcParameter: "Phase B Voltage (line-neutral)",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Vy_inv_N",
        status: "direct",
        note: "Y-phase → B-phase",
      },
      {
        ntpcParameter: "Phase C Voltage (line-neutral)",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Vb_inv_N",
        status: "direct",
        note: "B-phase (blue) → C-phase. Letter clash — easy to misread.",
      },
      {
        ntpcParameter: "Phase A Current",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Ir_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Phase B Current",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Iy_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Phase C Current",
        ntpcReference: "§3.00.00 x",
        ugxKey: "Ib_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Frequency at AC Bus",
        ntpcReference: "§3.00.00 x, §11.00.00 row 3",
        ugxKey: "Hz_grid_1",
        status: "direct",
        note:
          "Grid-tied PCS syncs to grid frequency; same value as inverter Hz output.",
      },
      {
        ntpcParameter: "Energy Delivered (cumulative export)",
        ntpcReference: "§3.00.00 x, §11.00.00 row 4",
        ugxKey: "kWh_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Daily Energy Export (per PCS)",
        ntpcReference: "§11.00.00 row 4",
        ugxKey: "kWh_inv_N_daily",
        status: "direct",
        note: "Via documented *_daily aggregated variant.",
      },
      {
        ntpcParameter: "Reactive Power",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: "√(S² − P²)",
        status: "derivable",
        note:
          "Magnitude only; sign (leading vs lagging) is lost without phase-angle data.",
      },
      {
        ntpcParameter: "Apparent Power",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: "√3 × V_LL_avg × I_avg / 1000",
        status: "derivable",
        note: "Assumes balanced 3-phase loading.",
      },
      {
        ntpcParameter: "Power Factor",
        ntpcReference: "§3.00.00 x, §11.00.00 row 1",
        ugxKey: "P / S",
        status: "derivable",
        note: "Sign lost; assumes balanced load.",
      },
      {
        ntpcParameter: "Phase A Angle",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
        note: "PV-style telemetry rarely exposes phase-angle data.",
      },
      {
        ntpcParameter: "Phase B Angle",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Phase C Angle",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Energy Received (import at PCS terminals)",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
        note:
          "PV inverters don't import; for BESS this is the charging energy. Need a bidirectional kWh key on the BESS device profile.",
      },
      {
        ntpcParameter: "AC Voltage OK (alarm)",
        ntpcReference: "§3.00.00 xi",
        ugxKey: "threshold on Vr/Vy/Vb_inv_N",
        status: "derivable",
        note: "Threshold logic applied client-side or via platform alarm rule.",
      },
      {
        ntpcParameter: "AC System Fault",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
        note: "Needs a PCS fault-code key.",
      },
    ],
  },

  // ── 3. PCS Thermal & Status ────────────────────────────────────────────────
  {
    id: "pcs-thermal-status",
    title: "PCS Thermal & Status",
    scope:
      "PCS health and operating-mode telemetry, excluding battery-side measurements.",
    ntpcReference: "§3.00.00 xi, §11.00.00 row 1, §17.00.00 A",
    parameters: [
      {
        ntpcParameter: "Operating Mode",
        ntpcReference: "§17.00.00 A",
        ugxKey: "mode",
        status: "direct",
      },
      {
        ntpcParameter: "Backup Status",
        ntpcReference: "§17.00.00 A",
        ugxKey: "backup",
        status: "direct",
      },
      {
        ntpcParameter: "Run Hours",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: "runhour_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Efficiency",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: "efficiency_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "PCS Room Temperature",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: null,
        status: "missing",
        note: "Ambient room sensor — not in inverter telemetry vocabulary.",
      },
      {
        ntpcParameter: "PCS Cabinet Temperature",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Module / IGBT Temperature",
        ntpcReference: "§11.00.00 row 1",
        ugxKey: null,
        status: "missing",
        note: "Critical for PCS health monitoring; required by NTPC historian.",
      },
      {
        ntpcParameter: "PCS Fault",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Synchronisation Error Shutdown",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Control Logic Problem",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
      },
    ],
  },

  // ── 4. PCS Duty Transformer ────────────────────────────────────────────────
  {
    id: "pcs-duty-transformer",
    title: "PCS Duty Transformer",
    scope:
      "Step-up transformer between PCS LT terminals and HT switchgear (typically 0.4 kV / 33 kV).",
    ntpcReference: "§1.07.00 c, §11.00.00",
    parameters: [
      {
        ntpcParameter: "HV-side 3-φ Voltage",
        ntpcReference: "§1.07.00 c",
        ugxKey: "Vr/Vy/Vb_xfmr_9 (assumed)",
        status: "family",
        note:
          "UGX exposes a *_xfmr_9 key family; contents not enumerated in v1.0 PDF.",
      },
      {
        ntpcParameter: "HV-side 3-φ Current",
        ntpcReference: "§1.07.00 c",
        ugxKey: "Ir/Iy/Ib_xfmr_9 (assumed)",
        status: "family",
      },
      {
        ntpcParameter: "HV-side Active Power",
        ntpcReference: "§1.07.00 c",
        ugxKey: "kW_xfmr_9 (assumed)",
        status: "family",
      },
      {
        ntpcParameter: "HV-side Reactive Power",
        ntpcReference: "§1.07.00 c",
        ugxKey: "kvar_xfmr_9 (assumed)",
        status: "family",
      },
      {
        ntpcParameter: "HV-side Energy",
        ntpcReference: "§1.07.00 c",
        ugxKey: "kWh_xfmr_9 (assumed)",
        status: "family",
      },
      {
        ntpcParameter: "LV-side 3-φ Voltage",
        ntpcReference: "§1.07.00 c",
        ugxKey: "Vr/Vy/Vb_inv_N",
        status: "direct",
        note: "PCS terminals = LT side of transformer.",
      },
      {
        ntpcParameter: "LV-side 3-φ Current",
        ntpcReference: "§1.07.00 c",
        ugxKey: "Ir/Iy/Ib_inv_N",
        status: "direct",
      },
      {
        ntpcParameter: "Winding Temperature (R-Y-B + Neutral)",
        ntpcReference: "§1.07.00 c",
        ugxKey: null,
        status: "missing",
        note: "Required by IS 2026 / IEC 60076. RTD on each phase + neutral.",
      },
      {
        ntpcParameter: "Oil Temperature (top / bottom)",
        ntpcReference: "§1.07.00 c",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Tap Position",
        ntpcReference: "§1.07.00 c",
        ugxKey: null,
        status: "missing",
        note: "OLTC tap-position indicator.",
      },
      {
        ntpcParameter: "Buchholz / PRV Alarm",
        ntpcReference: "§1.07.00 c",
        ugxKey: "IO_*",
        status: "family",
        note: "Likely under digital I/O family.",
      },
      {
        ntpcParameter: "WTI / OTI Trip",
        ntpcReference: "§1.07.00 c",
        ugxKey: "IO_*",
        status: "family",
      },
      {
        ntpcParameter: "Cooling Fan / Pump Status",
        ntpcReference: "§1.07.00 c",
        ugxKey: "IO_*",
        status: "family",
      },
    ],
  },

  // ── 5. MFM / Energy Meter / Numerical Relay ───────────────────────────────
  {
    id: "mfm-energy-relay",
    title: "MFM / Energy Meter / Numerical Relay",
    scope:
      "Multi-function meter and protection-relay measurements at switchgear bays.",
    ntpcReference: "§11.00.00 row 2, §3.00.00 iv (g)",
    parameters: [
      {
        ntpcParameter: "Active Power",
        ntpcReference: "§11.00.00 row 2",
        ugxKey: "kW_grid_N",
        status: "direct",
        note: "If the meter CT is at the grid connection.",
      },
      {
        ntpcParameter: "Reactive Power",
        ntpcReference: "§11.00.00 row 2",
        ugxKey: null,
        status: "missing",
        note: "No kvar_grid_N in documented list.",
      },
      {
        ntpcParameter: "Energy (day)",
        ntpcReference: "§11.00.00 row 2",
        ugxKey: "kWh_grid_N_daily",
        status: "direct",
      },
      {
        ntpcParameter: "Current (3-φ)",
        ntpcReference: "§11.00.00 row 2",
        ugxKey: "Ir/Iy/Ib_grid_N (assumed)",
        status: "unconfirmed",
      },
      {
        ntpcParameter: "Voltage (3-φ)",
        ntpcReference: "§11.00.00 row 2",
        ugxKey: "Vr/Vy/Vb_grid_N (assumed)",
        status: "unconfirmed",
      },
    ],
  },

  // ── 6. Export-Feeder Energy Meter ─────────────────────────────────────────
  {
    id: "export-feeder-meter",
    title: "Export-Feeder Energy Meter",
    scope:
      "Bidirectional metering at the point of common coupling (PCC) for grid import/export accounting.",
    ntpcReference: "§11.00.00 row 3",
    parameters: [
      {
        ntpcParameter: "Active Power",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "kW_grid_N",
        status: "direct",
      },
      {
        ntpcParameter: "Reactive Power",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Energy Import",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "grid_imported",
        status: "direct",
      },
      {
        ntpcParameter: "Energy Export",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "kWh_grid_N (window-delta)",
        status: "derivable",
      },
      {
        ntpcParameter: "Current (3-φ)",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "Ir/Iy/Ib_grid_N (assumed)",
        status: "unconfirmed",
      },
      {
        ntpcParameter: "Voltage (3-φ)",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "Vr/Vy/Vb_grid_N (assumed)",
        status: "unconfirmed",
      },
      {
        ntpcParameter: "Grid Frequency",
        ntpcReference: "§11.00.00 row 3",
        ugxKey: "Hz_grid_1",
        status: "direct",
      },
    ],
  },

  // ── 7. Auxiliary System ───────────────────────────────────────────────────
  {
    id: "auxiliary-system",
    title: "Auxiliary System",
    scope:
      "Station auxiliary loads — HVAC, fire system, lighting, control room, charger circuits.",
    ntpcReference: "§3.00.00 x",
    parameters: [
      {
        ntpcParameter: "Auxiliary Power",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
        note:
          "Required for net round-trip efficiency. No aux key in UGX; needs a separate aux meter as its own platform device, or aux channels broken out on the existing MFM.",
      },
      {
        ntpcParameter: "Auxiliary Energy",
        ntpcReference: "§3.00.00 x",
        ugxKey: null,
        status: "missing",
      },
    ],
  },

  // ── 8. Breakers / Switchgear Digital I/O ──────────────────────────────────
  {
    id: "breakers-switchgear-io",
    title: "Breakers / Switchgear Digital I/O",
    scope:
      "Status of HT breakers, RMU, LT panel breakers, and the bus-coupler.",
    ntpcReference: "§1.07.00 ii, §1.07.00 iv (b, d), §3.00.00 xi",
    parameters: [
      {
        ntpcParameter: "Breaker Status (connect/disconnect)",
        ntpcReference: "§3.00.00 xi",
        ugxKey: "IO_*",
        status: "family",
        note: "UGX explicitly mentions ACB and grid-control under IO_*.",
      },
      {
        ntpcParameter: "HT Switchgear Status",
        ntpcReference: "§1.07.00 iv (b)",
        ugxKey: "IO_*",
        status: "family",
      },
      {
        ntpcParameter: "RMU Status",
        ntpcReference: "§1.07.00 iv (b)",
        ugxKey: "IO_*",
        status: "family",
      },
      {
        ntpcParameter: "LT Panel Incomer / Bus-Coupler Breaker",
        ntpcReference: "§1.07.00 iv (d)",
        ugxKey: "IO_*",
        status: "family",
      },
    ],
  },

  // ── 9. Container Safety ───────────────────────────────────────────────────
  {
    id: "container-safety",
    title: "Container Safety",
    scope: "Physical safety sensors on the BESS container.",
    ntpcReference: "§3.00.00 xi",
    parameters: [
      {
        ntpcParameter: "Main Temperature Alarm",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Smoke / Fire Alarm",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
        note: "Fire system not in PV/DG telemetry vocabulary.",
      },
      {
        ntpcParameter: "Container Door Open",
        ntpcReference: "§3.00.00 xi",
        ugxKey: null,
        status: "missing",
        note: "Door-position sensor not in inverter telemetry.",
      },
    ],
  },

  // ── 10. Power Quality Meter (Class-A IEC 61000-4-30) ──────────────────────
  {
    id: "power-quality-meter",
    title: "Power Quality Meter (Class-A IEC 61000-4-30)",
    scope:
      "Dedicated Class-A power-quality meter for harmonics, sag/swell, flicker, LVRT/HVRT — distinct from inverter telemetry.",
    ntpcReference: "§16.00.00",
    parameters: [
      {
        ntpcParameter: "3-φ Voltage / Current",
        ntpcReference: "§16.00.00 ii",
        ugxKey: "V*_inv_N, I*_inv_N",
        status: "derivable",
        note:
          "Inverter telemetry can stand in for basic V/I but is not Class-A compliant.",
      },
      {
        ntpcParameter: "Harmonics (amplitude + phase)",
        ntpcReference: "§16.00.00 ii",
        ugxKey: null,
        status: "missing",
        note: "Requires a Class-A meter as a separate device on the platform.",
      },
      {
        ntpcParameter: "Voltage Sag / Swell",
        ntpcReference: "§16.00.00 ii",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "Flicker",
        ntpcReference: "§16.00.00 ii",
        ugxKey: null,
        status: "missing",
      },
      {
        ntpcParameter: "LVRT / HVRT 10-sec Fault Recording",
        ntpcReference: "§16.00.00 ii",
        ugxKey: null,
        status: "missing",
        note: "Per CEA Regulation; PQM-specific.",
      },
      {
        ntpcParameter: "DC Injection at AC Bus",
        ntpcReference: "§16.00.00 vi",
        ugxKey: null,
        status: "missing",
      },
    ],
  },
];

// ── Convenience helpers ───────────────────────────────────────────────────────

export function countByStatus(): Record<CoverageStatus, number> {
  const counts: Record<CoverageStatus, number> = {
    direct: 0,
    derivable: 0,
    family: 0,
    unconfirmed: 0,
    missing: 0,
  };
  for (const section of SCADA_MAPPING) {
    for (const p of section.parameters) {
      counts[p.status]++;
    }
  }
  return counts;
}

export function totalParameters(): number {
  return SCADA_MAPPING.reduce((s, sec) => s + sec.parameters.length, 0);
}
