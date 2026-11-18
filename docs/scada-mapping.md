# SCADA Parameter Mapping — NTPC EMS ↔ UGX Telemetry

**Status:** v1 reference for the backend conversation
**Branch:** `scada-parameter-mapping`
**Source documents:** NTPC Subsection-A 04 (Energy Management System), UGX API Reference v1.0
**Live view:** `http://localhost:3000/scada` (run `npm run dev`)

## Purpose

This document maps every non-battery parameter in NTPC's EMS specification to the corresponding key in the UGX (`platform.uniqgrid.com`) telemetry API. It is the authoritative reference used when negotiating with the UGX backend developer about which keys must be added to the UnityESS device profile to satisfy NTPC SCADA compliance.

## How the data is organised

The canonical list lives in `lib/api/scada-mapping.ts` as the `SCADA_MAPPING` constant. Each entry has:

- `ntpcParameter` — name as it appears in NTPC Subsection-A 04
- `ntpcReference` — clause number for traceability back to the spec
- `ugxKey` — UGX telemetry key, or `null` when no source exists
- `status` — coverage classification (see below)
- `note` — caveats, assumptions, conversion formulas

## Coverage classification

Each parameter falls into one of five buckets defined by the `CoverageStatus` enum:

| Status | Meaning |
|---|---|
| `direct` | UGX key documented and maps 1:1 (SI conversion at most). |
| `derivable` | Computable from documented keys; caveats noted in the table. |
| `family` | Likely covered by a documented key family (`*_xfmr_9`, `IO_*`) but the family contents are not enumerated in the v1.0 PDF. |
| `unconfirmed` | Likely present on a real UnityESS device profile but absent from the Dalmia DG-PV sample in the PDF. |
| `missing` | No UGX source; requires a new key on the device profile, a new device on the platform, or out-of-band data. |

## Sections covered

1. PCS DC Input
2. PCS AC Output
3. PCS Thermal & Status
4. PCS Duty Transformer
5. MFM / Energy Meter / Numerical Relay
6. Export-Feeder Energy Meter
7. Auxiliary System
8. Breakers / Switchgear Digital I/O
9. Container Safety
10. Power Quality Meter (Class-A IEC 61000-4-30)

For the parameter-by-parameter table with current status and notes, see the live `/scada` page or read `lib/api/scada-mapping.ts` directly. Both stay in sync because the page reads from the constant.

## Top-line gaps

The five highest-priority items to raise with the backend developer:

1. **Enumerate the `*_xfmr_9` key family.** Closes the entire transformer section if winding/oil temperatures and tap position are included.
2. **Enumerate the `IO_*` key family.** Closes breakers/switchgear and most transformer-protection alarms (Buchholz, PRV, WTI/OTI, cooling fan/pump).
3. **Confirm `Vdc_inv_N` and `Idc_inv_N`** on a real UnityESS BESS device profile — not the Dalmia DG-PV example used in the PDF.
4. **Confirm `kvar_inv_N`, `kva_inv_N`, `pf_inv_N`, and PCS room/cabinet/IGBT temperature keys** on a real UnityESS BESS device profile. Without these, four NTPC historian fields and the PCS thermal view cannot be served.
5. **Decide aux-metering strategy.** Either add a separate aux meter as its own UGX device, or break out aux-circuit channels on the existing MFM. Without aux power/energy, net round-trip efficiency cannot be reported per NTPC §3.00.00 x.

## Maintenance

When the backend developer confirms a key, change the entry's `status` from `unconfirmed`, `family`, or `missing` to `direct` (or `derivable`) in `lib/api/scada-mapping.ts` and update the `note` field. The summary counts on `/scada` recompute automatically — no other change needed.

For new sections (e.g., NTPC introduces a v2 spec, or a new device class is added), append a new `ScadaSection` to `SCADA_MAPPING` following the same shape.

## Conventions

- **Phase notation.** Indian R-Y-B (IS 1554) maps to IEC A-B-C: R→A, Y→B, B→C. The letter clash between UGX `Vb_inv_N` (B-phase, blue) and NTPC "Phase B" (B = second phase = Y in Indian convention) is the most common source of mis-reads. Always verify against the convention column in the table.
- **Voltage convention.** UGX returns line-to-neutral voltages (~240 V on a 415 V LT system). NTPC and the existing frontend types assume line-to-line. Multiply by √3 unless field semantics are changed.
- **Sign convention for power.** UGX is documented for solar PV inverters where `kW_inv_N` is positive when generating. For a BESS, charging is conventionally shown as negative. Confirm with backend whether the deployed UnityESS device reports bidirectional `kW_inv_N` with a sign, or as magnitude plus a separate mode key.
