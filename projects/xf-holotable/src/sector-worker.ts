// Bun worker: independent archive indexes/Oodle calls make sector decode safe to run concurrently.
import { NativeArchivePool } from "../../xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../xf-studio/authoring/src/native/oodle";
import { depotHash } from "../../xf-studio/authoring/src/game/depot-path";
import { readStreamingSectorCollisions, readStreamingSectorContent } from "../../xf-studio/authoring/src/native/streaming-sector";
import { NativeBudgetError } from "../../xf-studio/authoring/src/native/native-errors";
import { actorPose } from "./solids.ts";
import { COLLIDER_STRIDE, encodeSector } from "./sector-data.ts";
import { compactContentSector, encodeContentSector } from "./world-content-data.ts";

let oodle: ReturnType<typeof loadGameOodle> | undefined, pool: NativeArchivePool | undefined, root: string | undefined;
self.onmessage = event => {
  const m = event.data;
  if (m.close) { pool?.close(); oodle?.close(); self.postMessage({ closed: true }); self.close(); return; }
  try {
    if (root && root !== m.root) { pool?.close(); oodle?.close(); pool = undefined; oodle = undefined; }
    root = m.root;
    oodle ??= loadGameOodle(m.root); pool ??= new NativeArchivePool(oodle.decompress, 4);
    const bytes = pool.read(m.archive, depotHash(m.resource)); if (!bytes) throw Error(`Missing sector ${m.resource}.`);
    if (m.mode === "content") {
      const data = encodeContentSector(compactContentSector(readStreamingSectorContent(bytes, oodle.decompress)));
      self.postMessage({ data }, [data.buffer as ArrayBuffer]); return;
    }
    const s = readStreamingSectorCollisions(bytes, oodle.decompress);
    const count = s.collisions.reduce((n, c) => n + c.actors.reduce((n, a) => n + a.shapes.length, 0), 0);
    if (count * COLLIDER_STRIDE * 8 > 60 * 1024 * 1024) throw new NativeBudgetError("Prepared sector geometry exceeds 60 MiB.");
    const rows = new Float64Array(count * COLLIDER_STRIDE), hashes: string[] = [], hashIndexes = new Map<string, number>(); let at = 0;
    for (const node of s.collisions) for (let ai = 0; ai < node.actors.length; ai++) {
      const actor = node.actors[ai], transform = actorPose(actor);
      for (let si = 0; si < actor.shapes.length; si++) {
        const shape = actor.shapes[si], center = transform.center(shape.position), axes = transform.axes(shape.rotation);
        const kind = ["Box", "Sphere", "Capsule", "ConvexMesh", "TriangleMesh"].indexOf(shape.type); let hashIndex = -1;
        if (shape.hash !== undefined) { const hash = `${node.sectorHash}:${shape.hash}`; hashIndex = hashIndexes.get(hash) ?? -1;
          if (hashIndex < 0) { hashIndex = hashes.length; hashes.push(hash); hashIndexes.set(hash, hashIndex); } }
        rows.set([node.nodeIndex, ai, actor.shapes.length, si, kind, ...center, ...axes[0], ...axes[1], ...axes[2], ...(shape.size ?? [0, 0, 0]), hashIndex], at); at += COLLIDER_STRIDE;
      }
    }
    // Compact prepared geometry is independent of the recording, with no materials or native buffer objects retained.
    const data = encodeSector({ placements: Uint16Array.from(s.placements, p => p.nodeIndex), variantIndices: s.variantIndices,
      persistentNodeIndex: s.persistentNodeIndex, rows, hashes });
    self.postMessage({ data }, [data.buffer]);
  } catch (e) { const error = e as Error; self.postMessage({ error: { name: error.name, message: error.message } }); }
};
