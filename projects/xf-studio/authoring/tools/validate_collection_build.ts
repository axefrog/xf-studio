// Read-only Check for a collection file: every product its package plan builds, as the hosts' Check reports it.
// The composed exporters own the finish gates (eye makeup: the compiler's). Writes nothing.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkProducts } from "../src/platform/export/product-check";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";

const source = process.argv[2];
if (!source) throw Error("Usage: bun tools/validate_collection_build.ts collection.json");
const text = readFileSync(source, "utf8").replace(/^\uFEFF/, "");
const { result } = checkProducts({ collection: JSON.parse(text), exporters: STUDIO_EXPORTERS, prerequisites: {}, diagnostics: false,
  preflight: true, collectionSha256: createHash("sha256").update(text).digest("hex") });
console.log(JSON.stringify(result));
