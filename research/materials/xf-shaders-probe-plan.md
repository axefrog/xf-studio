# XF Shaders probe: test card (planned, not built)

**Status (30 September 2026): plan only.** Nothing described here exists yet. It is the supervised in-game check of the offline [pipeline trace](xf-shaders-pipeline-trace.md): a small RED4ext plugin, **XF Shader Probe**, that first only logs, then (in the last rows) swaps one pixel program for one test template. The maintainer runs the game; agents build, stage and read logs. Estimated build time about 1.5–2 agent-days (C++ against RED4ext.SDK, plus a side-cache writer in `exe_shaders.py`); one sitting of about 30 minutes.

## What it must prove

1. The traced functions and globals resolve by address-library ID on the running build and look as expected (the offline `trace` checks, repeated in process).
2. The cache reader holds what the file says, and the key recipe is the engine's.
3. A renamed template misses, and the miss's visible outcome.
4. Remapping a renamed template's key to the original's gives the original look.
5. A substituted pixel program draws only on our template, with no effect on vanilla decals, and a refused one falls back cleanly.

## Build (offline, before the sitting)

| Part | Content |
|---|---|
| Plugin | `XFShaderProbe.dll`, RED4ext plugin built against RED4ext.SDK; resolves IDs with `UniversalRelocBase::Resolve` and hooks through RED4ext's hooking API, like ArchiveXL. Read-only unless its config says `mode = "remap"` or `"swap"`. |
| Load gate | Refuses to hook, and logs why, unless the game version is 2.31 and every structural check passes (each function's first bytes against the recorded prologue; the reader's vtable slots `+0x20/+0x28/+0x58` equal the resolved `GetProgram`, `FindTechnique` and `GetParameterSet`). |
| Test package | `XF Shader Probe Plate`: an XF Eye Artistry build of one flat Matte preset whose plate material uses a copied `mesh_decal` template named `xfs_probe_decal` (same parameters and passes), plus a side cache holding one pixel program: the `mesh_decal` `post_gbuffer` MeshSkinned program recompiled with `albedo *= float3(1, 0.2, 0.2)` (red tint), validated offline against the original's `ISG1`, `OSG1` and bindings. A second, deliberately broken side cache (an extra `SV_Target3`) for P7. |
| Logs | `red4ext/logs/XFShaderProbe-*.log`, one JSON object per line: `evt`, time, frame number, values. |
| Kill switch | Deleting or disabling the MO2 entry; nothing persists outside the plugin's folder. |

Stage only in the XF diagnostic MO2 profile, as the bridge test card describes. Never in an everyday profile.

## Rows

Game state: a save with V in her apartment; photo mode for P2–P7, face framing, one photo-mode light on, fixed exposure. The XF selector shows the probe preset.

| # | Mode | Action (M = maintainer, C = coordinator) | Probe logs | Pass when | Proves |
|---|---|---|---|---|---|
| P0 | read-only | M starts the game to the main menu | `evt=resolve` per ID: RVA, first 16 bytes, check result; `evt=gate` | All 23 IDs resolve, every check passes, `gate=ok` | Trace §4 on the live build |
| P1 | read-only | (automatic after load) | `evt=reader`: `g_ShaderCache`, reader vptr, entry counts of the three maps; `evt=rootsig`: the parameter count and each root parameter's type, register range and space read from `SDeviceData+0x1A8EB18` | Counts 19,037 programs, 19,647 techniques, 1,019 parameter sets; the root signature lists the ranges §5 needs (`cb0`, `cb1`, `cb4`, `cb12`, `t0 space1`, …) | §3.1, §4.2, §4.6 |
| P2 | read-only | M loads the save, opens photo mode with the probe preset **off** (vanilla makeup only) | `evt=find` for every `FindTechnique` whose high word is `0xF00041A9` (`mesh_decal`): key, result, vertex and pixel GUIDs | `0xF00041A96EB576A0` returns vertex `11128168794837425370`, pixel `16098255505177109230` | §3.2 key recipe; which programs V's decals use |
| P3 | read-only | C switches the preset **on** (the plate uses `xfs_probe_decal`); M frames the face, then a close-up | `evt=find` for high word `0xC6D6F561` (`xfs_probe_decal`): key `0xC6D6F5616EB576A0` and a miss | Log shows the miss; **record whether the plate is invisible** (expected) or drawn by a fallback, with a capture | Open question 1; the no-plugin outcome |
| P4 | remap | C sets `mode = "remap"` and reloads the probe (or restarts, if reload is not built) | `evt=remap`: our key → original key, returned GUIDs | The plate draws and matches a normal `mesh_decal` build of the same preset (A/B capture against the build without the copied template) | §6.1 step 2 pass-through |
| P5 | swap | `mode = "swap"` | `evt=serve`: our GUID, blob size, FNV-1a-32; `evt=shader`: GpuApi `CreateShader` returning a new ID for that hash; `evt=pso`: `CreateGraphicsPSO` with our hash in the seed and its HRESULT | The plate turns red; brows, lip and freckle decals stay unchanged; `S_OK` | §6.1 steps 3–5 end to end |
| P6 | swap | M moves the camera around and changes the photo-mode light; one blink | Nothing new after the first PSO; `evt=find` never repeats for the same key | No flicker, no pop after the first frame (note any first-frame pop: async PSO compile) | Hook frequency; the async-compile risk |
| P7 | swap | C switches to the broken side cache, reloads | `evt=refuse`: which check failed | Refusal logged, plate back to the normal (remapped) look, no crash | §6.1 step 4 |
| P8 | read-only | (optional) C switches to a copy that keeps `name = mesh_decal` | `evt=compile`: the render-template pointer passed to `GetOrCompileTechnique` and its `+0x128` value | Two distinct template pointers with the same `+0x128` | §6.3 variant feasibility |

## Evidence capture

Keep the log, the probe DLL's SHA-256 and commit, the side cache's SHA-256, the game version and the MO2 profile's `modlist.txt` in the session's experiment folder. Captures for P3, P4, P5 and P7 at face framing and close-up, same camera and light. ReShade, frame generation and upscaler settings noted as found; note them rather than changing them, and repeat P5 once with frame generation on if it is normally on.

## Friction log

Record every point of friction met in passing, as in every session: reload versus restart, how the preset was switched, anything the bridge could have done instead of the maintainer.

## After the sitting

P0–P2 passing confirms the trace. P5 passing is step (c) of the plan (the red tint) and unblocks step (d): compiling the real glint shader against the same inputs.
