// The Inno Setup release that wraps Electrobun's setup into the single downloadable setup program
// (single-installer.ts). Kept free of imports so the notices check can read it too.
// Moving to a newer release: change all four values from its official GitHub release, rebuild, and
// update INNO_DATA_MARKER in single-installer.ts if the setup-data format version changed.
export const INNO_SETUP = Object.freeze({
  version: "6.7.3",
  url: "https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe",
  bytes: 10_592_232,
  sha256: "9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732",
});
