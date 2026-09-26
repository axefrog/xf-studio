/** Read-only preview by default; writes to real MO2 require an explicit verb. */
import { planRuntimePromotion, promoteRuntimeDiagnostic, recoverRuntimePromotion,
  rollbackRuntimePromotion, type PromotionOptions } from "../src/runtime-diagnostic-promotion";

function usage(): never {
  throw Error("Usage: bun tools/runtime-diagnostic-promotion.ts --candidate-store <absolute> --candidate-id <id> --game-root <absolute> --mo2-root <absolute> --profile <existing-name> --staging-root <existing-absolute-stage> --new-profile <new-name> [--promote|--recover|--rollback]");
}
const args = process.argv.slice(2), values = new Map<string, string>();
type Verb = "preview" | "promote" | "recover" | "rollback";
let verb = "preview" as Verb;
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (["--promote", "--recover", "--rollback"].includes(key)) {
    if (verb !== "preview") usage(); verb = key.slice(2) as Verb; continue;
  }
  if (!key.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--") || values.has(key)) usage();
  values.set(key, args[++i]);
}
const allowed = ["--candidate-store", "--candidate-id", "--game-root", "--mo2-root", "--profile", "--staging-root", "--new-profile"];
if (values.size !== allowed.length || [...values.keys()].some(key => !allowed.includes(key))) usage();
const options: PromotionOptions = {
  candidateStore: values.get("--candidate-store")!, candidateId: values.get("--candidate-id")!,
  gameRoot: values.get("--game-root")!, mo2Root: values.get("--mo2-root")!,
  profileId: values.get("--profile")!, stagingRoot: values.get("--staging-root")!,
  newProfileId: values.get("--new-profile")!,
};
const result = verb === "promote" ? promoteRuntimeDiagnostic(options) :
  verb === "recover" ? recoverRuntimePromotion(options) :
  verb === "rollback" ? rollbackRuntimePromotion(options) : planRuntimePromotion(options);
console.log(JSON.stringify(result ?? { reverted: true }, null, 2));
