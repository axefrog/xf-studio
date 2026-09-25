// Localhost: download XF Studio's own copy of WolvenKit CLI (the pinned official release) into the
// ignored tools folder (`data/tools`, or XFS_TOOLS_DIR). It shows what it will download and asks
// first; pass --yes to agree up front. A WolvenKit path in Local setup or XFS_PACKAGE_WOLVENKIT
// still wins over this copy.
//   bun tools/setup-wolvenkit.ts [--yes]
import { LocalSettingsStore } from "../src/local-settings-store";
import { localToolsRoot } from "../src/package-server";
import { WolvenKitSetupHost } from "../src/wolvenkit-setup-host";
import { wolvenKitConsent } from "../src/wolvenkit-setup";

const settings = new LocalSettingsStore().load().settings;
const host = new WolvenKitSetupHost({ root: localToolsRoot(), configured: () => process.env.XFS_PACKAGE_WOLVENKIT || settings.wolvenKitCli,
  log: message => console.log(`  ${message}`) });
let state = host.snapshot();
if (state.phase === "ready" || state.phase === "needs-runtime" || state.phase === "custom-missing" || state.phase === "unsupported") {
  console.log(state.message);
  if (state.phase === "needs-runtime" && state.runtime) console.log(`Microsoft's installer: ${state.runtime.installerUrl}\nDownload page: ${state.runtime.pageUrl}`);
  process.exit(state.phase === "ready" ? 0 : 2);
}
const consent = wolvenKitConsent(state);
console.log(`${consent.title}\n${consent.intro}\n`);
for (const fact of consent.facts) console.log(`  ${fact.label}: ${fact.value}`);
if (consent.runtimeNote) console.log(`\n${consent.runtimeNote}`);
console.log(`\n  Licence: ${state.offer.licence.url}\n  Release: ${state.offer.releasePage}\n`);
if (!process.argv.includes("--yes")) {
  const answer = prompt(`${consent.confirm}? [y/N]`);
  if (!/^y(es)?$/i.test(answer?.trim() ?? "")) { console.log("Nothing was downloaded."); process.exit(1); }
}
process.on("SIGINT", () => { host.cancel(); });
state = host.install(state.offer.version);
let last = "";
while (state.phase === "downloading" || state.phase === "installing") {
  const line = `${state.message} ${state.step ?? ""}`.trim();
  if (line !== last) { console.log(line); last = line; }
  await Bun.sleep(500);
  state = host.snapshot();
}
await host.settled();
state = host.snapshot();
console.log(state.message);
if (state.phase === "needs-runtime" && state.runtime) console.log(`Microsoft's installer: ${state.runtime.installerUrl}`);
process.exit(state.phase === "ready" ? 0 : 1);
