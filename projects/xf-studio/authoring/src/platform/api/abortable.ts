/**
 * Wait for `promise`, or stop waiting as soon as `signal` aborts (rejecting with its reason). The work behind the promise isn't stopped by
 * this (it ends on its own, and whatever it settles with afterwards is ignored); only the waiter is let go, so whoever waits can release
 * what it holds at once.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) { promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}
