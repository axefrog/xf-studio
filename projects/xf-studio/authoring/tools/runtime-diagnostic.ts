/** Offline first-game diagnostic. Dry-run is the default and writes nothing. */
import { planRuntimeDiagnostic, stageRuntimeDiagnostic, type RuntimeDiagnosticOptions } from "../src/runtime-diagnostic-stage";

function usage(): never {
  throw Error("Usage: bun tools/runtime-diagnostic.ts --candidate-store <absolute> --candidate-id <id> --game-root <absolute> --mo2-root <absolute> --profile <name> --staging-root <new absolute directory> [--stage]");
}
const argumentsList = process.argv.slice(2);
const values = new Map<string, string>();
let stage = false;
for (let i = 0; i < argumentsList.length; i++) {
  const key = argumentsList[i];
  if (key === "--stage") { stage = true; continue; }
  if (!key.startsWith("--") || !argumentsList[i + 1] || argumentsList[i + 1].startsWith("--") || values.has(key)) usage();
  values.set(key, argumentsList[++i]);
}
const allowed = ["--candidate-store", "--candidate-id", "--game-root", "--mo2-root", "--profile", "--staging-root"];
if (values.size !== allowed.length || [...values.keys()].some(key => !allowed.includes(key))) usage();
const options: RuntimeDiagnosticOptions = {
  candidateStore: values.get("--candidate-store")!, candidateId: values.get("--candidate-id")!,
  gameRoot: values.get("--game-root")!, mo2Root: values.get("--mo2-root")!,
  profileId: values.get("--profile")!, stagingRoot: values.get("--staging-root")!,
};
const result = stage ? stageRuntimeDiagnostic(options) : planRuntimeDiagnostic(options);
console.log(JSON.stringify(result, null, 2));
