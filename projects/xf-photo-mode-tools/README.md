# XF Photo Mode Tools

Status: second independent project, awaiting Eye Artistry's first completion milestone. New work belongs here.

Legacy reference: `D:/Dev/xf-photo-mode-tools/bin/x64/plugins/cyber_engine_tweaks/mods/photo_mode_tools/init.lua` (four callbacks). It sets `LookAt/MaxIterationsCount` to 1.0 on initialization, toggles 0.9/1.0 for freeze, and hard-codes 3.0 on restore/shutdown. The effect is global, not limited to the photo-mode actor. There is no photo-mode-exit restore or original-value capture. README documents global side effects.

Rebuild from behavior requirements, not by copying those callbacks unchanged. First investigate actor-scoped alternatives, restoration on photo mode/session transitions, original-setting preservation and compatibility with PhotoMode-EX/AMM/pose tools. A hard-coded engine setting is not evidence of a stable public contract.

Useful references: `D:/Dev/cp2077-photomode-ex`, `cp2077-codeware`, `cp2077-cet-kit`, `appearancemenumod`, `CP77_nativeSettings`, and MO2 photo/pose/camera categories. Earlier ideas about saved lighting/poses, browser/annotation tools and more save slots remain background possibilities, not an approved first-release scope.

Use the same project-local `src`, `data`, `resources`, `build`, `dist` layout as Eye Artistry when implementation begins. No shared all-in-one toolbox is required.
