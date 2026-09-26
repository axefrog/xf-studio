// Local build input adapter. Packaging and game installation are separate operations.
import { bakeCollection } from "../src/package-bake";
import { EYE_MAKEUP_REGION } from "../src/features/eye-makeup/region";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw Error("Usage: bun tools/bake_collection.ts collection.json output-directory");
const { records } = await bakeCollection(await Bun.file(source).json(), destination, { region: EYE_MAKEUP_REGION });
console.log(`Compiled ${records.length} authored presets; ${records.length * 3} map inputs. No installation.`);
