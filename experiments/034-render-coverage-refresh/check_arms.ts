/**
 * Experiment 034, step 4: does XF Studio's arm cyberware chain (save-loadout.ts → arm-cyberware.ts, render gap plans §5) pick the holster
 * state a save's equipped arm cyberware names, from the game's own data?
 *
 * For each save given: the loadout's `ArmsCW` item, its holstered item's `appearanceName` through the installed compiled TweakDB, and the
 * creator resource's group for it (the save's body gender's creator resource, read from the installed base archives), plus the arms
 * options the save itself stores in that group (a save lists every holster state's resolved appearances). `--fixture <file>` writes, for
 * the first save with arm cyberware, the item, the state, the group, the creator resource's perspectives and arms group names, and the
 * save's options in that group, for the unit test (game- and save-derived: keep it in the ignored
 * `projects/xf-studio/authoring/data/private-fixtures/`). Read-only towards the game and the saves; prints IDs and names only.
 *
 *   cd projects/xf-studio/authoring
 *   <python> ../../../tools/memory_guard.py --limit 3 -- bun ../../../experiments/034-render-coverage-refresh/check_arms.ts <sav.dat>... [--fixture <file>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { armsStateFor } from "../../projects/xf-studio/authoring/src/arm-cyberware";
import { readCco } from "../../projects/xf-studio/authoring/src/cco-model";
import { ccoPath } from "../../projects/xf-studio/authoring/src/character-resolver";
import { holsteredAppearance, tweakDbOf } from "../../projects/xf-studio/authoring/src/clothing-host";
import { readSavedV } from "../../projects/xf-studio/authoring/src/save-reader";
import { openGame } from "./game-files";

const args = process.argv.slice(2);
const at = args.indexOf("--fixture"), fixture = at >= 0 ? args.splice(at, 2)[1]! : null;
const { game, doc } = openGame(null);
const tweakDb = tweakDbOf(game, true);
if (!tweakDb) throw Error("The game's TweakDB couldn't be read.");
const creators = new Map<string, ReturnType<typeof readCco>>();
const creator = (gender: "female" | "male") => {
  let found = creators.get(gender);
  if (!found) { const d = doc(ccoPath(gender, false)).document; found = readCco(d.Data?.RootChunk ?? d, gender); creators.set(gender, found); }
  return found;
};
let written = false;
for (const path of args) {
  const v = readSavedV(new Uint8Array(readFileSync(path)));
  const gender = v.isMale ? "male" : "female", cco = creator(gender);
  const state = armsStateFor(v.loadout?.arms ?? null, item => holsteredAppearance(tweakDb.blob, item), cco);
  const saved = v.groups.arms.find(group => group.name === state.group)?.appearances.map(a => ({ option: a.name, definition: a.definition })) ?? [];
  console.log(JSON.stringify({ save: path.split(/[\\/]/).slice(-2, -1)[0], gender, item: v.loadout?.arms ?? null, state: state.name, group: state.group,
    reason: state.reason ?? null, savedOptions: saved.map(entry => entry.option) }));
  if (fixture && !written && v.loadout?.arms) {
    mkdirSync(dirname(fixture), { recursive: true });
    writeFileSync(fixture, JSON.stringify({ note: "Game- and save-derived (TweakDB, creator resource, a local save's loadout). Private.", gender,
      item: v.loadout.arms, expected: { name: state.name, group: state.group },
      tweakDb: { [v.loadout.arms]: holsteredAppearance(tweakDb.blob, v.loadout.arms) },
      creator: { perspectives: cco.perspectives ?? [], armsGroups: cco.parts.arms.groups.map(group => group.name) }, savedOptions: saved }));
    written = true;
    console.log("fixture written");
  }
}
