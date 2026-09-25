/** Disposable installed-canary acceptance entry. Never selected by release builds. */
import { PATHS, Utils } from "electrobun/main";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDesktopServer } from "./server";
import { desktopVersionFromMetadata } from "./host";
import { defaultLocalSettings } from "../src/local-settings";
import { LocalSettingsStore } from "../src/local-settings-store";

const dataRoot = Utils.paths.userData;
const reportPath = resolve(dataRoot, "trial-build-report.json");
let app: ReturnType<typeof createDesktopServer> | undefined;
let exitCode = 1;
try {
  const metadata = JSON.parse(readFileSync(resolve(PATHS.RESOURCES_FOLDER, "version.json"), "utf8"));
  if (!/^dev\.axefrog\.xf-studio-build-trial-[a-z0-9]{8,24}$/.test(metadata.identifier))
    throw Error("Build trial entry requires a disposable app identity.");
  const version = desktopVersionFromMetadata(metadata);
  if (version.metadataStatus !== "ready") throw Error("Packaged canary metadata is unavailable.");
  const inputs = {
    gameRoot: process.env.XFS_BUILD_TRIAL_GAME_ROOT,
    wolvenKitCli: process.env.XFS_BUILD_TRIAL_WOLVENKIT,
    bunExecutable: process.env.XFS_BUILD_TRIAL_BUN,
    collection: process.env.XFS_BUILD_TRIAL_COLLECTION,
  };
  if (Object.values(inputs).some(value => !value)) throw Error("Build trial inputs are incomplete.");
  const store = new LocalSettingsStore(dataRoot);
  if (store.load().source !== "new" || existsSync(resolve(dataRoot, "library.sqlite")))
    throw Error("Build trial user data is not fresh; refusing to overwrite it.");
  store.save({ ...defaultLocalSettings(), gameRoot: inputs.gameRoot!,
    wolvenKitCli: inputs.wolvenKitCli!,
    bunExecutable: inputs.bunExecutable! }, 0);
  const viewRoot = resolve(PATHS.VIEWS_FOLDER, "studio");
  app = createDesktopServer(viewRoot, dataRoot, version, resolve(viewRoot, "check-worker.js"),
    resolve(PATHS.RESOURCES_FOLDER, "app", "build-tools"));
  const first = await fetch(app.url);
  const cookie = first.headers.get("Set-Cookie")?.split(";")[0];
  if (first.status !== 200 || !cookie) throw Error("Installed app loopback session failed.");
  const origin = new URL(app.url).origin;
  const capabilities = await (await fetch(origin + "/api/desktop/capabilities", { headers: { Cookie: cookie } })).json();
  const readiness = await (await fetch(origin + "/api/local-settings", { headers: { Cookie: cookie } })).json();
  if (capabilities.packageBuild !== true || readiness.readiness?.build?.ready !== true)
    throw Error(`Installed Build prerequisites were refused: ${JSON.stringify(readiness.readiness?.build?.issues)}`);
  const collection = JSON.parse(readFileSync(inputs.collection!, "utf8"));
  const response = await fetch(origin + "/api/package", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/json",
  }, body: JSON.stringify({ action: "build", collection }) });
  const result = await response.json();
  if (response.status !== 200) throw Error(`Installed Build returned ${response.status}: ${JSON.stringify(result)}`);
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ schema: "xfs/desktop-build-trial-1", status: "passed",
    identifier: metadata.identifier, version, userDataPath: dataRoot, result }, null, 2) + "\n");
  exitCode = 0;
} catch (error) {
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ schema: "xfs/desktop-build-trial-1", status: "failed",
    error: (error as Error).message, userDataPath: dataRoot }, null, 2) + "\n");
} finally {
  app?.stop();
  process.exit(exitCode);
}
