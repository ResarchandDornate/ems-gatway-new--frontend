/**
 * Which assets a site has — the five configurations the twin draws.
 *
 * A site is described by its asset list, not by a case number: the diagram is
 * built from whatever is present, so a sixth combination needs no new code.
 * The five named cases are the ones UnityESS sites are commissioned as, and
 * they exist here so a picker can offer them.
 */

export type SiteAsset = "load" | "bess" | "pv" | "grid" | "dg";

export interface SiteCase {
  id: string;
  label: string;
  assets: SiteAsset[];
}

export const SITE_CASES: SiteCase[] = [
  { id: "load-bess-pv-grid",    label: "Load · BESS · PV · Grid",      assets: ["load", "bess", "pv", "grid"] },
  { id: "load-bess-pv",         label: "Load · BESS · PV",             assets: ["load", "bess", "pv"] },
  { id: "load-bess-grid",       label: "Load · BESS · Grid",           assets: ["load", "bess", "grid"] },
  { id: "load-bess-pv-grid-dg", label: "Load · BESS · PV · Grid · DG", assets: ["load", "bess", "pv", "grid", "dg"] },
  { id: "bess-pv-grid",         label: "BESS · PV · Grid",             assets: ["bess", "pv", "grid"] },
];

/** Used when a site does not say what it has. */
export const DEFAULT_SITE_ASSETS: SiteAsset[] = SITE_CASES[0].assets;
