import type { AntiBackflowEntry } from "../types";

export async function fetchAntiBackflow(
  _stationId: string,
  _date: string,
  _meterId?: string
): Promise<AntiBackflowEntry[]> {
  // No UGX anti-backflow endpoint exists yet — return empty so the UI renders
  // blank rather than fabricated data. Wire the real endpoint here when it ships.
  return [];
}
