# Experiment 023: Vortex deploying Cyberpunk 2077 mods, observed in Windows Sandbox

**Question.** What does Vortex actually write when it manages Cyberpunk 2077: the deployment manifest, the files in the game folder, its staging folder and its state database? Can another program read that state while Vortex runs? Does Vortex tolerate a file dropped into `archive/pc/mod` by another tool? The answers feed [knowledge/vortex.md](../../knowledge/vortex.md) and the [Vortex support backlog](../../research/backlog/vortex-support.md).

**Safety.** Vortex is never installed or run on the development machine and never sees the real game. Everything happens in a disposable Windows Sandbox: the official Vortex 2.7.1 installer and the Cyberpunk extension's 0.12.1 release (both SHA-256-checked, see `D:/Dev/tools/README.md`) are mapped in read-only, the game is a synthetic folder with a dummy `bin\x64\Cyberpunk2077.exe` (the only file the extension requires), and Vortex's `nxm://` association is switched off before its first start. The sandbox, and anything Vortex registered in it, is discarded when it closes.

## Method

`bun experiments/023-vortex-sandbox/kit.ts` checks the two downloads, extracts the extension and writes `generated/vortex-run.wsb`; opening it runs [`run.ps1`](run.ps1) unattended:

1. Quiet install (`/S`); record the uninstall entry and the `nxm` registration.
2. Build the synthetic game folder, with two files placed by hand in `archive\pc\mod` (`Hand Installed.archive`, `Preexisting.archive`).
3. Seed Vortex's state with its own `--set` command before its first start: `settings.nexus.associateNXM=false`, the discovered game path, a profile `xfstest` made active, and hard-link deployment.
4. Copy the extension into `%APPDATA%\Vortex\plugins\cyberpunk2077`.
5. Start Vortex on that game and profile, then install three zipped test mods through the running instance with `--install-archive`: A (`xf_test_a.archive` + `.xl` + `XF Test Shared.archive`), B (`xf_test_b.archive`, its own `XF Test Shared.archive`, and `Preexisting.archive`), then, after a file `XF Eye Artistry.archive` is dropped into `archive\pc\mod` outside Vortex, D.
6. Record the game folder (sizes, times, hard-link counts, contents), the manifest after each step, the staging folder and its marker, which `state.v2` files another process can open while Vortex runs, then close Vortex and read its state with `--get` and copy the closed database.

Outputs land in `generated/results/` (ignored). Asset-free fixtures derived from them are committed under `projects/xf-studio/authoring/tests/fixtures/vortex/`.

## Results

Pending. The first launch (26 September) stopped during the Vortex install when another Windows Sandbox session started; only one runs at a time.
