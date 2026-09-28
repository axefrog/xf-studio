/**
 * Experiment 031: the same expressions rendered on V with each facial setup. Starts two isolated, disposable-data Studio servers from this
 * checkout (the default, which solves with the setup the photo-mode face rig names, and one with XFS_FACIAL_SETUP=female-head), renders
 * the vectors with experiment 026's expression-look.ts in a headless Chrome against each, and stops them. Never the maintainer's server,
 * draft or library. Renders are private (the player's own game assets): they go to the ignored evidence/screenshots tree.
 *
 *   cd projects/xf-studio/authoring
 *   python ../../../tools/memory_guard.py --limit 6 -- bun ../../../experiments/031-photo-mode-facial-setup/render_compare.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../../projects/xf-studio/authoring/tools/cdp";

const authoring = resolve(import.meta.dir, "../../projects/xf-studio/authoring");
const out = resolve(authoring, "evidence/screenshots/facial-setup-d1");
mkdirSync(out, { recursive: true });
const vectors = resolve(out, "vectors.json");
writeFileSync(vectors, JSON.stringify({
  "smile-050": { lips_l_corner_up: 0.5, lips_r_corner_up: 0.5 },
  "smile-070": { lips_l_corner_up: 0.7, lips_r_corner_up: 0.7 },
  "smile-070-raise-050": { lips_l_corner_up: 0.7, lips_r_corner_up: 0.7, eye_l_oculi_squint_outer_lower: 0.5, eye_r_oculi_squint_outer_lower: 0.5 },
}));
const installed = resolve(out, "installed.json");
writeFileSync(installed, JSON.stringify(["installed:facial_happy", "installed:facial_charming"]));

for (const [label, port, setup] of [["face-rig", 4471, undefined], ["female-head", 4472, "female-head"]] as const) {
  const previous = process.env.XFS_FACIAL_SETUP;
  if (setup) process.env.XFS_FACIAL_SETUP = setup; else delete process.env.XFS_FACIAL_SETUP;
  const { server, data } = await startServer(port);
  if (previous === undefined) delete process.env.XFS_FACIAL_SETUP; else process.env.XFS_FACIAL_SETUP = previous;
  try {
    const state = async () => (await (await fetch(`http://127.0.0.1:${port}/api/facial`)).json()) as { rig: { phase: string; setup?: string } };
    for (let i = 0; i < 480 && (await state()).rig.phase === "preparing"; i++) await Bun.sleep(500);
    console.log(label, "face solved with", (await state()).rig.setup);
    const look = Bun.spawn(["bun", resolve(import.meta.dir, "../026-natural-expressions/expression-look.ts"), "--server", `http://127.0.0.1:${port}`,
      "--out", resolve(out, label), "--views", "front,tq", vectors, installed], { cwd: authoring, stdout: "inherit", stderr: "inherit" });
    if (await look.exited !== 0) throw Error(`expression-look failed for ${label}`);
  } finally {
    server.kill();
    await server.exited;
    rmSync(data, { recursive: true, force: true });
  }
}
