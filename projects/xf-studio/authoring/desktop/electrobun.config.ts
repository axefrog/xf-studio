import type { ElectrobunConfig } from "electrobun";
import desktopPackage from "./package.json";

// package.json `version` is the single source of truth for the app version; release
// tags, About, packaged version.json and the artifact gate all derive from it.

// A distinct disposable app identity/entry can exercise the packaged host
// without borrowing or overwriting an installed user's Studio data.
const trialSuffix = process.env.XFS_DESKTOP_BUILD_TRIAL_SUFFIX;
if (trialSuffix && !/^[a-z0-9]{8,24}$/.test(trialSuffix))
  throw Error("Desktop build trial suffix must be 8–24 lowercase letters or digits.");
const uiTrialSuffix = process.env.XFS_DESKTOP_UI_TRIAL_SUFFIX;
if (uiTrialSuffix && !/^[a-z0-9]{8,24}$/.test(uiTrialSuffix))
  throw Error("Desktop UI trial suffix must be 8–24 lowercase letters or digits.");
if (trialSuffix && uiTrialSuffix) throw Error("Select only one disposable desktop trial identity.");

export default {
  app: {
    name: trialSuffix ? "XF Studio Build Trial" : uiTrialSuffix ? "XF Studio UI Trial" : "XF Studio",
    identifier: trialSuffix ? `dev.axefrog.xf-studio-build-trial-${trialSuffix}` :
      uiTrialSuffix ? `dev.axefrog.xf-studio-ui-trial-${uiTrialSuffix}` : "dev.axefrog.xf-studio",
    version: desktopPackage.version,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: trialSuffix ? "trial-main.ts" : "main.ts" },
    copy: { "static": "views/studio", "build-tools": "build-tools" },
    win: { defaultRenderer: "native", autoGrantPermissions: [], icon: "icon/icon.ico" },
  },
} satisfies ElectrobunConfig;
