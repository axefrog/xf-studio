/**
 * Calling listeners, each isolated from the others: one that throws doesn't stop the rest hearing, and the first error is thrown once all
 * of them have run. Owners notify only once their state has settled, so a listener that throws can never leave that state half changed.
 */
export function notifyAll<A extends unknown[]>(listeners: Iterable<(...args: A) => void>, ...args: A): void {
  let failure: { error: unknown } | undefined;
  for (const listener of [...listeners]) {
    try { listener(...args); } catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
}
