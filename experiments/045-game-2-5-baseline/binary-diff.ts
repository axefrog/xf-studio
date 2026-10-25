// Compare native-decoded stored properties and decompressed buffers of changed members.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { readResourceModel, readResourceJson } from "../../projects/xf-studio/authoring/src/native/resource-document";
import { RedBuffer, RedHandle, RedObject } from "../../projects/xf-studio/authoring/src/native/red-model";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";

const [game, run, mode] = process.argv.slice(2);
if (!game || !run) throw Error("Usage: bun binary-diff.ts PATH_TO_GAME ROUNDTRIP_OUTPUT");
const oodle = loadGameOodle(game);
const writer = mode === "--writer";
const metadata = writer ? (() => {
  const root = join(run, "writer-build");
  const path = readdirSync(root, { recursive: true }).map(String).find(p => p.replaceAll("\\", "/").endsWith("features/eye-makeup/build.json"))!;
  const members = JSON.parse(readFileSync(join(root, path), "utf8")).artifacts;
  return { wk9Members: members, wk10Members: members.map((p: { path: string }) => ({ ...p, sha256: "compare" })) };
})() : JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
const report: Record<string, unknown> = {};
try {
  for (const left of metadata.wk9Members) {
    const right = metadata.wk10Members.find((p: { path: string }) => p.path === left.path);
    if (left.sha256 === right.sha256) continue;
    const pair = ["wk9", "wk10"].map(tool => {
      const file = writer ? (tool === "wk9" ? join(run, "writer-oracle/game-baseline/wolvenkit", left.path)
        : join(run, "native-output", basename(left.path))) : join(run, tool, "archive", left.path);
      const bytes = new Uint8Array(readFileSync(file));
      const model = readResourceModel(bytes, oodle.decompress);
      const buffers: { path: string; bytes: number; sha256: string }[] = [];
      const seen = new Set<object>();
      const walk = (value: unknown, path: string): unknown => {
        if (!value || typeof value !== "object") return value;
        if (seen.has(value)) return "<shared>";
        seen.add(value);
        if (value instanceof RedBuffer) {
          const raw = value.bytes();
          buffers.push({ path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") });
          return { flags: value.flags, content: value.parsed ? walk(value.parsed, path + ".parsed") : "<raw buffer>" };
        }
        if (value instanceof RedHandle) return walk(value.target, path + ".target");
        if (value instanceof RedObject) return { type: value.type, fields: walk(value.fields, path + ".fields") };
        if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, path + "." + k)]));
      };
      const stored = walk(model.root, "root");
      return { version: model.version, buildVersion: model.buildVersion, stored, buffers,
        document: readResourceJson(bytes, oodle.decompress) };
    });
    report[left.path] = { storedEqual: JSON.stringify(pair[0]!.stored) === JSON.stringify(pair[1]!.stored),
      buffersEqual: JSON.stringify(pair[0]!.buffers) === JSON.stringify(pair[1]!.buffers),
      [writer ? "reference" : "wk9"]: pair[0], [writer ? "native" : "wk10"]: pair[1] };
  }
  writeFileSync(join(run, writer ? "writer-binary-analysis.json" : "binary-analysis.json"), JSON.stringify(report, null, 2) + "\n");
  for (const [path, info] of Object.entries(report)) {
    const value = info as { storedEqual: boolean; buffersEqual: boolean };
    console.log(JSON.stringify({ path, storedEqual: value.storedEqual, buffersEqual: value.buffersEqual }));
  }
} finally { oodle.close(); }
