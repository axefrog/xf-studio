import { expect, test } from "bun:test";
import { join } from "node:path";
import { createSolidWorkerPort } from "../src/solid-worker-port.ts";

test("the geometry worker returns promptly without an installation, and closes its requests", async () => {
  const source = createSolidWorkerPort(join(import.meta.dir, "unwritten-cache"), { gameRoot: "" });
  try {
    const signal = new AbortController().signal;
    expect(await source.status!([[0, 0, 0]], signal)).toEqual({ cold: false });
    expect((await source.around([[0, 0, 0]], 250, signal)).solidInfo.available).toBe(false);
    const ctl = new AbortController(); ctl.abort();
    await expect(source.around([[0, 0, 0]], 250, ctl.signal)).rejects.toThrow();
  } finally {
    source.close();
  }
});
