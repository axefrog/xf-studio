import { expect, test } from "bun:test";
import { hostClock } from "../src/platform/core/clock";
import { hostRandom, seededRandom } from "../src/platform/core/random";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the host clock's timers and frames end with their signal", async () => {
  const clock = hostClock();
  let ran = 0;
  const stop = new AbortController();
  clock.after(1, () => ran++);
  clock.after(1, () => ran += 10, stop.signal);
  clock.frame(() => ran += 100, stop.signal);
  stop.abort();
  await new Promise(resolve => clock.after(40, () => resolve(null)));
  expect(ran).toBe(1);
  let framed = 0;
  await new Promise(resolve => clock.frame(time => { framed = time; resolve(null); }));
  expect(framed).toBeGreaterThan(0);
  expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
});

test("the host's random IDs are unique version-4 UUIDs, and numbers lie in [0, 1)", () => {
  const ids = new Set([hostRandom(), hostRandom()].flatMap(random => Array.from({ length: 50 }, () => random.uuid())));
  expect(ids.size).toBe(100);
  expect([...ids].every(id => UUID.test(id))).toBe(true);
  const random = hostRandom();
  expect(Array.from({ length: 200 }, () => random.next()).every(value => value >= 0 && value < 1)).toBe(true);
});

test("a seeded source repeats its sequence for the same seed, and differs for another", () => {
  const sequence = (seed: string | number) => { const random = seededRandom(seed); return [random.uuid(), random.next(), random.uuid()]; };
  expect(sequence("ids")).toEqual(sequence("ids"));
  expect(sequence(1)).toEqual(sequence("1"));
  expect(sequence("ids")).not.toEqual(sequence("idt"));
  const random = seededRandom(7), ids = Array.from({ length: 500 }, () => random.uuid());
  expect(new Set(ids).size).toBe(500); expect(ids.every(id => UUID.test(id))).toBe(true);
  const values = Array.from({ length: 2000 }, () => random.next());
  expect(values.every(value => value >= 0 && value < 1)).toBe(true);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(Math.abs(mean - .5)).toBeLessThan(.05);
});
