// Read-only preflight for the local package builder. The compiler owns the finish gate.
import { preflightPackageCollection } from "../src/package-preflight";
import { EYE_MAKEUP_REGION } from "../src/features/eye-makeup/region";

const source = process.argv[2];
if (!source) throw Error("Usage: bun tools/validate_collection_build.ts collection.json");
const { ready: _ready, packagedCollectionSha256: _hash, ...result } =
  preflightPackageCollection(await Bun.file(source).json(), EYE_MAKEUP_REGION);
console.log(JSON.stringify(result));
