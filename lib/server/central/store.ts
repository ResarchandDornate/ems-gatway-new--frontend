/**
 * The server's own copy of what the central backend would otherwise drop.
 *
 * The backend answers only its newest rows on most endpoints — about 2.8
 * days of energy counters, 8 hours of the SOC controller, 3 of the inverter —
 * so anything older is gone unless somebody kept it. The collector keeps it,
 * here: one append-only JSON-lines file per stream per IST day,
 *
 *   <root>/<gatewayId>/<stream>/<YYYY-MM-DD>.jsonl
 *
 * Plain files on purpose: no native module to build in the Alpine image, a
 * day is a file you can open, and losing one costs that day only. The root
 * is CENTRAL_STORE_DIR, else /data/central (the image's volume), else
 * ./.data/central for a developer checkout.
 */

import { mkdirSync, existsSync, accessSync, constants } from "node:fs";
import { appendFile, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";

function pickRoot(): string {
  if (process.env.CENTRAL_STORE_DIR) return process.env.CENTRAL_STORE_DIR;
  try { if (existsSync("/data")) { accessSync("/data", constants.W_OK); return "/data/central"; } } catch { /* not writable */ }
  return path.join(process.cwd(), ".data", "central");
}
export const STORE_ROOT = pickRoot();

const IST_MS = 330 * 60_000;
export const istDay = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

const dirOf = (gw: string, stream: string) => path.join(STORE_ROOT, gw.replace(/[^\w-]/g, ""), stream.replace(/[^\w-]/g, ""));

/** One stored row: when it was sampled, a dedupe key, and the record. */
export interface StoredRow { ts: number; k: string; r: unknown }

export async function appendRows(gw: string, stream: string, rows: StoredRow[]): Promise<void> {
  if (!rows.length) return;
  const byDay = new Map<string, string[]>();
  for (const row of rows) {
    const d = istDay(row.ts);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(JSON.stringify(row));
  }
  const dir = dirOf(gw, stream);
  mkdirSync(dir, { recursive: true });
  for (const [d, lines] of byDay) await appendFile(path.join(dir, `${d}.jsonl`), lines.join("\n") + "\n");
}

/** Rows of a stream whose sample time is in [from, to), oldest first. */
export async function readRange(gw: string, stream: string, from: number, to: number, max = 50_000): Promise<StoredRow[]> {
  const dir = dirOf(gw, stream);
  const files = await readdir(dir).catch(() => [] as string[]);
  const first = istDay(from), last = istDay(Math.max(from, to - 1));
  const out: StoredRow[] = [];
  for (const f of files.filter((f) => f.endsWith(".jsonl")).sort()) {
    const d = f.slice(0, 10);
    if (d < first || d > last) continue;
    const text = await readFile(path.join(dir, f), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as StoredRow;
        if (row.ts >= from && row.ts < to) out.push(row);
      } catch { /* a torn last line from a crash: skip it */ }
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Dedupe keys already stored for the last `days` days, to skip re-appending. */
export async function recentKeys(gw: string, stream: string, days = 2): Promise<Set<string>> {
  const now = Date.now();
  const rows = await readRange(gw, stream, now - days * 86_400_000, now + 60_000, 1_000_000);
  return new Set(rows.map((r) => r.k));
}

/* ── Small JSON documents (acknowledgements) ──────────────────────────────── */

export async function readJson<T>(gw: string, name: string, fallback: T): Promise<T> {
  const file = path.join(STORE_ROOT, gw.replace(/[^\w-]/g, ""), `${name}.json`);
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

/** Written to a temp file and renamed, so a crash never leaves half a document. */
export async function writeJson(gw: string, name: string, value: unknown): Promise<void> {
  const dir = path.join(STORE_ROOT, gw.replace(/[^\w-]/g, ""));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(value));
  await rename(`${file}.tmp`, file);
}
