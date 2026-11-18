/**
 * Props comparison for React.memo on chart cards.
 *
 * The dashboard re-renders on every poll result (a dozen per 30 s wave), and
 * it hands its cards fresh-but-identical props each time: `cabinets` is a new
 * array, `domain={[0, 100]}` and `specs={[…]}` are literals. Shallow equality
 * sees all of those as changed, so every card redrew every chart on every poll.
 * This compares by value instead.
 *
 * Functions compare by source: the cards' callbacks (`tagOf`) are inline
 * arrows that capture nothing from render, so the same text is the same
 * function. A callback that does capture render state must not be passed to a
 * card memoised with this.
 */

function same(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "function" && typeof b === "function") return a.toString() === b.toString();
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i], depth - 1));
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1));
}

/** Equal when every prop is equal by value, down to three levels. */
export function sameProps<P extends object>(prev: Readonly<P>, next: Readonly<P>): boolean {
  return same(prev, next, 4);
}
