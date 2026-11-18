/**
 * Electrical drawings shown on Power Station → Main Wiring Diagram and Network
 * Topology. The files live in /drawings at the repo root, NOT /public: they
 * are client documents, and anything under /public is served to whoever has
 * the URL. app/api/drawings serves them to a signed-in session only.
 *
 * `preview` is what the viewer draws; `original` is the file as received
 * (PDF), offered for opening and download where it differs. PDF previews are
 * single-page renders at 2400 px.
 */

export type DrawingKind = "sld" | "topology";

export interface Drawing {
  id: string;
  title: string;
  /** A few words that tell it apart in the picker. */
  label: string;
  /** Whose drawing it is — this site, or another project kept for reference. */
  site: string;
  thisSite: boolean;
  kind: DrawingKind[];
  preview: string;
  original?: string;
  note?: string;
}

export const DRAWINGS: Drawing[] = [
  {
    id: "site1-sld",
    label: "Islanded microgrid SLD",
    title: "415 V islanded hybrid microgrid — 2 × 125 kW / 261 kWh BESS + 100 kW PV + DG backup",
    site: "PV PowerTech",
    thisSite: true,
    kind: ["sld", "topology"],
    preview: "site1-islanded-microgrid-sld.jpg",
    note: "Single line with the EMS monitoring lines and control philosophy. Received as an image; some lettering is not legible — ask for the source drawing.",
  },
];

export const drawingFiles = new Set(DRAWINGS.flatMap((d) => [d.preview, d.original].filter((f): f is string => !!f)));
