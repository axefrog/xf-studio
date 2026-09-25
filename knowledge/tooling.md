# Tooling: WolvenKit CLI

**Maturity: Draft.** How the WolvenKit command-line tool behaves as XF Studio runs it: what a release contains, what it needs to start, how it reports success and failure, and what `uncook` writes. Observed with the official 8.17.4 and 9.0.1 console releases on Windows 11 with game 2.31. The WolvenKit GUI, the Blender add-on and conversion round trips are not covered yet ([WolvenKit 9 round trip](../research/authoring/wolvenkit-9-roundtrip-2026-09-24.md) holds the round-trip evidence).

## Releases and identity

| Question | Answer | Grade and evidence |
|---|---|---|
| Which asset is the CLI? | `WolvenKit.Console-<version>.zip` on the [GitHub release](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1). GitHub publishes a SHA-256 digest per asset from 8.17.0 onwards (none for 8.16.1 and older). | [resource] release API, 25 Sep 2026 |
| What is inside? | A flat folder: `WolvenKit.CLI.exe` (a .NET apphost, 165,888 bytes in 9.0.1), `WolvenKit.CLI.dll` (the managed entry point), `WolvenKit.CLI.runtimeconfig.json`, about 90 dependency DLLs, `lib/` (texconv, DirectXTex), `opus-tools/`, `Resources/soundEvents.json`. 9.0.1: 99 files, 93,614,085 bytes; stored or deflated entries only, no ZIP64. | [resource] 9.0.1 archive, pinned in [`wolvenkit-release.ts`](../projects/xf-studio/authoring/src/wolvenkit-release.ts) |
| How is the version read without running it? | The PE version resource of `WolvenKit.CLI.exe` and `.dll` (`9.0.1.0`, `8.17.4.0`); `--version` prints `9.0.1` in about 0.1 s. | [resource] [`wolvenkit-cli.ts`](../projects/xf-studio/authoring/src/wolvenkit-cli.ts) `wolvenKitIdentity` |
| Which commands does it offer? | `archive`, `extract`/`unbundle`, `uncook` (`extract-and-export`), `import`, `export`, `pack`, `build`, `convert`, `conflicts`, `hash`, `oodle`, `settings`, `wwise`, `cr2w`; identical lists in 8.17.4 and 9.0.1. | [runtime of the tool] `--help` output |

## Runtime prerequisite

The console release is **framework-dependent**: its runtimeconfig names `Microsoft.NETCore.App` 10.0.0 in 9.0.1 and 8.0.0 in 8.17.4, with no `rollForward`, so the default **Minor** policy applies: any installed 10.x (respectively 8.x) release runtime satisfies it, never a pre-release and never another major. [resource] runtimeconfig files; [source] .NET host roll-forward rules (learn.microsoft.com, *.NET version selection*).

The apphost finds .NET in this order: `DOTNET_ROOT_X64`, then `DOTNET_ROOT` (used **exclusively** when set, even if empty of runtimes), then the registered location `HKLM\SOFTWARE\dotnet\Setup\InstalledVersions\x64\InstallLocation` (32-bit registry view), then `%ProgramFiles%\dotnet`, and looks for `shared/Microsoft.NETCore.App/<version>`. [source] .NET host probing design; [runtime of the tool] with `DOTNET_ROOT_X64` pointing at an empty folder, 9.0.1 printed `You must install .NET to run this application.`, `.NET location: Not found`, listed the searched locations and exited with **131** (the low byte of the host error, not the full `0x80008083`). No dialog appears for the console apphost. Implemented in [`dotnet-runtime.ts`](../projects/xf-studio/authoring/src/dotnet-runtime.ts) and `isRuntimeMissing`.

## Success and failure

- **Exit code is not enough.** `uncook` exits 0 when some requested resources fail to export, so callers must check the files they expected. [runtime of the tool] 8.17.4/9.0.1; see PREV-01 in the [code-health ledger](../research/authoring/code-health.md).
- **`Unhandled exception`** in the output means failure even with exit 0; a bad `-r` regex, for example, raises `RegexParseException` (the pattern is a .NET regex over backslash depot paths, so every backslash must be escaped). [runtime of the tool]
- **`convert s` on a resource it can't serialise** logs `Invalid in wolven rtti` and `ConvertToText` as errors, writes an empty (0-byte) `.json` beside the file and still exits 0; readers must parse the JSON, not trust its presence. `unbundle` with `--hash` exits 0 when the hash is found, and exited 160 when the archive path did not exist. [runtime of the tool] 9.0.1, 25 September 2026, on a mod's `.app` whose `castShadows` field is a `Bool` where 9.0.1 expects `shadowsShadowCastingMode`.
- **Folder `import`** exits 3 even when every file imported; success is `Imported N/N file(s)` with N > 0. [runtime of the tool] (Build adapter rule since Experiment 005.)
- The one runner that applies these rules is [`wolvenkit-cli.ts`](../projects/xf-studio/authoring/src/wolvenkit-cli.ts); consumers map its typed errors. Synchronous callers (the independent package verifier, through the injected [`verifier-wolvenkit.ts`](../projects/xf-studio/authoring/src/verifier-wolvenkit.ts)) use its blocking form `runWolvenKitSync`, which applies the same policy but cannot be cancelled. The character resolver's fetcher and the grading-LUT host use it too: every fetcher on one resolver cache folder runs its batches one at a time in a unique `mkdtemp` batch folder, shares in-flight resources (single-flight), and writes a lasting `.failed` marker (versioned; older markers are ignored and removed) only when `convert` finished cleanly with the extracted file intact and still produced no JSON.

## What `uncook` writes

With `-u --uext png --mesh-export-type MeshOnly -gp <game>` over `archive/pc/content` and a regex naming the resources: a `.mesh` yields the raw file, `<name>.glb` and `<name>.Material.json` (every material resolved through its `.mi` chain), plus the textures and multilayer setups those materials use; a `.morphtarget` yields the raw file and `<name>.morphtarget.glb`. The head mesh and morph target of the female player head came from `basegame_4_appearance.archive` in 2.31. [runtime of the tool] 9.0.1, 25 Sep 2026; [preview export method](../experiments/013-native-preview-core/README.md#ported-to-the-studio).

Whether a depot path exists at all is answered from the archives' RDAR indexes (FNV-1a 64 of the sanitized path), not from WolvenKit's output: reading every content index takes about 35 ms. [source] [mod loading](mod-loading.md), [`rdar-index-fs.ts`](../projects/xf-studio/authoring/src/rdar-index-fs.ts).

## Open questions

1. Does WolvenKit write anything beside itself or under the user profile at runtime (logs, settings, an Oodle DLL copied from the game)? Extra files in XF Studio's managed folder are tolerated, but not yet inventoried.
2. Does the CLI need write access to its own folder? XF Studio's copy lives in user data, so this is untested in a read-only location.
3. How does the Linux console release (`WolvenKit.ConsoleLinux`) differ, if XF Studio ever supports another platform?
