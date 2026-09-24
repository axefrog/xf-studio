import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "XF Studio",
    identifier: "dev.axefrog.xf-studio",
    version: "0.1.0",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "main.ts" },
    copy: { "static": "views/studio", "build-tools": "build-tools" },
    win: { defaultRenderer: "native", autoGrantPermissions: [], icon: "icon/icon.ico" },
  },
} satisfies ElectrobunConfig;
