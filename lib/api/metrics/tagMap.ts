/**
 * Reverse tag mapping — vendor tag name → canonical metric id.
 *
 * The resolver (resolver.ts) answers "given a metric, where do I read it?".
 * This answers the opposite question: "the device published a tag called
 * `Grid_Power` — what is it?". That is what key discovery needs, because UGX
 * hands us a bare list of tag names with no metadata.
 *
 * Resolution runs in three passes, most precise first:
 *
 *   1. exact      the tag matches a binding path or one of its fallbacks,
 *                 including {placeholder} families (kW_inv_3 → site.inverterPower)
 *   2. alias      an explicit override in ALIASES, for spellings that are not
 *                 worth adding to the profile
 *   3. fuzzy      token-set equality after normalising case, separators and
 *                 synonyms, so gridPower / Grid_Power / grid_pwr all land on
 *                 site.gridPower without anyone editing a file
 *
 * ADDING A NEW TAG: put it in the profile's `fallbacks` array for that metric.
 * One line, one file, and every screen that asks for the metric picks it up.
 * Use ALIASES only when the tag should not be a first-class binding.
 */

import { METRICS, isMetricId, type MetricId } from "./registry";
import type { Profile, Binding } from "./types";

// ── Explicit aliases ─────────────────────────────────────────────────────────
// Last-resort overrides. Prefer the profile's `fallbacks`; this exists so a
// site with an odd tag can be onboarded without touching binding definitions.
const ALIASES: Record<string, MetricId> = {
  soc: "bank.soc",
  soh: "bank.soh",
  battery_soc: "bank.soc",
  bess_soc: "bank.soc",
  rack_soc: "rack.soc",
};

// ── Token normalisation (fuzzy pass) ─────────────────────────────────────────
const TOKEN_SYNONYMS: Record<string, string> = {
  pwr: "power", kw: "power", w: "power",
  volt: "voltage", v: "voltage",
  curr: "current", amp: "current", i: "current",
  temperature: "temp",
  amb: "ambient", mod: "module",
  spd: "speed", dir: "direction",
  irr: "irradiance", irradiation: "irradiance", ird: "irradiance",
  ghi: "irradiance", gii: "irradiance", poa: "irradiance",
  rh: "humidity",
  batt: "battery", bat: "battery", bess: "battery", stack: "battery",
  gen: "generation",
  imported: "import", exported: "export",
};

/** lowercase, split on separators and camelCase, drop digits, apply synonyms. */
function tokenise(tag: string): string[] {
  return tag
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((t) => TOKEN_SYNONYMS[t] ?? t)
    .sort();
}

const fingerprint = (tag: string) => tokenise(tag).join("|");

/** Token fingerprints that identify a metric when no binding matched. */
const FUZZY_HINTS: [string, MetricId][] = [
  ["grid power",            "site.gridPower"],
  ["station power",         "site.solarPower"],
  ["solar power",           "site.solarPower"],
  ["battery power",         "bank.power"],
  ["battery voltage",       "bank.voltage"],
  ["battery current",       "bank.current"],
  ["battery soc",           "bank.soc"],
  ["battery soh",           "bank.soh"],
  ["grid import",           "site.gridImportKwh"],
  ["grid export",           "site.gridExportKwh"],
  ["ambient temp",          "wms.ambientTemp"],
  ["module temp",           "wms.moduleTemp"],
  ["irradiance",            "wms.irradiance"],
  ["wind speed",            "wms.windSpeed"],
  ["wind direction",        "wms.windDirection"],
  ["humidity",              "wms.humidity"],
  ["frequency",             "pcs.frequency"],
];

const FUZZY_INDEX: Map<string, MetricId> = new Map(
  FUZZY_HINTS.map(([phrase, metric]) => [fingerprint(phrase), metric])
);

// ── Binding path matching ────────────────────────────────────────────────────

/** The binding's primary path — the tag it owns. */
function primaryPath(binding: Binding): string | null {
  if (binding.kind === "field") return binding.path;
  if (binding.kind === "array") return binding.expand ? binding.expand.keyTemplate : binding.path;
  return null;
}

/** Every literal path a binding reads, including fallbacks. */
function bindingPaths(binding: Binding): string[] {
  if (binding.kind === "field") return [binding.path, ...(binding.fallbacks ?? [])];
  if (binding.kind === "array") return binding.expand ? [binding.expand.keyTemplate] : [binding.path];
  return [];
}

/**
 * Turn a path template into a matcher. `{inv}` and `{n}` stand for an index,
 * so "kW_inv_{inv}" matches kW_inv_1 … kW_inv_99 and captures the index.
 */
function templateToRegex(template: string): RegExp | null {
  if (!template) return null;
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withHoles = escaped.replace(/\\\{\w+\\\}/g, "(\\d+)");
  return new RegExp(`^${withHoles}$`, "i");
}

export interface TagMatch {
  metric: MetricId;
  /** How the match was made — useful in the mapping inspector. */
  via: "exact" | "alias" | "fuzzy";
  /** Index captured from a {placeholder} family, e.g. 3 for kW_inv_3. */
  index?: number;
}

/**
 * Resolve a raw vendor tag to a canonical metric.
 * Returns null when nothing matches — the caller should treat the tag as
 * unclassified rather than guessing.
 */
export function matchTag(profile: Profile, tag: string): TagMatch | null {
  if (!tag) return null;

  // 1. exact. Primary paths are checked across ALL metrics before any
  //    fallback, so when two bindings can read the same tag the one that
  //    declares it as its own path wins. Without this the answer would depend
  //    on key order in the profile object.
  const passes: ((b: Binding) => string[])[] = [
    (b) => { const p = primaryPath(b); return p ? [p] : []; },
    (b) => bindingPaths(b).slice(1),
  ];

  for (const pathsOf of passes) {
    for (const [metric, binding] of Object.entries(profile.bindings)) {
      if (!isMetricId(metric)) continue;
      for (const path of pathsOf(binding)) {
        if (!path) continue;
        if (path.toLowerCase() === tag.toLowerCase()) {
          return { metric, via: "exact" };
        }
        if (path.includes("{")) {
          const re = templateToRegex(path);
          const m = re?.exec(tag);
          if (m) return { metric, via: "exact", index: m[1] ? parseInt(m[1], 10) : undefined };
        }
      }
    }
  }

  // 2. alias
  const alias = ALIASES[tag.toLowerCase()];
  if (alias) return { metric: alias, via: "alias" };

  // 3. fuzzy token-set match
  const fuzzy = FUZZY_INDEX.get(fingerprint(tag));
  if (fuzzy) return { metric: fuzzy, via: "fuzzy" };

  return null;
}

/** Convenience: just the metric id, or null. */
export function tagToMetric(profile: Profile, tag: string): MetricId | null {
  return matchTag(profile, tag)?.metric ?? null;
}

/** Scale factor a profile applies to this tag (1 when none) — keeps unit conversion in one place. */
export function scaleForTag(profile: Profile, tag: string): number {
  const match = matchTag(profile, tag);
  if (!match) return 1;
  const binding = profile.bindings[match.metric];
  if (binding && (binding.kind === "field" || binding.kind === "array") && binding.scale !== undefined) {
    return binding.scale;
  }
  return 1;
}

/** All literal tag names a profile reads for a metric — powers the inspector. */
export function metricToTags(profile: Profile, metric: MetricId): string[] {
  const binding = profile.bindings[metric];
  return binding ? bindingPaths(binding) : [];
}

/**
 * Classify a whole discovered key list at once.
 * Returns the metric per tag plus the tags nothing claimed, so an operator can
 * see exactly which registers still need a mapping.
 */
export function classifyTags(
  profile: Profile,
  tags: string[]
): { mapped: Record<string, TagMatch>; unmapped: string[] } {
  const mapped: Record<string, TagMatch> = {};
  const unmapped: string[] = [];
  for (const tag of tags) {
    const match = matchTag(profile, tag);
    if (match) mapped[tag] = match;
    else unmapped.push(tag);
  }
  return { mapped, unmapped };
}

/** Label + unit for a metric, for rendering a discovered tag. */
export function describeMetric(metric: MetricId): { label: string; unit: string } {
  const spec = METRICS[metric];
  return { label: spec.label, unit: spec.unit };
}
