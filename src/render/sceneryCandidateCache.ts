// Exact coordinate keys: quantizing candidates would change seeded placement.
// A cache belongs to one layer and one static landscape. Live blockers and
// previously accepted decor must always be checked again on every replay.
export const memoizeCandidate = <T>(
  evaluate: (x: number, y: number) => T,
  limit = 16384,
): ((x: number, y: number) => T) => {
  type Entry = { y: number; value: T; next?: Entry };
  const rows = new Map<number, Entry>();
  let size = 0;
  return (x, y) => {
    let row = rows.get(x);
    for (let entry = row; entry; entry = entry.next) {
      if (entry.y === y) return entry.value;
    }
    const value = evaluate(x, y);
    // Bound retained work even after many removals diverge the RNG frontier.
    // Eviction affects cost only; evaluation remains pure and exact.
    if (size >= limit) {
      rows.clear();
      size = 0;
      row = undefined;
    }
    // Most floating-point x coordinates are unique. A short collision chain
    // avoids allocating a second Map for every candidate while retaining y.
    rows.set(x, { y, value, next: row });
    size++;
    return value;
  };
};
