import type { ElectrobunConfig } from "electrobun";

// A distinct disposable app identity/entry can exercise the packaged host
// without borrowing or overwriting an installed user's Studio data.
const trialSuffix = process.env.XFS_DESKTOP_BUILD_TRIAL_SUFFIX;
if (trialSuffix && !/^[a-z0-9]{8,24}$/.test(trialSuffix))
  throw Error("Desktop build trial suffix must be 8–24 lowercase letters or digits.");

export default {
  app: {
    name: trialSuffix ? "XF Studio Build Trial" : "XF Studio",
    identifier: trialSuffix ? `dev.axefrog.xf-studio-build-trial-${trialSuffix}` : "dev.axefrog.xf-studio",
    version: "0.1.0",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: trialSuffix ? "trial-main.ts" : "main.ts" },
    copy: { "static": "views/studio", "build-tools": "build-tools" },
    win: { defaultRenderer: "native", autoGrantPermissions: [], icon: "icon/icon.ico" },
  },
} satisfies ElectrobunConfig;
