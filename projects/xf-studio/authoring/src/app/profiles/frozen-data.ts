/** Own a deep copy of plain application data, immutable through every nested reference. Handles/functions stay outside it. */
export function frozenData<T>(value: T): T {
  const copy = structuredClone(value), seen = new WeakSet<object>();
  const freeze = (item: unknown) => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
