/**
 * The direct-read ratchet (profiles and graph design §5.1, boundary rule 3): every source of non-determinism enters as
 * a source node, so only adapter modules read the wall clock, timers, randomness, the file system, processes and
 * workers, the network, the host environment, browser storage or the game bridge directly. Today's code reads them in many places; each is listed below
 * with what it reads and how many times, and the list may only shrink: a new read (or one more of a kind already
 * listed) fails, and a read that is gone fails until its row is lowered or removed (each slice empties the rows it
 * touches, §5.3). New graph code is held to the rule from its first line. Regenerate the rows with
 * `bun tests/fixtures/direct-reads.ts` only when lowering or removing them.
 */
import { expect, test } from "bun:test";
import { directReads, kindsIn, readsIn } from "./fixtures/direct-reads";

/**
 * Grandfathered direct reads (module: kind: how many), recorded when the graph engine landed (G1), extended once at its
 * merge for modules written in parallel before the rule existed (the speed and beta-polish tracks), and counted per
 * kind when the patterns were widened (deep review 6, CORE-132): reads the narrower patterns missed in modules that
 * already existed were added then, once, each marked "previously undetected"; the second speed track's adapters were
 * added at its merge, each marked "speed 2". The patterns were widened again in deep review 7 (CORE-146: the host
 * environment, workers, and a served network), and the reads they newly see in existing modules were added once the same
 * way, each marked "previously undetected (review 7)". This list only shrinks: a count may only fall (and its row must
 * then be lowered), never rise, and no module or kind may be added.
 */
const GRANDFATHERED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "archive-inventory-fs": { files: 1 },
  "authoring-eye-makeup": { random: 1 },
  "brow-study-fixture": { network: 2 },
  "browser-cc-catalogue-device": { timers: 1, network: 1 },
  "browser-character-detail-device": { timers: 4, random: 1, network: 1 },
  "browser-choice-preview-device": { network: 1, processes: 1 }, // previously undetected (review 7): processes
  "browser-facial-device": { clock: 1, random: 2, network: 1 }, // previously undetected: clock, random
  "browser-file-device": { timers: 1, processes: 1 }, // previously undetected (review 7): processes
  "browser-grading-lut-device": { timers: 1, network: 1 },
  "browser-head-attachment": { timers: 1 },
  "browser-host-request": { network: 1 }, // moved from browser-desktop-app-device (UPD-03): the one fetch the page's host devices share
  "browser-install-detection-device": { network: 1 },
  "browser-local-setup-device": { network: 2 },
  "browser-mod-install-device": { network: 1 },
  "browser-pose-device": { network: 4 },
  "browser-save-explorer-device": { network: 1 },
  "cc-catalogue-host": { files: 2, environment: 1 }, // previously undetected (review 7): environment
  "cc-catalogue-service": { clock: 3, timers: 1 },
  "cc-icon-host": { clock: 2, files: 1 },
  "cc-swatch-host": { clock: 8, timers: 1, files: 1 },
  "character-context-actions": { clock: 3, timers: 1 },
  "character-detail-host": { clock: 23, timers: 3, files: 1, environment: 1 }, // speed 2 (warm restart), merged with the widened patterns; previously undetected (review 7): environment
  "character-detail-loader": { timers: 1 },
  "character-warm-start": { network: 1 }, // speed 2 adapter, written before the rule reached its branch
  "character-detail-server": { files: 1 }, // previously undetected: files
  "character-detail-service": { clock: 6, files: 2 },
  "choice-manifest": { files: 1 },
  "choice-prefetch": { clock: 1, timers: 1 },
  "choice-preview-host": { files: 1 },
  "choice-preview-render": { clock: 1 },
  "choice-preview-server": { files: 1 }, // previously undetected: files
  "choice-preview-service": { clock: 1, timers: 2 },
  "choice-preview-worker": { clock: 3, network: 1 },
  "clothing-host": { clock: 2, files: 1 },
  "collection-service": { clock: 1, random: 4 },
  "collection-session": { random: 1 },
  "collection-store": { clock: 2, random: 1, files: 1 }, // previously undetected: files
  "collection-transport": { network: 1 },
  "dangle-host": { files: 1 },
  "derived-cache": { random: 3, files: 1 }, // previously undetected: random
  "desktop-app-host": { timers: 1, files: 1, processes: 1, environment: 2 }, // previously undetected: processes; previously undetected (review 7): environment
  "diagnostics/actions": { timers: 1 },
  "diagnostics/browser-device": { clock: 3, timers: 1 },
  "diagnostics/host-endpoint": { random: 1, files: 1 }, // previously undetected: random
  "diagnostics/host-log": { clock: 3, files: 1 },
  "diagnostics/host-report": { clock: 1, files: 1, environment: 1 }, // previously undetected (review 7): environment
  "diagnostics/host-roots": { environment: 2 }, // previously undetected (review 7): environment
  "diagnostics/mod-identity": { files: 4, environment: 1 }, // previously undetected (review 7): environment
  "diagnostics/model": { clock: 1, random: 1 },
  "diagnostics/trace-window": { timers: 1, files: 1 },
  "diagnostics/zip": { clock: 1 },
  "dotnet-runtime": { clock: 4, files: 1, processes: 1, environment: 1 }, // previously undetected: processes; previously undetected (review 7): environment
  "engines/layered-makeup/raster-processor": { clock: 1, timers: 1 },
  "event-loop": { clock: 1, timers: 1 }, // previously undetected: timers
  "expressions-game-prerequisite": { network: 3, files: 1 },
  "eye-plate-cache": { clock: 1 },
  "eye-plate-prerequisite": { files: 1, environment: 1 }, // previously undetected (review 7): environment
  "eye-plate-service": { files: 1 },
  "eye-plate-wolvenkit": { files: 1 },
  "facial-host": { clock: 8, timers: 1, files: 1, processes: 1, environment: 1 }, // previously undetected: processes; previously undetected (review 7): environment
  "facial-prefetch": { timers: 1 },
  "facial-preview": { clock: 1, timers: 1 },
  "features/expressions/export/index": { files: 1 },
  "features/expressions/verify/index": { files: 1 },
  "features/eye-makeup/export/plate-input": { files: 1 },
  "features/eye-makeup/render/index": { timers: 1 },
  "features/eye-makeup/verify/verify-build": { files: 1 },
  "features/eye-makeup/view/uv": { timers: 1 },
  "features/poses/actions": { timers: 2 },
  "features/poses/host/preferences-store": { files: 1 },
  "features/save-explorer/actions": { clock: 1, timers: 2 },
  "features/save-explorer/host/saves-server": { files: 1 },
  "features/save-explorer/view/panel": { timers: 1 },
  "game-asset-export": { clock: 2, files: 1 },
  "game-asset-export-wolvenkit": { files: 1 },
  "game-blink": { timers: 1 },
  "grading-lut-host": { clock: 1, files: 2 },
  "host-code-identity": { files: 1 }, // speed 2 adapter, written before the rule reached its branch
  "host-state": { environment: 2 }, // previously undetected (review 7): environment
  "host-state-poller": { timers: 1 },
  "idle-host": { clock: 5, timers: 1, files: 1 },
  "install-detection-host": { files: 1, processes: 1, environment: 1 }, // previously undetected: processes; previously undetected (review 7): environment
  "installation-registry": { clock: 1, timers: 1, files: 1 },
  "installation-snapshot": { files: 2 }, // speed 2 adapter, written before the rule reached its branch
  "library-store": { clock: 1, random: 1, files: 1 }, // previously undetected: files
  "lighting-setup-stage": { clock: 2, timers: 1 },
  "local-settings-readiness": { files: 1, environment: 1 }, // previously undetected (review 7): environment
  "local-settings-server": { files: 1, environment: 1 }, // previously undetected (review 7): environment
  "local-settings-store": { random: 2, files: 1, environment: 2 }, // previously undetected: random; previously undetected (review 7): environment
  "mod-install-host": { clock: 1, random: 1, files: 1, processes: 2 }, // previously undetected: clock, random, processes
  "mod-install-transport": { clock: 4, random: 5, files: 1 }, // previously undetected: random
  "mod-makers": { environment: 1 }, // previously undetected (review 7): environment
  "native-geometry-export": { clock: 4, files: 1 },
  "native-texture-export": { clock: 7, files: 1, environment: 1 }, // speed 2 (decode lanes); previously undetected (review 7): environment
  "native/archive-reader": { files: 1 },
  "native/native-decode": { clock: 3, timers: 5, processes: 1 }, // previously undetected (review 7): processes
  "native/native-fetch-port": { network: 1 },
  "native/oodle": { files: 1, processes: 1, environment: 2 }, // previously undetected: processes; previously undetected (review 7): environment
  "package-action": { network: 1 },
  "package-bake": { files: 1 },
  "package-resource-builder": { timers: 2, files: 1 }, // previously undetected: timers
  "package-server": { random: 1, files: 1, environment: 4 }, // previously undetected: random; previously undetected (review 7): environment
  "part-preset-store": { clock: 6, random: 1, files: 1 }, // previously undetected: files
  "part-presets": { timers: 1, network: 2 },
  "plate-uv-footprint-io": { files: 1 },
  "platform/core/look-history": { clock: 1 },
  "platform/export/check-runner": { timers: 1, processes: 1 }, // previously undetected (review 7): processes
  "platform/export/product-builder": { clock: 2, timers: 1, files: 1 }, // previously undetected: timers
  "platform/export/host-real-paths": { files: 1 }, // PIPE-136: the containment checks' lstat port, shared by the builder, the host and the desktop
  "platform/export/product-host": { clock: 4, timers: 1, files: 1 },
  "platform/export/product-verifier": { files: 1 },
  "platform/scene/character-renderer": { clock: 6, timers: 3 },
  "platform/scene/face-driver": { timers: 1 },
  "platform/scene/idle-source": { clock: 2, timers: 1, network: 1 },
  "platform/scene/orbit-limits": { timers: 1 },
  "platform/scene/scene-host": { clock: 1, timers: 2 },
  "pose-catalogue-host": { clock: 5, files: 1 },
  "prepared-answers": { files: 2 }, // speed 2 adapter, written before the rule reached its branch
  "prepared-files": { files: 2 },
  "preview-core-host": { files: 1 },
  "preview-core-service": { clock: 1, files: 1 },
  "preview-preparation": { timers: 1, network: 2 },
  "process-tree": { timers: 1, processes: 1, environment: 1 }, // previously undetected: processes; previously undetected (review 7): environment
  "raster-task-yield": { timers: 2 },
  "raster-worker": { timers: 1 },
  "rdar-index-fs": { files: 2 }, // speed 2 (kept discovery)
  "render-fidelity-study": { network: 4 },
  "resolver-host": { clock: 3, timers: 1, network: 2, files: 2, environment: 1 }, // previously undetected (review 7): environment
  "resource-graph": { network: 1 },
  "route-fingerprint": { files: 1 },
  "runtime-diagnostic-promotion": { random: 1, files: 1 }, // previously undetected: random
  "runtime-diagnostic-stage": { files: 1 },
  "saves-host-sources": { files: 1, environment: 2 }, // previously undetected (review 7): environment
  "showroom/build": { clock: 2, files: 1 }, // previously undetected: clock
  "showroom/verify": { files: 1 },
  "source-discovery": { clock: 1, files: 2 },
  "studio-application": { random: 1 },
  "studio-file-operations": { clock: 3 },
  "studio-main": { storage: 1 },
  "studio-startup": { clock: 4, timers: 1, processes: 1 }, // previously undetected (review 7): processes
  "studio-ui/app": { clock: 1, timers: 8 },
  "studio-ui/components/choice-preview": { clock: 7, timers: 5 },
  "studio-ui/components/direction-dial": { timers: 1 },
  "studio-ui/components/listbox-keys": { clock: 1 },
  "studio-ui/components/search-field": { timers: 1 },
  "studio-ui/components/swatch-card": { timers: 1 },
  "studio-ui/components/tree-view": { timers: 1 },
  "studio-ui/controls": { timers: 2 },
  "studio-ui/dock/dock-view": { timers: 3 },
  "studio-ui/dock/layout": { clock: 1 }, // previously undetected: clock
  "studio-ui/feedback": { clock: 1, timers: 4 },
  "studio-ui/guidance/controller": { clock: 2, timers: 1 },
  "studio-ui/guidance/desktop-app-sheet": { clock: 1 },
  "studio-ui/guidance/overlay": { timers: 2 },
  "studio-ui/input-hints": { timers: 1 },
  "studio-ui/item-list": { timers: 1 },
  "studio-ui/menu": { timers: 5 },
  "studio-ui/panels/character": { timers: 1 },
  "studio-ui/panels/game-setup": { timers: 3 },
  "studio-ui/panels/history": { timers: 2 },
  "studio-ui/panels/settings": { timers: 2 },
  "studio-ui/panels/viewports": { timers: 1 },
  "studio-ui/preview-setup-card": { timers: 2 },
  "studio-ui/reason-tip": { timers: 1 },
  "studio-ui/scroll-anchor": { clock: 6, timers: 2 },
  "studio-ui/style-guide/demo": { timers: 1 },
  "studio-ui/style-guide/library-demo": { timers: 2 },
  "surface-editor": { timers: 1 },
  "tool-download": { timers: 1, files: 1 },
  "uv-editor": { timers: 2 },
  "verifier-wolvenkit": { files: 1 },
  "vortex-host": { files: 2 },
  "wolvenkit-cli": { clock: 5, files: 1, processes: 1, environment: 2 }, // previously undetected: processes; previously undetected (review 7): environment
  "wolvenkit-setup": { network: 2 },
  "wolvenkit-setup-host": { timers: 1, random: 4, files: 1, environment: 1 }, // previously undetected: random; previously undetected (review 7): environment
  "workspace-persistence": { timers: 1 },
  "zip-extract": { files: 1 },
};

test("no module reads the clock, timers, randomness, files, processes, the network, the environment, storage or the bridge directly beyond the recorded list", () => {
  expect(directReads()).toEqual(GRANDFATHERED as Record<string, Record<string, number>>);
});

test("the graph's own code (its types, the composition) reads nothing directly; its adapters are the only exception", () => {
  expect(Object.keys(directReads()).filter(name => name.startsWith("platform/graph-") || name === "compose/graph")).toEqual([]);
});

test("the ratchet's patterns see each kind of read, and not prose", () => {
  const probes: Record<string, readonly string[]> = {
    clock: ["const t = Date.now();", "const d = new Date;", "const d = new Date();", "const t = performance.now();", "const t = process.hrtime.bigint();"],
    timers: ["setTimeout(run, 5);", "window.setTimeout(run, 5);", "globalThis.setInterval(run, 5);", "setImmediate(done);", "await Bun.sleep(5);"],
    random: ["const id = crypto.randomUUID();", `import { randomUUID } from "node:crypto"; const id = randomUUID();`, "const id = `x-${randomUUID()}`;", "Math.random();"],
    network: ["await fetch(url);", "await window.fetch(url);", "new WebSocket(url);", "Bun.serve({ fetch: answer });", `import { createServer } from "node:http";`],
    storage: ["localStorage.getItem(key);", "indexedDB.open(name);"],
    files: [`import { readFileSync } from "node:fs";`, `import { Database } from "bun:sqlite";`, "await Bun.file(path).text();", "await Bun.write(path, text);"],
    processes: [`import { spawn } from "node:child_process";`, "Bun.spawn(command);", `const worker = new Worker("/build/raster-worker.js");`,
      `import { Worker } from "node:worker_threads";`],
    environment: [`import { freemem } from "node:os";`, "const home = process.env.USERPROFILE;", "const value = Bun.env.PATH;"],
    bridge: ["new RuntimeBridgeClient();"],
  };
  for (const [kind, texts] of Object.entries(probes)) for (const text of texts) expect(kindsIn(text)).toEqual([kind]);
  expect(kindsIn(["// Date.now() and fetch(x) in a comment", "const a = new Date(when); clock.after(5, run); const s = \"fetch(\";",
    `const kinds = ["http", "network", "os"];`].join(String.fromCharCode(10)))).toEqual([]);
  // Reads are counted: a listed module adding one more of a kind it already reads is caught.
  expect(readsIn("setTimeout(a, 1); setTimeout(b, 2); Date.now();")).toEqual({ clock: 1, timers: 2 });
});
