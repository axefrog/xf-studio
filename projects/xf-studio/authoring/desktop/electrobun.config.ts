import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "XF Studio Desktop Spike",
    identifier: "dev.axefrog.xf-studio-spike",
    version: "0.0.1",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "main.ts" },
    copy: { "static": "views/studio" },
    win: { defaultRenderer: "native", autoGrantPermissions: [], icon: "icon/icon.ico" },
  },
} satisfies ElectrobunConfig;
