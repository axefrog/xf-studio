"""Generates the scripted in-game sessions session-2.json and session-3.json (tools/session.ts).

The JSON files are the scripts the runner reads; this generator keeps their repeated parts
consistent. Edit here, run `python tools/sessions/make-sessions.py` from the project folder, and
commit the generator and both scripts.

The flow is the one the first bridge session proved (26 September 2026), with what the bridge can
now do itself:
  - the player opens the character creator (a mirror, or F12 with Character Customization Anywhere);
    that is still an `ask`, marked `replaced_by: cc.open` for when the bridge can open it;
  - the bridge sets the XF row (cc.apply), photographs the creator's eyes zoom, and presses Confirm
    (cc.confirm; allowed in the test profile's -writes build). If Confirm is refused (a creator
    opened in new-game mode), a note asks the player to press it, and game.wait follows;
  - the bridge opens photo mode with the player's own photo-mode key (photo.open, approved for the
    test profile); if that doesn't work, a note asks the player to press the key;
  - in photo mode the bridge turns off film grain and chromatic aberration, switches light 1 on,
    frames V with photo.frame (an XF camera preset, then fine adjustment; no hand-tuned offsets),
    hides the menu and the mouse cursor, captures, runs a light sweep by turning V with look-at off
    (the light itself can't be moved yet), shows the menu again and leaves photo mode.
Each script ends by asking the player to load the safety save, which undoes the kept looks and
releases the save lock.

Each script follows its test card:
  session-2.json  experiments/020-session-2/README.md (the parts still open after 26 September)
  session-3.json  experiments/022-session-3/README.md
Selector indices assume the XF row lists Off (0) and then the collection's presets in order; the
first creator visit reads the row's values (player.appearance) so the coordinator can confirm that.
"""

import json, os

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
PLAYER = 600000  # ten minutes for anything the player does


def run(label, command, input=None, **extra):
    step = {"do": "run", "label": label, "command": command}
    if input:
        step["input"] = input
    step.update(extra)
    return step


def note(label, text):
    return {"do": "note", "label": label, "text": text}


def ask(label, text, replaced_by=None):
    step = {"do": "ask", "label": label, "text": text}
    if replaced_by:
        step["replaced_by"] = replaced_by
    return step


def wait(label, ms):
    return {"do": "wait", "label": label, "ms": ms}


def capture(label, region="full", **extra):
    step = {"do": "capture", "label": label}
    if region != "full":
        step["region"] = region
    step.update(extra)
    return step


def burst(label, region, frames, interval_ms, **extra):
    return {"do": "burst", "label": label, "region": region, "frames": frames, "interval_ms": interval_ms, **extra}


def frame(label, target, **values):
    return {"do": "frame", "label": label, "target": target, **values}


def apply(label, index):
    return {"do": "apply cc", "label": label, "option": "XF", "index": index}


def wait_phase(label, phase, timeout=PLAYER):
    return run(label, "game.wait", {"phase": [phase], "timeout_ms": timeout})


REGION = {"eyes": "eyes", "face": "face", "head-and-shoulders": "head-and-shoulders"}

# --- the repeated parts ------------------------------------------------------------------------


def open_creator(prefix, first=False):
    text = "Open the character creator (a mirror's appearance screen, or F12 with Character Customization Anywhere) and go to the page with the XF row. Leave its camera on the eyes zoom."
    if not first:
        text = "Open the character creator again (mirror or F12) and go to the XF row."
    return [ask(f"{prefix}-open-creator", text, replaced_by="cc.open"), wait_phase(f"{prefix}-wait-creator", "character_menu")]


def creator_pick(prefix, index, settle=1500):
    # The creator's own eyes zoom, photographed as a bonus view under its fixed light.
    return [apply(f"{prefix}-apply", index), wait(f"{prefix}-settle", settle), capture(f"{prefix}-creator", "cc-eyes")]


def confirm_creator(prefix):
    return [
        run(f"{prefix}-confirm", "cc.confirm", continue_on_error=True),
        note(f"{prefix}-confirm-fallback", "If the creator is still open, press Confirm yourself (the look is kept until the safety save is loaded)."),
        wait_phase(f"{prefix}-wait-world", "gameplay"),
    ]


def enter_photo(prefix):
    return [
        run(f"{prefix}-photo", "photo.open", continue_on_error=True),
        note(f"{prefix}-photo-fallback", "If photo mode didn't open by itself, press the photo mode key."),
        wait_phase(f"{prefix}-wait-photo", "photo_mode", 120000),
        # Photo Mode Preferences (enabled in the test profile) re-applies its saved settings over
        # several frames after photo mode opens; give it 2 s before the first change.
        wait(f"{prefix}-prefs", 2000),
        run(f"{prefix}-effects", "photo.camera.set", {"grain": 0, "chromatic_aberration": 0}, continue_on_error=True),
        # Lights start off every time photo mode opens: switch light 1 on as a warm key light.
        run(f"{prefix}-light", "photo.light.set", {"light": 1, "on": True, "type": "spot", "brightness": 60, "hue": 35, "saturation": 15}),
    ]


def shots(prefix, kinds, sweep=False, hide=True):
    steps = []
    for i, kind in enumerate(kinds):
        # look_at off keeps V's head turning with the body, for the sweep and a steady framing.
        steps += [frame(f"{prefix}-{kind}-frame", kind, xf_preset=True, **({"look_at": "off"} if i == 0 else {}))]
        if hide and i == 0:
            steps += [run(f"{prefix}-hud", "photo.hud.hide", {"hidden": True, "cursor": True})]
        steps += [wait(f"{prefix}-{kind}-settle", 800), capture(f"{prefix}-{kind}", REGION[kind])]
    if sweep:
        # A light sweep with a light that can't move: V turns in 15-degree steps either side of
        # facing the camera (look-at off), re-framed each time, so the light meets the face from
        # changing directions.
        for yaw in (-30, -15, 15, 30):
            steps += [
                frame(f"{prefix}-yaw{yaw}-frame", "face", yaw_offset=yaw),
                wait(f"{prefix}-yaw{yaw}-settle", 600),
                capture(f"{prefix}-yaw{yaw}", "face"),
            ]
        steps += [frame(f"{prefix}-yaw0-frame", "face", yaw_offset=0)]
    return steps


def leave_photo(prefix):
    return [run(f"{prefix}-hud-show", "photo.hud.hide", {"hidden": False, "cursor": True}, continue_on_error=True), run(f"{prefix}-exit", "photo.exit")]


def preset_loop(prefix, index, kinds, sweep=False, extra_in_photo=None, first=False):
    steps = open_creator(prefix, first) + creator_pick(prefix, index) + confirm_creator(prefix) + enter_photo(prefix) + shots(prefix, kinds, sweep)
    steps += extra_in_photo or []
    return steps + leave_photo(prefix)


def preflight(save_text):
    return [
        run("p0-bridge", "bridge.info"),
        run("p0-status", "game.status"),
        ask("p0-ready", save_text),
    ]


SAVE = (
    "Before anything changes: (1) make a new manual save now. This profile shares your save folder, and once the bridge "
    "changes something, saving stays locked until you load a save. (2) Tell the coordinator the game version, the upscaler "
    "and mode, the resolution, and whether ray tracing or path tracing is on. (3) Stand V in an open, quiet spot with room in "
    "front of her (photo mode's camera needs a few metres); keep the game window in front."
)

# --- Session 2, the parts still open (experiments/020-session-2/README.md) ----------------------
PRESETS2 = {
    "depth-c": (3, "Depth C · +0.2 mm"),
    "depth-d": (4, "Depth D · +0.4 mm"),
    "gloss-a": (5, "Gloss A · as before"),
    "gloss-b": (6, "Gloss B · skin rough"),
    "gloss-c": (7, "Gloss C · all rough"),
    "gloss-d": (8, "Gloss D · rough +0.12"),
    "shimmer": (9, "Shimmer · strong"),
    "metal": (10, "Metal ramp · lifted"),
    "lines-new": (11, "Lines · new"),
    "lines-old": (12, "Lines · old"),
}

s2 = preflight(SAVE)
# Part 1: Gloss A-D, Shimmer and Metal under a light sweep (card steps 5-7, still open). The first
# creator visit also reads how the creator was opened and the XF row's values.
s2 += open_creator("p1-gloss-a", first=True)
s2 += [
    run("p1-menu-mode", "player.appearance", {"option": "XF"}),
    capture("p1-xf-off", "cc-eyes"),
    note("p1-menu-mode-note", "Coordinator: the p1-menu-mode result's menu.updating_finalized_state must be true (the edit-V's-look mode) for cc.confirm to keep a look; with false, Confirm is refused and the player confirms by hand."),
]
s2 += creator_pick("p1-gloss-a", PRESETS2["gloss-a"][0]) + confirm_creator("p1-gloss-a") + enter_photo("p1-gloss-a") + shots("p1-gloss-a", ["face"], sweep=True) + leave_photo("p1-gloss-a")
s2 += [
    ask(
        "p1-check",
        "Coordinator check before going on: in p1-gloss-a-face the face is centred and fills the face crop, no mouse cursor is visible, and the sweep captures show the light moving across the face. If not, stop and note what's wrong. Maintainer: nothing to do.",
    )
]
for slug in ("gloss-b", "gloss-c", "gloss-d"):
    s2 += preset_loop(f"p1-{slug}", PRESETS2[slug][0], ["face"], sweep=True)
s2 += preset_loop(
    "p1-shimmer",
    PRESETS2["shimmer"][0],
    ["eyes", "face"],
    sweep=True,
    # A short burst at the eyes framing: a still scene should give near-zero frame differences, so
    # any sparkle that changes without movement shows as a spike.
    extra_in_photo=[frame("p1-shimmer-burst-frame", "eyes"), wait("p1-shimmer-burst-settle", 600), burst("p1-shimmer-burst", "eyes", 10, 100)],
)
s2 += preset_loop("p1-metal", PRESETS2["metal"][0], ["face"], sweep=True)
# Part 2: Depth C at the extreme close-up (not repeated on 26 September), Depth D in motion (card
# step 4) and the Lines sharpness at the new texture density (card step 2, not established).
s2 += preset_loop("p2-depth-c", PRESETS2["depth-c"][0], ["eyes"], extra_in_photo=[frame("p2-depth-c-close-frame", "eyes", span_m=0.08), wait("p2-depth-c-close-settle", 800), burst("p2-depth-c-close", "eyes", 5, 200)])
s2 += open_creator("p2-depth-d") + creator_pick("p2-depth-d", PRESETS2["depth-d"][0])
s2 += [
    # The creator animates V (blinks, small head moves): a burst catches edges or a lifted look in motion.
    burst("p2-depth-d-motion", "cc-eyes", 20, 150),
    ask(
        "p2-depth-d-motion-check",
        "Depth D in motion (card step 4): in the creator, zoom out to normal framing, watch a few blinks and rotate V slowly. Is there a visible edge or a lifted look? Does skin show through at the inner eye corners by the lash line? Tell the coordinator, then zoom back to the eyes.",
    ),
]
s2 += creator_pick("p2-lines-new", PRESETS2["lines-new"][0]) + confirm_creator("p2-lines-new") + enter_photo("p2-lines-new")
s2 += shots("p2-lines-new", ["eyes"]) + [frame("p2-lines-new-close-frame", "eyes", span_m=0.08), wait("p2-lines-new-close-settle", 800), capture("p2-lines-new-close", "eyes")]
s2 += leave_photo("p2-lines-new")
s2 += preset_loop("p2-lines-old", PRESETS2["lines-old"][0], ["eyes"], extra_in_photo=[frame("p2-lines-old-close-frame", "eyes", span_m=0.08), wait("p2-lines-old-close-settle", 800), capture("p2-lines-old-close", "eyes")])
s2 += [
    ask(
        "p2-verdicts",
        "Quick verdicts for the coordinator: which Gloss reads most like four distinct finishes; does Shimmer flash as V turns and still differ from Satin at face distance; are the Metal ramp's angular highlights gone, and is there a seam along the lid; is Lines · new sharper than Lines · old close up?",
    )
]
# Part 3 (optional, card step 9): piercings and the heart eye, set by hand in the creator.
s2 += open_creator("p3") + [apply("p3-xf-off", 0), wait("p3-settle", 1500)]
for label, text in [
    ("p3-piercing-9-black", "Optional (card step 9): set piercing style 9 in black; the bridge photographs the creator's eyes zoom."),
    ("p3-piercing-1-silver", "Set piercing style 1 in silver."),
    ("p3-piercing-1-gold", "Set piercing style 1 in gold."),
    ("p3-eye-24", "Set eye colour 24 (the heart design)."),
]:
    s2 += [ask(label, text), capture(f"{label}-shot", "cc-eyes"), capture(f"{label}-shot-full")]
s2 += [run("p4-back", "cc.back", continue_on_error=True)]
s2 += [
    ask(
        "p4-wrap",
        "Done. If the creator is still open, press Back. Then load the safety save: it restores your usual look and releases the bridge's save lock.",
    )
]

session2 = {
    "schema": "xfb/session-script-1",
    "name": "session-2",
    "title": "Session 2 (continued): gloss, shimmer and metal under a light sweep; depth in motion; lines sharpness",
    "card": "experiments/020-session-2/README.md",
    "requires": [
        "MO2 profile 'XF Studio diagnostic 2026-09-25' with XF Eye Artistry (session 2 build) and XF Runtime Bridge (-writes build of this commit, with its XF camera presets)",
        "a loaded save with V in the world, in an open spot",
        "a fresh manual safety save (step p0-ready)",
        "the game window in front (photo.open presses the photo-mode key in it)",
    ],
    "steps": s2,
    "restore": [
        run("restore-hud", "photo.hud.hide", {"hidden": False, "cursor": True}, continue_on_error=True),
        run("restore-photo-exit", "photo.exit", continue_on_error=True),
    ],
}

# --- Session 3 (experiments/022-session-3/README.md) ---------------------------------------------
GLITTER = {"a": (1, "Glitter A · base"), "b": (2, "Glitter B · mips"), "c": (3, "Glitter C · size"), "d": (4, "Glitter D · surface"), "e": (5, "Glitter E · accent"), "f": (6, "Glitter F · tilt")}


def fov_ramp(prefix, spans):
    # Card step 3 (mips): the same eyes at growing distance, by widening the framing's span.
    steps = []
    for span in spans:
        tag = str(span).replace(".", "p")
        steps += [frame(f"{prefix}-span{tag}-frame", "eyes", span_m=span), wait(f"{prefix}-span{tag}-settle", 600), capture(f"{prefix}-span{tag}", "head-and-shoulders")]
    return steps


def glitter_loop(slug, kinds, sweep=False, extra=None, before_photo=None, after_photo=None, first=False):
    index, _ = GLITTER[slug]
    prefix = f"a-{slug}"
    steps = open_creator(prefix, first) + creator_pick(prefix, index) + confirm_creator(prefix) + (before_photo or []) + enter_photo(prefix)
    steps += shots(prefix, kinds, sweep) + (extra or []) + leave_photo(prefix) + (after_photo or [])
    return steps


s3 = preflight(SAVE.replace("(3) Stand V", "(3) Check that the XF selector lists Off plus six Glitter presets. Stand V"))
# Part A: the Glitter board (experiment 021 test card, steps 1-9).
s3 += open_creator("a-first", first=True) + [run("a-xf-values", "player.appearance", {"option": "XF"}), capture("a-xf-off", "cc-eyes")]
for slug in "abcdef":
    s3 += creator_pick(f"a-creator-{slug}", GLITTER[slug][0])
s3 += creator_pick("a-a", GLITTER["a"][0]) + confirm_creator("a-a") + enter_photo("a-a") + shots("a-a", ["eyes", "face", "head-and-shoulders"], sweep=True) + leave_photo("a-a")
s3 += glitter_loop("b", ["eyes"], extra=fov_ramp("a-b", [0.1, 0.2, 0.3, 0.45, 0.6, 0.9]))
s3 += glitter_loop(
    "c",
    ["eyes", "face"],
    extra=[
        run("a-c-exit-for-dlaa", "photo.exit"),
        ask("a-c-dlaa", "Card step 5: switch the upscaler to DLAA (or its highest-quality mode) in the graphics settings, then come back to the world."),
        wait_phase("a-c-wait-world-dlaa", "gameplay"),
        *enter_photo("a-c-dlaa"),
    ]
    + [dict(s, label=s["label"].replace("a-c-", "a-c-dlaa-")) for s in shots("a-c", ["eyes", "face"])],
    after_photo=[ask("a-c-dlaa-undo", "Set the upscaler back to how it was.")],
)
s3 += glitter_loop("d", ["eyes"], sweep=True)
s3 += glitter_loop("f", ["eyes"], sweep=True, extra=[frame("a-f-burst-frame", "eyes"), wait("a-f-burst-settle", 600), burst("a-f-burst", "eyes", 10, 100)])
s3 += glitter_loop(
    "e",
    ["face"],
    before_photo=[run("a-e-night", "world.time.set", {"hours": 23, "minutes": 30})],
    extra=[ask("a-e-dark", "Card step 7: is the accent still visible at night? Does it bloom? Would it be acceptable as a labelled stylised option?")],
    after_photo=[run("a-e-noon", "world.time.set", {"hours": 12, "minutes": 0}, continue_on_error=True)],
)
s3 += open_creator("a-clear") + creator_pick("a-clear-e", 5) + creator_pick("a-clear-a", 1) + creator_pick("a-clear-off", 0)
s3 += [
    burst("a-motion-burst", "cc-eyes", 20, 150),
    ask("a-motion", "Card step 8: with Glitter A (set it again if needed), watch a blink and turn V slowly. Did the E → A → Off switch leave any glowing points behind?"),
    ask("a-winterkissed", "Optional card step 9: only if Winterkissed is already enabled, equip Golden Girl for a reference close-up (don't change the mod list for this). Otherwise skip."),
    capture("a-winterkissed-shot", "cc-eyes"),
]
# Part B: blink (by hand in the creator; the bridge photographs).
for label, text in [
    ("b-shape-01", "Part B: set eye shape 01 and catch V's eyes closed in a blink (the bridge takes a burst next)."),
    ("b-shape-10", "Eye shape 10."),
    ("b-shape-12", "Eye shape 12."),
    ("b-shape-h011", "The eye shape that uses morph h011."),
    ("b-makeup-closed", "Eye shape 12 with an XF look covering the upper lid: does bare skin show between the crease and the lashes when the eyes close?"),
]:
    s3 += [ask(label, text), burst(f"{label}-burst", "cc-eyes", 12, 120)]
# Part C: creator and piercings (by hand).
for label, text in [
    ("c-legacy-off", "Part C step 4 (needs the legacy build on the reference character; otherwise skip): set every legacy XF layer row, lipstick and blush to Off. Does anything remain drawn?"),
    ("c-hair-5", "Step 5: pick hairstyle 5 without face cyberware."),
    ("c-hair-cyberware", "Now pick a face cyberware that swaps the hairstyle row to its cyberware variant. Is it the same hair?"),
    ("c-piercing-9-black", "Step 7 (if not done in session 2): piercing style 9 in black."),
    ("c-piercing-1-silver", "Piercing style 1 in silver."),
    ("c-piercing-1-gold", "Piercing style 1 in gold."),
    ("c-eye-24", "Eye colour 24."),
]:
    s3 += [ask(label, text), capture(f"{label}-shot", "cc-eyes"), capture(f"{label}-shot-full")]
s3 += [ask("c-creator-rows", "Step 6 needs a new game's body page; note the rows in order and any unlabelled row the next time a new game is started. Skip it here.")]
s3 += [run("c-back", "cc.back", continue_on_error=True), note("c-back-fallback", "If the creator is still open, press Back and confirm."), wait_phase("c-wait-world", "gameplay")]
# Part D: expressions through the bridge instead of the CET console.
s3 += [
    note("d-start", "Part D (optional): photo mode for expressions."),
    *enter_photo("d"),
    run("d-menu", "photo.state", {"options": True}),
    run("d-neutral", "photo.expression.set", {"faceId": 0}, continue_on_error=True),
    frame("d-face-frame", "face", xf_preset=True, look_at="off"),
    run("d-hud", "photo.hud.hide", {"hidden": True, "cursor": True}),
    wait("d-settle", 800),
    capture("d-neutral-face", "face"),
    run("d-face-9", "photo.expression.set", {"faceId": 9}),
    wait("d-face-9-settle", 2000),
    capture("d-face-9-shot", "face"),
    run("d-face-60", "photo.expression.set", {"faceId": 60}),
    wait("d-face-60-settle", 2000),
    capture("d-face-60-shot", "face"),
    run("d-face-217", "photo.expression.set", {"faceId": 217}, continue_on_error=True),
    wait("d-face-217-settle", 2000),
    capture("d-face-217-shot", "face"),
    run("d-hud-show-for-menu", "photo.hud.hide", {"hidden": False, "cursor": True}),
    ask("d-menu-sleeping", "Pick Static: Sleeping from the photo-mode expression menu yourself."),
    run("d-hud-again", "photo.hud.hide", {"hidden": True, "cursor": True}),
    wait("d-sleeping-settle", 800),
    capture("d-menu-sleeping-shot", "face"),
    run("d-menu-after", "photo.state", {"options": True}),
    note("d-cet", "R1 (which facial setup photo mode uses) and XF.graph() still need the CET console lines on the session 3 card; they are optional."),
    *leave_photo("d"),
    ask("wrap", "Done. Load the safety save: it restores your usual look, the time of day and the save lock."),
]

session3 = {
    "schema": "xfb/session-script-1",
    "name": "session-3",
    "title": "Session 3: Glitter board, blink and creator checks",
    "card": "experiments/022-session-3/README.md",
    "requires": [
        "MO2 profile 'XF Studio diagnostic 2026-09-25' with XF Eye Artistry (the experiment 021 Glitter board) and XF Runtime Bridge (-writes build, with its XF camera presets)",
        "a loaded save with V in the world, in an open spot",
        "a fresh manual safety save (step p0-ready)",
        "the game window in front (photo.open presses the photo-mode key in it)",
    ],
    "steps": s3,
    "restore": [
        run("restore-hud", "photo.hud.hide", {"hidden": False, "cursor": True}, continue_on_error=True),
        run("restore-photo-exit", "photo.exit", continue_on_error=True),
    ],
}

for name, data in (("session-2.json", session2), ("session-3.json", session3)):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    asks = sum(1 for s in data["steps"] if s["do"] == "ask")
    print(name, len(data["steps"]), "steps,", asks, "asks")
