import { expect, test } from "bun:test";
import { MAX_PIXEL_RATIO, viewportPixelRatio, watchDevicePixelRatio } from "../src/device-pixel-ratio";

/** A display whose ratio can change; each media query matches only the ratio it was made for. */
function display(initial: number) {
  const queries: { query: string; listeners: Set<() => void> }[] = [];
  const environment = {
    devicePixelRatio: initial,
    matchMedia(query: string) {
      const entry = { query, listeners: new Set<() => void>() };
      queries.push(entry);
      return {
        addEventListener: (_type: string, listener: () => void) => { entry.listeners.add(listener); },
        removeEventListener: (_type: string, listener: () => void) => { entry.listeners.delete(listener); },
      } as unknown as MediaQueryList;
    },
  };
  return { environment, queries,
    live: () => queries.filter(entry => entry.listeners.size).map(entry => entry.query),
    change(next: number) {
      const armed = queries.filter(entry => entry.listeners.size && entry.query !== `(resolution: ${next}dppx)`);
      environment.devicePixelRatio = next;
      for (const entry of armed) for (const listener of [...entry.listeners]) listener();
    } };
}

test("the viewport ratio is the device's, capped at 2, and 1 when the device reports none", () => {
  expect(viewportPixelRatio(1.25)).toBe(1.25);
  expect(viewportPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
  expect(viewportPixelRatio(0)).toBe(1);
});

test("a monitor move or page zoom reports the new capped ratio and re-arms for the next change; stop releases it (UI-46)", () => {
  const screen = display(1);
  const seen: number[] = [];
  const stop = watchDevicePixelRatio(screen.environment, ratio => seen.push(ratio));
  expect(screen.live()).toEqual(["(resolution: 1dppx)"]);
  screen.change(1.5);
  expect(seen).toEqual([1.5]);
  expect(screen.live()).toEqual(["(resolution: 1.5dppx)"]);
  screen.change(3);
  expect(seen).toEqual([1.5, 2]);
  expect(screen.live()).toEqual(["(resolution: 3dppx)"]);
  stop();
  expect(screen.live()).toEqual([]);
  screen.change(1);
  expect(seen).toEqual([1.5, 2]);
});

test("the scene applies the capped ratio at start and watches for changes, releasing the watch with the scene", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "platform", "scene", "scene-host.ts"), "utf8") as string;
  expect(source).toContain("renderer.setPixelRatio(viewportPixelRatio(devicePixelRatio))");
  expect(source).toContain("releases.push(watchDevicePixelRatio(window, pixelRatio => { renderer.setPixelRatio(pixelRatio); resize(); invalidate(); }))");
});
