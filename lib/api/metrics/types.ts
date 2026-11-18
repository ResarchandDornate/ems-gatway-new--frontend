/**
 * Metric binding layer — core types.
 *
 * The problem this solves: the UI should never name a vendor tag. It asks for
 * a canonical metric ("bank.voltage") and a source profile decides where that
 * comes from, how it is scaled, and whether it exists at all.
 *
 * A plain Record<string, string> rename map is not enough, because sources
 * differ along four axes at once:
 *
 *   naming      stack_volt            -> bank_voltage
 *   scaling     pre-scaled            -> raw Modbus register x 0.1
 *   units       mA, V, per-mille      -> A, mV, %
 *   shape       384 discrete keys     -> one array point
 *
 * ...and some metrics are direct in one source and derived in another (AC line
 * voltage is computed as phase x sqrt(3) on UGX, but published directly by the
 * Kinetics gateway). Bindings therefore carry a descriptor, not a string.
 */

/** Canonical unit vocabulary. A metric declares exactly one; bindings convert into it. */
export type Unit =
  | "V" | "mV" | "A" | "kW" | "kVar" | "kVA" | "kWh" | "Ah"
  | "°C" | "%" | "Hz" | "Bar" | "kΩ" | "mΩ" | "rpm" | "deg"
  | "count" | "enum" | "bool" | "";

export interface MetricSpec {
  /** Canonical unit. Bindings are responsible for converting into this. */
  unit: Unit;
  /** Human label for debug output and the audit report. */
  label: string;
  /** True when negative values are meaningful (charge/discharge, import/export). */
  signed?: boolean;
  /** Scalar reading vs an array (per-cell voltages, per-rack rows). */
  array?: boolean;
}

// ── Bindings ─────────────────────────────────────────────────────────────────

/**
 * Read one value from the source payload.
 *
 * `path` is a dot path resolved against the payload. Segments in braces are
 * substituted from the read context, so one binding serves every configured
 * asset: "assets.{bank}.telemetry.bank_voltage.value".
 *
 * For flat key/value sources (UGX telemetry maps) the path is just the key.
 */
export interface FieldBinding {
  kind: "field";
  path: string;
  /** Multiplied into the raw value to reach the metric's canonical unit. */
  scale?: number;
  /** Applied after `scale` for anything a multiplier cannot express. */
  transform?: (raw: number) => number;
  /** Tried in order when `path` yields nothing — for sources with naming variants. */
  fallbacks?: string[];
}

/** Compute a metric from other *canonical metrics*, not from raw tags. */
export interface DerivedBinding {
  kind: "derived";
  from: string[];
  compute: (values: (number | null)[]) => number | null;
  /** Why this is computed rather than read — surfaced in the audit report. */
  note?: string;
}

/** Read an array of values (per-cell voltages, per-rack rows). */
export interface ArrayBinding {
  kind: "array";
  path: string;
  scale?: number;
  /**
   * Expand one array point into N readings, or gather N discrete keys into one
   * array. `count` is the register *span* the firmware exposes, which is not the
   * same as the number of physical sensors — see `zeroPadded`.
   */
  expand?: { keyTemplate: string; count: number };
  /**
   * The tail of the register block is padding, not readings.
   *
   * UnityESS BMS firmware sizes each block to the largest pack it supports and
   * zero-fills the remainder, so a 512-register cell block on a 416-cell rack
   * reports 96 trailing 0.0 values. Those are indistinguishable from readings
   * once they reach the UI, where a 0 mV cell renders as a dead cell.
   *
   * Set this only where zero is physically impossible for a connected sensor
   * (cell voltage, cell temperature in °C on a live pack). The array is then
   * truncated at the last non-zero reading, so the length reflects the hardware
   * actually present and adapts on its own to a differently sized pack.
   */
  zeroPadded?: boolean;
}

/**
 * This source genuinely does not publish this metric.
 *
 * Declaring absence explicitly is the point: it lets the UI render "no source"
 * instead of a fabricated zero, and it makes the gap visible in the audit
 * report rather than silently missing.
 */
export interface UnmappedBinding {
  kind: "unmapped";
  reason: string;
}

export type Binding = FieldBinding | DerivedBinding | ArrayBinding | UnmappedBinding;

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  label: string;
  /**
   * How a resolved path is interpreted:
   *   "flat"   payload is Record<tag, value>       (UGX telemetry map)
   *   "nested" payload is an object tree            (Kinetics gateway response)
   */
  shape: "flat" | "nested";
  bindings: Record<string, Binding>;
}

/** Runtime values substituted into `{placeholder}` path segments. */
export type ReadContext = Record<string, string | number>;

// ── Readings ─────────────────────────────────────────────────────────────────

export type ReadingStatus =
  | "ok"        // value present
  | "absent"    // bound, but the source returned null/undefined this poll
  | "unmapped"  // this profile has no binding for the metric
  | "unknown";  // metric id not in the registry

export interface Reading {
  metric: string;
  value: number | null;
  unit: Unit;
  status: ReadingStatus;
  /** Populated for `unmapped` and `unknown` so the UI can explain the gap. */
  reason?: string;
}

export interface ArrayReading {
  metric: string;
  values: (number | null)[];
  unit: Unit;
  status: ReadingStatus;
  reason?: string;
}
