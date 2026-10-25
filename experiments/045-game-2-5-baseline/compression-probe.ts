// Identify reference buffer compression without changing the writer or its oracle.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Cr2wFile } from "../../projects/xf-studio/authoring/src/native/cr2w-file";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { karkSegment } from "../../projects/xf-studio/authoring/src/native/write/segments";

const [game, oracle, output] = process.argv.slice(2);
if (!game || !oracle || !output) throw Error("Usage: bun compression-probe.ts PATH_TO_GAME ORACLE_OUTPUT REPORT_JSON");
const oodle = loadGameOodle(game);
const rows: unknown[] = [];
try {
  const root = join(oracle, "game-baseline/wolvenkit");
  for (const name of readdirSync(root, { recursive: true }).map(String).filter(p => /\.(mesh|morphtarget|xbm)$/.test(p))) {
    const file = new Cr2wFile(new Uint8Array(readFileSync(join(root, name))));
    for (let index = 0; index < file.buffers.length; index++) {
      const buffer = file.buffers[index]!;
      const stored = file.bytes.subarray(buffer.offset, buffer.offset + buffer.diskSize);
      const raw = file.bufferBytes(index, oodle.decompress);
      const matches = [4, 6].filter(level => Buffer.from(karkSegment(raw, level, oodle.compress!)).equals(Buffer.from(stored)));
      rows.push({ path: relative(root, join(root, name)).replaceAll("\\", "/"), index,
        storedBytes: buffer.diskSize, rawBytes: buffer.memSize, matchingLevels: matches });
    }
  }
  writeFileSync(output, JSON.stringify(rows, null, 2) + "\n");
  console.log(JSON.stringify({ buffers: rows.length, matchingNormal: rows.filter((r: any) => r.matchingLevels.includes(4)).length,
    matchingOptimal2: rows.filter((r: any) => r.matchingLevels.includes(6)).length }));
} finally { oodle.close(); }
