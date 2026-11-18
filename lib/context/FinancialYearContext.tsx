"use client";

/**
 * FinancialYearContext
 *
 * India Financial Year: April 1 (year) → March 31 (year + 1)
 * "FY 2025-26" = April 1, 2025 → March 31, 2026
 *
 * Provides:
 *   useFY()            — selectedFY, fyList, setFY
 *   buildFY(year)      — construct a FinancialYear object
 *   fyStartYear(date)  — which FY does this date belong to?
 *   fyMonths(fy)       — ordered list of 12 month labels (Apr … Mar) with short year
 */

import { createContext, useContext, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinancialYear {
  /** Display label, e.g. "FY 2026-27" */
  label: string;
  /** Short label, e.g. "26-27" */
  shortLabel: string;
  /** April 1, startYear — 00:00:00.000 */
  start: Date;
  /** March 31, startYear+1 — 23:59:59.999 */
  end: Date;
  /** The calendar year in which the FY begins, e.g. 2026 */
  startYear: number;
}

// ── Utilities (exported for use anywhere) ─────────────────────────────────────

/**
 * Returns the FY start year for a given date.
 * April 1 or later → same calendar year.
 * January – March → previous calendar year.
 */
export function fyStartYear(date: Date): number {
  // Month index: 0 = Jan … 3 = Apr … 11 = Dec
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** Construct a FinancialYear object for the given start year. */
export function buildFY(startYear: number): FinancialYear {
  const endYear = startYear + 1;
  return {
    label:      `FY ${startYear}-${String(endYear).slice(2)}`,
    shortLabel: `${String(startYear).slice(2)}-${String(endYear).slice(2)}`,
    startYear,
    start: new Date(startYear, 3,  1,  0,  0,  0,   0),   // Apr 1 00:00:00
    end:   new Date(endYear,   2, 31, 23, 59, 59, 999),    // Mar 31 23:59:59
  };
}

/**
 * Generate a list of FYs from firstYear up to the current FY, newest first.
 * Default first year = 2022 (covers all UnityESS deployments so far).
 */
export function buildFYList(firstYear = 2022): FinancialYear[] {
  const current = fyStartYear(new Date());
  const list: FinancialYear[] = [];
  for (let y = current; y >= firstYear; y--) {
    list.push(buildFY(y));
  }
  return list;
}

/**
 * Returns an ordered array of 12 month descriptors for the given FY.
 * Each entry has: { monthIndex (0-based JS month), year, label e.g. "Apr '26" }
 */
export function fyMonths(fy: FinancialYear): Array<{
  monthIndex: number;
  year: number;
  label: string;          // "Apr '26"
  shortLabel: string;     // "Apr"
}> {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const result = [];
  // April (month 3) → December (month 11) of startYear, then Jan–Mar of endYear
  for (let m = 3; m <= 11; m++) {
    result.push({
      monthIndex: m,
      year: fy.startYear,
      label: `${MONTH_NAMES[m]} '${String(fy.startYear).slice(2)}`,
      shortLabel: MONTH_NAMES[m],
    });
  }
  for (let m = 0; m <= 2; m++) {
    const endYear = fy.startYear + 1;
    result.push({
      monthIndex: m,
      year: endYear,
      label: `${MONTH_NAMES[m]} '${String(endYear).slice(2)}`,
      shortLabel: MONTH_NAMES[m],
    });
  }
  return result;
}

// ── Context ───────────────────────────────────────────────────────────────────

const CURRENT_FY  = buildFY(fyStartYear(new Date()));
const ALL_FYS     = buildFYList(2022);

type FYCtx = {
  selectedFY: FinancialYear;
  fyList:     FinancialYear[];
  setFY:      (fy: FinancialYear) => void;
  isCurrent:  boolean;   // true when the selected FY is the running FY
};

const FinancialYearContext = createContext<FYCtx>({
  selectedFY: CURRENT_FY,
  fyList:     ALL_FYS,
  setFY:      () => {},
  isCurrent:  true,
});

export function FinancialYearProvider({ children }: { children: React.ReactNode }) {
  const [selectedFY, setFYState] = useState<FinancialYear>(CURRENT_FY);

  const isCurrent = selectedFY.startYear === CURRENT_FY.startYear;

  return (
    <FinancialYearContext.Provider value={{ selectedFY, fyList: ALL_FYS, setFY: setFYState, isCurrent }}>
      {children}
    </FinancialYearContext.Provider>
  );
}

/** Consume the financial year context anywhere inside EmsLayout. */
export function useFY() {
  return useContext(FinancialYearContext);
}
