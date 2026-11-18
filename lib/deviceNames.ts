/**
 * Display names for devices.
 *
 * Purely presentational: UGX keeps its own names and nothing here is ever
 * written back. The platform names are commissioning identifiers — EMS_TEST,
 * GXTEST_UI01 — which are the right thing to have on the platform and the
 * wrong thing to show someone reading a dashboard, who thinks in sites.
 *
 * Because it is display-only, the raw name stays available and every place
 * that renders a label also carries the original in its tooltip, so an
 * operator can still tie what they are looking at back to the device in UGX.
 *
 * Keys are matched case-insensitively, exact first and then by prefix, so a
 * family like GXTEST_UI01 / GXTEST_UI02 maps from a single "GXTEST" entry.
 * Anything unlisted renders under its own name.
 */

const DEVICE_LABELS: Record<string, string> = {
  EMS_TEST: "Gujarat Site",
  GXTEST:   "Nagpur Site",
};

/** Human label for a device, or the name unchanged when it is not mapped. */
export function deviceLabel(name: string | null | undefined): string {
  if (!name) return "—";

  const key = name.trim().toUpperCase();
  if (DEVICE_LABELS[key]) return DEVICE_LABELS[key];

  for (const [prefix, label] of Object.entries(DEVICE_LABELS)) {
    if (key.startsWith(prefix)) return label;
  }
  return name;
}

/** True when a device is shown under a different name than UGX holds. */
export function isRenamed(name: string | null | undefined): boolean {
  return !!name && deviceLabel(name) !== name;
}

/**
 * Tooltip text for a renamed device — "EMS_TEST on UGX" — so the platform
 * identifier is one hover away wherever the label is shown. Empty when the
 * device is not renamed, since repeating the visible name adds nothing.
 */
export function deviceTitle(name: string | null | undefined): string {
  return isRenamed(name) ? `${name} on the gateway` : "";
}

/** Cabinet display name: `bess_1` / `external_ems_1` → `BESS 1`. Display only. */
export function cabinetLabel(id: string | null | undefined): string {
  if (!id) return "";
  const m = /^(?:external_ems_|bess[_\s-]?)(\d+)$/i.exec(id.trim());
  return m ? `BESS ${m[1]}` : id;
}
