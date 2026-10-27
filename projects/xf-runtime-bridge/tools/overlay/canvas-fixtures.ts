// Language-neutral vectors. Expectations come from ECMAScript, independently of the native implementation.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
if (import.meta.main) {
  const batch = { schema: "canvas@1", producer: "fixture", layer: "actors", world: 7, seq: 1, views: ["world", "radar"], items: [
    { id: "centre", kind: "point", anchor: { world: [0, 10, 0] } },
    { id: "right", kind: "point", anchor: { world: [1, 10, 0] } },
    { id: "up", kind: "point", anchor: { world: [0, 10, 1] } },
    { id: "behind", kind: "point", anchor: { world: [0, -10, 0] } },
  ] };
  const bits = ["0000000000000000", "8000000000000000", "0000000000000001", "8000000000000001", "7fefffffffffffff", "ffefffffffffffff", "4340000000000000", "c340000000000000", "4430000000000000", "44b52d02c7e14af5", "44b52d02c7e14af6", "44b52d02c7e14af7", "444b1ae4d6e2ef4e", "444b1ae4d6e2ef4f", "444b1ae4d6e2ef50", "3eb0c6f7a0b5ed8c", "3eb0c6f7a0b5ed8d", "41b3de4355555553", "41b3de4355555554", "41b3de4355555555", "41b3de4355555556", "41b3de4355555557", "becbf647612f3696", "43143ff3c1cb0959"];
  const values: unknown[] = [batch, { z: -0, a: [1e-7, 1e-6, 1e20, 1e21, 333333333.33333329], s: "€\u000f\nA'B\"\\/" }, { "\u20ac": 1, "\r": 2, "😀": 3, "\ufb33": 4, "1": 5, "ö": 6 }];
  for (const hex of bits) { const data = new DataView(new ArrayBuffer(8)); data.setBigUint64(0, BigInt(`0x${hex}`)); values.push(data.getFloat64(0)); }
  const fixture = { schema: "canvas-fixtures@1", camera: { position: [0,0,0], forward: [0,1,0], right: [1,0,0], up: [0,0,1], player: [0,0,0], yaw: 0, fov: 90, width: 800, height: 600 },
    cases: [{ name: "projection", batch, projected: [[400,300],[430,300],[400,270],null] },
      { name: "unknown field", batch: { ...batch, extra: true }, refusal: { code: "bad_batch", path: "$.extra" } },
      { name: "bad anchor", batch: { ...batch, items: [{ id: "p", kind: "point", anchor: { world: [0,0,0], entity: "1" } }] }, refusal: { code: "bad_batch", path: "$.items[0].anchor" } },
      { name: "optional heat absent", batch: { ...batch, items: [{ id: "h", kind: "heat", anchor: { world: [0,0,0] } }] }, refusal: { code: "unsupported_kind", path: "$.items[0].kind" } }],
    digests: values.map(value => ({ value, canonical: canonical(value), sha256: digest(value) })) };
  const folder = resolve(import.meta.dir, "../../fixtures/canvas"); mkdirSync(folder, { recursive: true }); writeFileSync(resolve(folder, "conformance.json"), JSON.stringify(fixture, null, 2) + "\n");
}
