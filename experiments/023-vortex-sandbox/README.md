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

One complete run on 26 September 2026 (Windows 11 Enterprise 10.0.26100 sandbox, about 19 minutes, 13 of them the quiet install). An earlier launch the same day stopped during the install when another Windows Sandbox session started; only one runs at a time. The sandbox was discarded afterwards; nothing on the development machine changed. Private outputs are in `generated/results/` (ignored); the committed, asset-free fixtures are the final manifest, the observed game-folder listing and both state database copies in [`tests/fixtures/vortex/sandbox-023`](../../projects/xf-studio/authoring/tests/fixtures/vortex/sandbox-023). The sandbox's paths name only its built-in `WDAGUtilityAccount`.

**Install and registration.**
- `vortex-setup-2.7.1.exe /S` exited 0 after 759 s and installed per machine to `C:\Program Files\Vortex\Vortex.exe`.
- Uninstall entry: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\57979c68-f490-55b8-8fed-8b017a5af2fe`, `DisplayName` "Vortex", `DisplayVersion` "2.7.1", `Publisher` "Black Tree Gaming Ltd.", no `InstallLocation`.
- `Vortex.exe --set <path>=<json>` worked before the first start: each call printed `changed` and exited without a window. (Exit codes were not captured; `run.ps1` now keeps the process handle so they are.)
- **nxm.** With `settings.nexus.associateNXM=false` set before the first start, `HKCU\Software\Classes\nxm\shell\open\command` never existed: not before install, after install, after start or at the end. Vortex's log shows it registering `nxm` as an in-app handler only (`register protocol {"protocol":"nxm"}`). What it writes when the setting is on was not tested.

**Starting on a seeded setup.**
- Vortex opened on Cyberpunk 2077 with the seeded profile and found the synthetic game folder.
- It first reported "Mods can't be deployed" because the staging folder `%APPDATA%\Vortex\cyberpunk2077\mods` did not exist yet. The first install created it.
- The staging folder never received a `__vortex_staging_folder` marker. Seeding state with `--set` skipped the manage-game flow whose `ensureStagingDirectory` writes it, so the marker's presence in a normal setup is still source-only. Either way, XF Studio must not depend on it.
- Vortex's online requests failed in the sandbox (update check, extension list, Nexus lookups: `fetch failed`, `ETIMEDOUT`). Installing and deploying local archives did not need them.

**Installing through the running instance.**
- Each `--install-archive <zip>` reached the running Vortex ("getting arguments from second instance"). Each archive went through the Cyberpunk installer, was enabled in the profile (`modState.<id>.enabled = true`) and was deployed at once, with no prompt.
- The mod id and staging folder are the archive name without `.zip`. The Mods page shows the archive's file name with its extension (`XF Test Mod A.zip`), which is `attributes.logicalFileName`.
- A local install records `name`, `fileName`, `logicalFileName`, `fileMD5`, `fileSize`, `modSize`, `installTime` and `downloadGame`, but **no `version`, `modId`, `fileId` or `source`**, even for `XF Test Mod B-9001-1-0-1727000000.zip`, whose name follows Nexus's download naming.
- Vortex did try a Nexus lookup by `<md5>:<size>:cyberpunk2077`, which failed offline. Whether that lookup fills in Nexus ids for a real Nexus file installed from disk is an open question.

**What deployment wrote.**
- **Hard links.** Every deployed file had two links (the staging copy and the game-folder copy), so it had the staged file's modification time. That time came from the zip entry, rounded to two seconds, and equals the manifest's `time`.
- No `__folder_managed_by_vortex` was written, because every folder already existed.
- **Manifest.** One `vortex.deployment.json`, in the game folder, with exactly the source-documented fields in the order `instance`, `version`, `deploymentMethod`, `gameId`, `deploymentTime`, `stagingPath`, `targetPath`, `files`.
  - `relPath` uses backslashes and the original case; `target` is empty; `source` is the mod id.
  - It was rewritten after each deployment, and a `vortex.deployment.msgpack` copy (852 bytes) sits in the staging folder.
  - The generic `dinput` and `enb` mod types were deployed with zero files and left no manifest.
- **Winner.** A and B both ship `XF Test Shared.archive`. With no rules between them (`done sorting mods {"numRules":0}`), B, deployed second, won: the manifest lists the file once, for B. A's copy stayed only in staging, and Vortex showed "There are unresolved file conflicts". This run doesn't establish that install order decides ties in general.
- **Replaced file.** B's `Preexisting.archive` replaced the hand-placed one, which Vortex renamed `Preexisting.archive.vortex_backup` with its content intact.
- **Unmanaged files.** `Hand Installed.archive` and `XF Eye Artistry.archive`, the latter dropped into `archive\pc\mod` between two deployments, were left alone. Vortex's external-change check walked only its manifest's entries (0, then 3, then 5) and raised no dialog.
- The extension logged that it couldn't open `V2077\Load Order\V2077-load-order-xfstest.json`; with no REDmods it created no `V2077` folder.

**Vortex's state database.**
- **While Vortex ran,** another process could open the 11 tables and `CURRENT`, but not `MANIFEST-000034` or `000036.log` (sharing violation).
  - The tables were small, one per earlier start: each `--set` run had flushed its log into a table.
  - So nothing from the running session was visible: no installed mods, no enabled states, not even the `app.instanceId` created at first start. XF Studio's reader reads those files in `all-files` mode and reports both gaps.
- **After Vortex closed,** `--get <path>` printed `path = value` lines. The database had been compacted into one 3,750-byte table whose data block is **Snappy-compressed**, plus an empty log. XF Studio's reader read it through the MANIFEST with no gaps: 130 keys, matching `--get`.
- No `temp\state_backups_full` backup was written in the roughly five-minute session, consistent with the first hourly backup coming an hour after start.

**Consequences for XF Studio** (applied on this branch):
- State read while Vortex runs is now marked not current, with a plain note that recent installs may be missing.
- The stale-deployment check runs only on current state. Before this fix, state read from a running Vortex would have reported every deployed mod as "not installed".
- New tests cover the real manifest, the real closed database (including its Snappy block) and the locked live database.

**Limits.**
- The game folder was synthetic, and all mods were local zips with no Nexus metadata.
- Purge, uninstall, disabling without deploying, reinstalling an archive with the same name, symbolic-link refusal and the `nxm` behaviour with the setting on were not exercised.
- This was a single run.
- Nothing here is evidence about the game itself.
