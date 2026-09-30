# Handoff: XF Runtime Bridge 0.7 (`claude/bridge-070`)

Built and tested offline only; nothing staged into MO2 or the game. Merge when reviewed; the session-8 card proves it in game.

## What's on the branch

- **Hook inventory:** `research/runtime/bridge-hook-inventory.md` (27 ranked items plus session 7's fixes; what 0.7 builds and what waits).
- **Session 7's findings #1-15** (coordinator messages and `experiments/035-session-7` §3-4): world-object rule after the door crash (`knowledge/game-crashes.md` §2.4: `exe+0x60a893` is a script `String + String` with a null right operand), busy by scene tiers and dialogue (merged both hot fixes from `main`), in-game answers (ink panel keys F6/F7/F8/F11 via Codeware's `Input/Key`, CET window buttons and a comment box, `session.wait`), 600-character messages with the newest question pinned, the ink panel placed from its layer's own size and clamped, `eyes_on_screen` checked against the camera, `capture.sheet {sweep}`, `showroom.light {rig: "none"}` without a manifest, Equipment-EX version from its global function plus a precise refusal and an explicit outfit slot, `photo.frame` reseats a far drone camera (preset 1), pins as quest dynamic mappins at exact points, showroom free space (`world.probe` clearance and sight line), `psm_detail` locomotion and `on_ground`, a look behaviour ends on the player's input. RB-93..95 fixed.
- **New hooks:** `cyberware.state/equip/unequip`, `player.action weapon.arms`, `world.state`, `world.probe`, `world.weather.set`, `ui.state`, `game.saves`, `photo.scene.set`, `overlay.state` (+ internal `overlay.hide`), `session.wait`. Natives now 18 (`XFBridge_Answer`, `XFBridge_Comment`, `XFBridge_CetOverlay`).
- **ImGui overlay host P0:** `plugin/Overlay.cpp`, `core/overlay/{Host,Theme}.*`; off by default, on in the -diagnostic and -writes packages; draw-only diagnostic panel; refused in HDR; captures hide it; yields to CET; pass-through, never unhooks. The DX12 backend's one `CreateDXGIFactory1` call is answered with the game swap chain's own factory (no dxgi.dll import). Theme generated from `studio.css` by `tools/overlay/theme.ts` (dark default, light via `[overlay] theme`); a test fails on drift.
- **Docs:** design §3.7 and §4/§7 rows, README, test card (session-8 card, about 40 min, groups A-J; build record), knowledge (`game-crashes`, `runtime-access` §5.1, `player-control`, `ink-ui` §8), credits (Dear ImGui now a dependency; CET, RED4ext, Codeware), `THIRD_PARTY_NOTICES.txt` (Dear ImGui), code-health RB-93..95 marked fixed.

## Verification

`xfb_selftest --unit` UNIT OK; self-test 516/516; `bun test tools` 293 pass, 4 skip (opt-in on-screen captures), 0 fail; typecheck; Lua lint; redscript lint in the three configurations (no Codeware; Codeware; Codeware + Equipment-EX stub + TweakXL) against a copy of the 2.31 bundle (`2119046f…`); links and private paths clean. Zip hashes: the test card's "Build record (bridge 0.7.0, branch build, not staged)".

## For the coordinator

- **UI/UX review needed** (AGENTS.md): the CET window's new question buttons, comment box and theme, the ink panel's answer line, and the overlay's diagnostic panel. The token-to-ImGui mapping (`MAPPING` in `tools/overlay/theme.ts`) is a design decision for the UI component track; nothing in the Studio's component library or style guide was edited. No in-game captures exist yet (session 8, groups A and I).
- **Code-health ledger:** record the overlay host as a new subsystem (render-thread native code) after the merge; a deep review is probably due (`tools/review_due.py`).
- **Not built (see the inventory):** the lighting mirror (needs a host `.ent` archive), the input channel (waits for session 7's `input.probe` record), overlay P1 interact mode, NPC spawning, face controls, HUD hiding, native photo-mode entry.
- **Evidence limits:** everything is offline; which native left the null in the door crash is a hypothesis; whether `OnSaveMetadataReady` fires outside the Load menu, whether camera input reaches listeners during the game's look-at, and the overlay's behaviour with frame generation are session-8 questions.
