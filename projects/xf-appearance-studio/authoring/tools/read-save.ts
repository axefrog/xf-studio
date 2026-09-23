import { readSavedV } from "../src/save-reader";
import { resolve } from "node:path";
const [source, destination] = Bun.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination))
  throw Error(
    "Usage: bun tools/read-save.ts <copied sav.dat> <new appearance.json>",
  );
const bytes = await Bun.file(source).bytes(),
  sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const appearance = readSavedV(bytes);
await Bun.write(
  destination,
  JSON.stringify(
    { source: { path: resolve(source), sha256 }, ...appearance },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      output: resolve(destination),
      saveVersion: appearance.saveVersion,
      gameVersion: appearance.gameVersion,
      presetVersion: appearance.presetVersion,
      morphs: appearance.groups.head.flatMap((g) => g.morphs),
      appearanceCount: Object.values(appearance.groups)
        .flat()
        .reduce((n, g) => n + g.appearances.length, 0),
      evidence: appearance.evidence,
    },
    null,
    2,
  ),
);
