import { expect } from "bun:test";

/** A capture may reject a write or expose a detached copy; neither may change its validation or named destination. */
export function expectCaptureStable(readValidation: () => unknown, ...mutations: (() => void)[]) {
  const before = structuredClone(readValidation());
  for (const mutate of mutations) {
    try { mutate(); } catch (error) { if (!(error instanceof TypeError)) throw error; }
    expect(readValidation()).toEqual(before);
  }
}
