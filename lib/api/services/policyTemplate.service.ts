/**
 * Charge-discharge policy templates — a named 24-hour schedule of set points:
 * when, what the cabinet should do, at what power, and between which SOC
 * limits.
 *
 * UGX has no policy endpoint yet, so templates are kept in this browser's
 * storage, one list per station. Swap the three functions below for real
 * calls when the endpoint ships; the hooks and UI do not need to change.
 */

/**
 * What the cabinet does during a slot. One column, because direction and run
 * state were never independent: "charge" while stopped means nothing.
 */
export const POLICY_ACTIONS = ["charging", "discharging", "standby", "shutdown"] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

/** Only charging and discharging move power, so only they carry set points. */
export function actionMovesPower(action: PolicyAction): boolean {
  return action === "charging" || action === "discharging";
}

export const SOC_FLOOR = 0;
export const SOC_CEILING = 100;

export interface PolicySlot {
  start: string;   // "HH:MM"
  end:   string;   // "HH:MM", after start; "00:00" means midnight at the end of the day
  action: PolicyAction;
  /** kW, charging/discharging only — null on standby and shutdown. */
  powerKw: number | null;
  /** kVar, charging/discharging only. May be negative (leading vs lagging). */
  reactiveKvar: number | null;
  /** Stop discharging below this SOC, %. */
  socMin: number;
  /** Stop charging above this SOC, %. */
  socMax: number;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  nameEn: string;
  slots: PolicySlot[];
  creator: string;
  createdAt: number;
  updatedAt: number;
}

export type PolicyTemplateInput = Pick<PolicyTemplate, "name" | "nameEn" | "slots">;

const storageKey = (stationId: string) => `ems.policyTemplates.${stationId}`;

function read(stationId: string): PolicyTemplate[] {
  try {
    const raw = localStorage.getItem(storageKey(stationId));
    if (!raw) return [];
    /* Slots have been through two earlier shapes: {direction, enabled} and
       then {direction, status}. Both fold into one action, and neither knew
       about reactive power or SOC limits, so those come back as defaults. */
    type LegacySlot = PolicySlot & { enabled?: boolean; direction?: string; status?: string };
    const toAction = (s: LegacySlot): PolicyAction => {
      if (s.action) return s.action;
      if (s.status === "standby") return "standby";
      if (s.status === "stop" || s.enabled === false) return "shutdown";
      return s.direction === "discharge" ? "discharging" : "charging";
    };
    return (JSON.parse(raw) as PolicyTemplate[]).map(t => ({
      ...t,
      slots: t.slots.map((raw: LegacySlot) => {
        const action = toAction(raw);
        const moves  = actionMovesPower(action);
        return {
          start: raw.start,
          end:   raw.end,
          action,
          powerKw:      moves ? (raw.powerKw ?? 0) : null,
          reactiveKvar: moves ? (raw.reactiveKvar ?? 0) : null,
          socMin: raw.socMin ?? SOC_FLOOR,
          socMax: raw.socMax ?? SOC_CEILING,
        };
      }),
    }));
  } catch {
    return [];
  }
}

function write(stationId: string, list: PolicyTemplate[]): void {
  try {
    localStorage.setItem(storageKey(stationId), JSON.stringify(list));
  } catch {
    throw new Error("This browser would not save the template (storage blocked or full).");
  }
}

export async function fetchPolicyTemplates(stationId: string): Promise<PolicyTemplate[]> {
  return read(stationId).sort((a, b) => b.createdAt - a.createdAt);
}

export async function savePolicyTemplate(
  stationId: string,
  input: PolicyTemplateInput,
  creator: string,
  id?: string,
): Promise<PolicyTemplate> {
  const list = read(stationId);
  const now  = Date.now();
  const existing = id ? list.find(t => t.id === id) : undefined;
  const saved: PolicyTemplate = existing
    ? { ...existing, ...input, updatedAt: now }
    : { id: crypto.randomUUID(), ...input, creator, createdAt: now, updatedAt: now };
  write(stationId, existing ? list.map(t => (t.id === id ? saved : t)) : [...list, saved]);
  return saved;
}

export async function deletePolicyTemplate(stationId: string, id: string): Promise<void> {
  write(stationId, read(stationId).filter(t => t.id !== id));
}

const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
/** A time picker cannot say 24:00, so an end of 00:00 is read as midnight tonight. */
const endMin = (hm: string) => (toMin(hm) === 0 ? 24 * 60 : toMin(hm));

/** Human-readable problems with a template, empty when it can be saved. */
export function validatePolicyTemplate(t: PolicyTemplateInput): string[] {
  const errs: string[] = [];
  if (!t.name.trim())   errs.push("Enter a template name.");
  if (!t.nameEn.trim()) errs.push("Enter the English template name.");
  if (!t.slots.length)  errs.push("Add at least one time slot.");
  t.slots.forEach((s, i) => {
    const n = `Row ${i + 1}`;
    if (!s.start || !s.end)                   errs.push(`${n}: set a start and end time.`);
    else if (endMin(s.end) <= toMin(s.start)) errs.push(`${n}: end time must be after start time.`);
    if (actionMovesPower(s.action) && !(Number(s.powerKw) > 0)) {
      errs.push(`${n}: ${s.action} needs a power above 0 kW.`);
    }
    const bad = (v: number) => !Number.isFinite(v) || v < SOC_FLOOR || v > SOC_CEILING;
    if (bad(s.socMin) || bad(s.socMax))  errs.push(`${n}: SOC limits must be between ${SOC_FLOOR} and ${SOC_CEILING}%.`);
    else if (s.socMin >= s.socMax)       errs.push(`${n}: SOC lower limit must be below the upper limit.`);
  });
  const timed = t.slots
    .map((s, i) => ({ i, a: toMin(s.start), b: endMin(s.end) }))
    .filter(s => !Number.isNaN(s.a) && !Number.isNaN(s.b) && s.b > s.a)
    .sort((x, y) => x.a - y.a);
  for (let k = 1; k < timed.length; k++) {
    if (timed[k].a < timed[k - 1].b) errs.push(`Rows ${timed[k - 1].i + 1} and ${timed[k].i + 1} overlap.`);
    /* A gap is a stretch the template says nothing about, and the cabinet has
       to do something during it. Slots run back to back: 01:00-02:00 then
       02:00-03:00, never 01:00-02:00 then 03:00-04:00. */
    else if (timed[k].a > timed[k - 1].b) {
      errs.push(`Gap between ${fromMin(timed[k - 1].b)} and ${fromMin(timed[k].a)} — rows must run back to back.`);
    }
  }
  return errs;
}

/** Minutes past midnight as "HH:MM", with 24:00 for the end of the day. */
function fromMin(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** The parts of the day no slot covers — shown as a note, not an error. */
export function uncoveredHours(slots: PolicySlot[]): string[] {
  const timed = slots
    .map(s => ({ a: toMin(s.start), b: endMin(s.end) }))
    .filter(s => !Number.isNaN(s.a) && !Number.isNaN(s.b) && s.b > s.a)
    .sort((x, y) => x.a - y.a);
  if (!timed.length) return [];
  const out: string[] = [];
  if (timed[0].a > 0) out.push(`00:00-${fromMin(timed[0].a)}`);
  const last = timed[timed.length - 1].b;
  if (last < 24 * 60) out.push(`${fromMin(last)}-24:00`);
  return out;
}

// ── Policy schedule — which template runs on which days ──────────────────────
//
// A period is a day-and-month range that repeats every year, e.g. 20 Jan →
// 15 Feb, mapped to one template. Both ends are inclusive and a range may wrap
// past New Year (15 Dec → 15 Jan). Periods at a station may not overlap, so
// every day of the year resolves to at most one template.

export interface PolicyPeriod {
  id: string;
  from: string;        // "MM-DD", inclusive
  to: string;          // "MM-DD", inclusive; earlier than from = wraps into January
  templateId: string;
  updatedAt: number;
}

export type PolicyPeriodInput = Pick<PolicyPeriod, "from" | "to" | "templateId">;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** Days per month on the leap calendar, so 29 Feb can be scheduled too. */
export const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const YEAR_DAYS = 366;

/** 0-based position of "MM-DD" in a leap year. */
function dayIndex(md: string): number {
  const [m, d] = md.split("-").map(Number);
  let n = d - 1;
  for (let k = 0; k < m - 1; k++) n += MONTH_DAYS[k];
  return n;
}

export function isValidMonthDay(md: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return false;
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= MONTH_DAYS[mo - 1];
}

export function formatMonthDay(md: string): string {
  const [m, d] = md.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Inclusive day count of a period, counting 29 Feb when it falls inside. */
export function periodDays(from: string, to: string): number {
  const a = dayIndex(from), b = dayIndex(to);
  return (b >= a ? b - a : b + YEAR_DAYS - a) + 1;
}

/** Whether a period covers the given "MM-DD". */
export function periodCovers(p: Pick<PolicyPeriod, "from" | "to">, md: string): boolean {
  const a = dayIndex(p.from), b = dayIndex(p.to), x = dayIndex(md);
  return a <= b ? a <= x && x <= b : x >= a || x <= b;
}

/** Days of the (leap) year that no period covers. */
export function uncoveredDays(periods: Pick<PolicyPeriod, "from" | "to">[]): number {
  const covered = new Set<number>();
  for (const p of periods) {
    const a = dayIndex(p.from);
    for (let k = 0; k < periodDays(p.from, p.to); k++) covered.add((a + k) % YEAR_DAYS);
  }
  return YEAR_DAYS - covered.size;
}

const periodKey = (stationId: string) => `ems.policyPeriods.${stationId}`;

function readPeriods(stationId: string): PolicyPeriod[] {
  try {
    const raw = localStorage.getItem(periodKey(stationId));
    if (!raw) return [];
    // Periods saved while ranges carried a year ("YYYY-MM-DD") keep their day and month.
    return (JSON.parse(raw) as PolicyPeriod[]).map(p => ({
      ...p,
      from: p.from.length === 10 ? p.from.slice(5) : p.from,
      to:   p.to.length   === 10 ? p.to.slice(5)   : p.to,
    }));
  } catch {
    return [];
  }
}

function writePeriods(stationId: string, list: PolicyPeriod[]): void {
  try {
    localStorage.setItem(periodKey(stationId), JSON.stringify(list));
  } catch {
    throw new Error("This browser would not save the schedule (storage blocked or full).");
  }
}

export async function fetchPolicyPeriods(stationId: string): Promise<PolicyPeriod[]> {
  return readPeriods(stationId).sort((a, b) => dayIndex(a.from) - dayIndex(b.from));
}

export async function savePolicyPeriod(stationId: string, input: PolicyPeriodInput, id?: string): Promise<PolicyPeriod> {
  const list = readPeriods(stationId);
  const errs = validatePolicyPeriod(input, list, id);
  if (errs.length) throw new Error(errs.join(" "));
  const saved: PolicyPeriod = { id: id ?? crypto.randomUUID(), ...input, updatedAt: Date.now() };
  writePeriods(stationId, id ? list.map(p => (p.id === id ? saved : p)) : [...list, saved]);
  return saved;
}

export async function deletePolicyPeriod(stationId: string, id: string): Promise<void> {
  writePeriods(stationId, readPeriods(stationId).filter(p => p.id !== id));
}

export function validatePolicyPeriod(p: PolicyPeriodInput, existing: PolicyPeriod[], selfId?: string): string[] {
  const errs: string[] = [];
  if (!isValidMonthDay(p.from) || !isValidMonthDay(p.to)) errs.push("Choose a start and end date.");
  if (!p.templateId) errs.push("Choose a template.");
  if (errs.length) return errs;
  // Two ranges on the yearly circle overlap when either one contains the other's start.
  const clash = existing.find(e => e.id !== selfId && (periodCovers(e, p.from) || periodCovers(p, e.from)));
  if (clash) errs.push(`These dates overlap ${formatMonthDay(clash.from)} → ${formatMonthDay(clash.to)}.`);
  return errs;
}
