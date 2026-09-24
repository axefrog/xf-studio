# WolvenKit 9.0.1 private package round trip — 24 September 2026

The official [WolvenKit 9.0.1 release](https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1) publishes the Windows `WolvenKit.Console-9.0.1.zip` asset and SHA-256 `364427384c0f4ebb6b157fa9abd01595258af1b7993c7b3a7edd2920f2016e92`. The downloaded ZIP matched that digest, its entries passed a traversal-path check, and it was extracted beside the existing 8.17.4 installation at `F:/Games/RedModding/WolvenKit.Console-9.0.1/`. `WolvenKit.CLI.exe --version` reported `9.0.1`; `--help` listed the required `import`, `export`, `convert`, `pack` and `extract` commands. The installed .NET 10.0.12 runtime satisfied the release prerequisite. The official source checkout used for earlier writer research remains at `11720772f1e20581301b3dec88a59f7b5ee05675`; its working tree had local changes at this check and was not changed or used to build the package.

From the isolated `codex/wolvenkit-9-roundtrip` worktree, `experiments/005-preset-collection/build.py` compiled `editor-collection.json` with the 9.0.1 CLI and absolute private experiment-004 plate inputs from the HQ checkout. `--no-latest` kept the fixture pointer unchanged. The generated worktree output is ignored; no payload entered Git. `verify.py --build … --wolvenkit …` then independently unpacked and checked the candidate.

| Check | Result |
|---|---|
| Build and independent verifier | Passed; 4 presets, 5 selector options including Off, 12 XBM textures, 16 unpacked resources, 105 morphs and unchanged model buffers |
| Input plate hashes | Same mesh and morph SHA-256 as the latest validated 8.17.4 HQ build: `9099726e9842888232ae22c0abf41a6b9fb99c6bf44f36c7786fe0d791223fed`, `7252eaad86f58e31c54c6168a30b3eb34a3e22e2edbb55d6ef826b310eaf6b4b` |
| Depot member comparison | Exactly the same 16 paths, sizes and SHA-256 payload digests as HQ `build-1790198621448031500`; zero changed member bytes |
| 9.0.1 archive | 847,872 bytes; SHA-256 `02233e1300ad97ebef5f6a805aa45c813975a1c67c6f1505196aef32a9d294cb` |
| 8.17.4 baseline archive | 847,872 bytes; SHA-256 `bfdce8b5a2ac330b3f891308a288b132b5bc2a6be36b13b16c8b8e18b899959d` |

The whole-archive digests differ while every unpacked member is byte-identical. WolvenKit writes file-entry timestamps into the archive index, so whole-archive hash equality is not the content criterion here. The verifier also checked the resource graph, supplied texture mip chains, decoded pixel error bounds, exact unpacked paths and generated source inventory. This establishes 9.0.1 offline compatibility with this four-preset fixture only. The package was not installed, ArchiveXL was not executed, and no game/rendering or save-persistence result follows. Production tool defaults remain at 8.17.4 pending broader adoption decisions.
