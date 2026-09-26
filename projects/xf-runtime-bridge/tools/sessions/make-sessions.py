"""Generates the scripted in-game sessions session-2.json and session-3.json (tools/session.ts).

The JSON files are the scripts the runner reads; this generator keeps their repeated parts (pick a
preset at the mirror, confirm, photograph it in photo mode, return) consistent. Edit here, run
`python tools/sessions/make-sessions.py` from the project folder, and commit both.

Each script follows its test card step for step:
  session-2.json  experiments/020-session-2/README.md
  session-3.json  experiments/022-session-3/README.md
Selector indices assume the XF row lists Off (0) and then the collection's presets in order; the
first mirror step reads the row's values (player.appearance) so the coordinator can confirm that.
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


def ask(label, text):
    return {"do": "ask", "label": label, "text": text}


def wait(label, ms):
    return {"do": "wait", "label": label, "ms": ms}


def capture(label, region="full", **extra):
    step = {"do": "capture", "label": label}
    if region != "full":
        step["region"] = region
    step.update(extra)
    return step


def camera(label, **values):
    return {"do": "set camera", "label": label, **values}


def apply(label, index):
    return {"do": "apply cc", "label": label, "option": "XF", "index": index}


def wait_phase(label, phase, timeout=PLAYER):
    return run(label, "game.wait", {"phase": [phase], "timeout_ms": timeout})


def mirror_pick(prefix, index, settle=1500):
    return [apply(f"{prefix}-apply", index), wait(f"{prefix}-settle", settle), capture(f"{prefix}-mirror")]


def enter_photo(prefix, name):
    return [
        note(f"{prefix}-confirm", f"At the mirror: Confirm to keep XF = {name}, then leave the appearance screen. Nothing is saved."),
        wait_phase(f"{prefix}-wait-world", "gameplay"),
        run(f"{prefix}-photo", "photo.enter", continue_on_error=True),
        note(f"{prefix}-photo-key", "If photo mode didn't open by itself, press the photo mode key."),
        wait_phase(f"{prefix}-wait-photo", "photo_mode", 120000),
    ]


def shots(prefix, kinds, sweep=False, hide=True):
    steps = []
    for kind in kinds:
        steps += [camera(f"{prefix}-{kind}-camera", preset=kind)]
        if hide and not any(s.get("command") == "photo.hud.hide" for s in steps):
            steps += [run(f"{prefix}-hud", "photo.hud.hide")]
        steps += [wait(f"{prefix}-{kind}-settle", 800), capture(f"{prefix}-{kind}", "eyes" if kind == "eyes" else "face" if kind == "face" else "head-and-shoulders")]
    if sweep:
        for yaw in (150, 165, 195, 210):
            steps += [
                camera(f"{prefix}-yaw{yaw}-camera", preset="face", subject={"yaw": yaw}),
                wait(f"{prefix}-yaw{yaw}-settle", 600),
                capture(f"{prefix}-yaw{yaw}", "face"),
            ]
    return steps


def leave_photo(prefix):
    return [
        run(f"{prefix}-exit", "photo.exit"),
        note(f"{prefix}-back", "Open the mirror's appearance screen again (the page with the XF row)."),
        wait_phase(f"{prefix}-wait-mirror", "character_menu"),
    ]


def photo_loop(prefix, index, name, kinds, sweep=False, extra_in_photo=None):
    steps = mirror_pick(prefix, index) + enter_photo(prefix, name) + shots(prefix, kinds, sweep)
    steps += extra_in_photo or []
    return steps + leave_photo(prefix)


def preflight(save_text):
    return [
        run("p0-bridge", "bridge.info"),
        run("p0-status", "game.status"),
        ask("p0-ready", save_text),
        note("p0-mirror", "Open a mirror's appearance screen and go to the page with the XF row. Zoom its camera onto the face as far as it goes, then leave the camera alone until the mirror part ends."),
        wait_phase("p0-wait-mirror", "character_menu"),
    ]


SAVE = (
    "Before anything changes: (1) make a new manual save now. This profile shares your save folder, and once the bridge "
    "changes something, saving stays locked until you load a save. (2) Tell the coordinator the upscaler and mode, the "
    "resolution, and whether ray tracing or path tracing is on. (3) Stand next to a mirror, but don't open it yet."
)

# --- Session 2 (experiments/020-session-2/README.md) ---------------------------------------------
PRESETS2 = [
    (1, "depth-a", "Depth A · 0 mm control"),
    (2, "depth-b", "Depth B · +0.1 mm"),
    (3, "depth-c", "Depth C · +0.2 mm"),
    (4, "depth-d", "Depth D · +0.4 mm"),
    (5, "gloss-a", "Gloss A · as before"),
    (6, "gloss-b", "Gloss B · skin rough"),
    (7, "gloss-c", "Gloss C · all rough"),
    (8, "gloss-d", "Gloss D · rough +0.12"),
    (9, "shimmer", "Shimmer · strong"),
    (10, "metal", "Metal ramp · lifted"),
    (11, "lines-new", "Lines · new"),
    (12, "lines-old", "Lines · old"),
]
by_slug = {slug: (i, name) for i, slug, name in PRESETS2}

s2 = preflight(SAVE)
# Part 1: every preset at the mirror's fixed camera (card steps 1, 2 and a first look at 3, 5-7).
s2 += [
    run("p1-options", "player.appearance"),
    run("p1-xf-values", "player.appearance", {"option": "XF"}),
    capture("p1-xf-off"),
]
s2 += mirror_pick("p1-lines-new", 11) + mirror_pick("p1-lines-old", 12) + mirror_pick("p1-lines-new-again", 11)
s2 += [
    ask(
        "p1-placement",
        "Placement check (card step 2). Coordinator: compare p1-lines-new, p1-lines-old and p1-lines-new-again; the patterns must sit in exactly the same place, the new one sharper. If they don't line up, stop the session here. Maintainer: stay in the appearance screen.",
    )
]
for i, slug, name in PRESETS2[:10]:
    s2 += mirror_pick(f"p1-{slug}", i)
# Part 2: photo mode, one confirmed preset at a time (card steps 2-7).
s2 += [note("p2-start", "Photo-mode part: for each preset the bridge sets XF, you Confirm and leave the mirror, the bridge takes the photos, then you open the mirror again. About a minute each.")]
s2 += photo_loop("p2-lines-new", 11, by_slug["lines-new"][1], ["eyes"])
s2 += photo_loop("p2-lines-old", 12, by_slug["lines-old"][1], ["eyes"])
for slug in ("depth-a", "depth-b", "depth-c"):
    s2 += photo_loop(f"p2-{slug}", *by_slug[slug], ["eyes", "face"])
s2 += photo_loop("p2-depth-d", *by_slug["depth-d"], ["eyes", "face", "head-and-shoulders"])
s2 += [
    ask(
        "p2-depth-d-motion",
        "Depth D in motion (card step 4). In the appearance screen, zoom out to normal framing, watch a few blinks and rotate V slowly. Is there a visible edge or a lifted look? Also on D: does skin show through at the inner eye corners by the lash line? Tell the coordinator.",
    ),
    capture("p2-depth-d-motion-shot"),
]
for slug in ("gloss-a", "gloss-b", "gloss-c", "gloss-d"):
    s2 += photo_loop(f"p2-{slug}", *by_slug[slug], ["face"], sweep=True)
s2 += photo_loop("p2-shimmer", *by_slug["shimmer"], ["eyes", "face"], sweep=True)
s2 += photo_loop("p2-metal", *by_slug["metal"], ["face"], sweep=True)
s2 += [
    ask(
        "p2-verdicts",
        "Quick verdicts for the coordinator: which Depth is the smallest lift that stays solid; which Gloss reads most like four distinct finishes; does Shimmer flash as V turns and still differ from Satin at face distance; are the Metal ramp's angular highlights gone, and is there a seam along the lid?",
    )
]
# Part 3 (optional, card step 9): piercings and the heart eye, set by hand at the mirror.
s2 += [apply("p3-xf-off", 0), wait("p3-settle", 1500)]
for label, text in [
    ("p3-piercing-9-black", "Optional (card step 9): set piercing style 9 in black, same light, face close-up."),
    ("p3-piercing-1-silver", "Set piercing style 1 in silver."),
    ("p3-piercing-1-gold", "Set piercing style 1 in gold."),
    ("p3-eye-24", "Set eye colour 24 (the heart design)."),
]:
    s2 += [ask(label, text), capture(f"{label}-shot")]
s2 += [
    ask(
        "p4-wrap",
        "Done. Press Back in the appearance screen to discard the changes made there, then load the safety save to restore your usual look (loading also releases the bridge's save lock).",
    )
]

session2 = {
    "schema": "xfb/session-script-1",
    "name": "session-2",
    "title": "Session 2: depth, gloss, shimmer and texture placement",
    "card": "experiments/020-session-2/README.md",
    "requires": [
        "MO2 profile 'XF Studio diagnostic 2026-09-25' with XF Eye Artistry (session 2 build) and XF Runtime Bridge (-writes build)",
        "a loaded save with V in the world, next to a mirror",
        "a fresh manual safety save (step p0-ready)",
        "camera presets calibrated in the bridge's first session (tools/api/presets.ts)",
    ],
    "steps": s2,
    "restore": [run("restore-photo-exit", "photo.exit", continue_on_error=True)],
}

# --- Session 3 (experiments/022-session-3/README.md) ---------------------------------------------
GLITTER = {"a": (1, "Glitter A · base"), "b": (2, "Glitter B · mips"), "c": (3, "Glitter C · size"), "d": (4, "Glitter D · surface"), "e": (5, "Glitter E · accent"), "f": (6, "Glitter F · tilt")}
EFFECTS = "In photo mode, turn film grain, chromatic aberration and depth of field off if they're on (the bridge doesn't know their menu keys yet)."


def glitter_loop(slug, kinds, sweep=False, extra=None, before_photo=None, after_photo=None):
    index, name = GLITTER[slug]
    prefix = f"a-{slug}"
    steps = mirror_pick(prefix, index) + enter_photo(prefix, name)
    steps = steps[:-3] + before_photo + steps[-3:] if before_photo else steps
    steps += [ask(f"{prefix}-effects", EFFECTS)] + shots(prefix, kinds, sweep) + (extra or [])
    steps += [run(f"{prefix}-exit", "photo.exit")] + (after_photo or [])
    steps += [note(f"{prefix}-back", "Open the mirror's appearance screen again (the page with the XF row)."), wait_phase(f"{prefix}-wait-mirror", "character_menu")]
    return steps


def fov_ramp(prefix, fovs):
    steps = []
    for fov in fovs:
        steps += [camera(f"{prefix}-fov{fov}-camera", preset="face", fov=fov), wait(f"{prefix}-fov{fov}-settle", 600), capture(f"{prefix}-fov{fov}", "head-and-shoulders")]
    return steps


s3 = preflight(SAVE.replace("Stand next to a mirror", "Check that the XF selector lists Off plus six Glitter presets. Stand next to a mirror"))
# Part A: the Glitter board (experiment 021 test card, steps 1-9).
s3 += [run("a-xf-values", "player.appearance", {"option": "XF"}), capture("a-xf-off")]
for slug in "abcdef":
    s3 += mirror_pick(f"a-mirror-{slug}", GLITTER[slug][0])
s3 += glitter_loop("a", ["eyes", "face", "head-and-shoulders"], sweep=True)
s3 += glitter_loop("b", ["eyes"], extra=fov_ramp("a-b", [6, 9, 12, 15, 20, 30]))
s3 += glitter_loop(
    "c",
    ["eyes", "face"],
    extra=[
        run("a-c-exit-for-dlaa", "photo.exit"),
        ask("a-c-dlaa", "Card step 5: switch the upscaler to DLAA (or its highest-quality mode) in the graphics settings, then come back to the world."),
        wait_phase("a-c-wait-world-dlaa", "gameplay"),
        run("a-c-photo-dlaa", "photo.enter", continue_on_error=True),
        wait_phase("a-c-wait-photo-dlaa", "photo_mode", 120000),
        ask("a-c-effects-dlaa", EFFECTS),
    ]
    + [dict(s, label=s["label"].replace("a-c-", "a-c-dlaa-")) for s in shots("a-c", ["eyes", "face"])],
    after_photo=[ask("a-c-dlaa-undo", "Set the upscaler back to how it was.")],
)
s3 += glitter_loop("d", ["eyes"], sweep=True)
s3 += glitter_loop("f", ["eyes"], sweep=True)
s3 += glitter_loop(
    "e",
    ["face"],
    before_photo=[run("a-e-night", "world.time.set", {"hours": 23, "minutes": 30})],
    extra=[ask("a-e-dark", "Card step 7: is the accent still visible at night? Does it bloom? Would it be acceptable as a labelled stylised option?")],
    after_photo=[run("a-e-noon", "world.time.set", {"hours": 12, "minutes": 0}, continue_on_error=True)],
)
s3 += mirror_pick("a-clear-e", 5) + mirror_pick("a-clear-a", 1) + mirror_pick("a-clear-off", 0)
s3 += [
    ask("a-motion", "Card step 8: with Glitter A (set it again if needed), watch a blink and turn V slowly. Did the E → A → Off switch leave any glowing points behind?"),
    ask("a-winterkissed", "Optional card step 9: only if Winterkissed is already enabled, equip Golden Girl for a reference close-up (don't change the mod list for this). Otherwise skip."),
    capture("a-winterkissed-shot"),
]
# Part B: blink (by hand; the bridge photographs).
for label, text in [
    ("b-shape-01", "Part B: set eye shape 01, close V's eyes (a closed-eyes photo-mode expression, or a blink in the creator), frontal close-up."),
    ("b-shape-10", "Eye shape 10, eyes closed, same framing."),
    ("b-shape-12", "Eye shape 12, eyes closed, same framing."),
    ("b-shape-h011", "The eye shape that uses morph h011, eyes closed."),
    ("b-makeup-closed", "Eye shape 12 with an XF look covering the upper lid, eyes closed: does bare skin show between the crease and the lashes?"),
]:
    s3 += [ask(label, text), capture(f"{label}-shot")]
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
    s3 += [ask(label, text), capture(f"{label}-shot")]
s3 += [ask("c-creator-rows", "Step 6 needs a new game's body page; note the rows in order and any unlabelled row the next time a new game is started. Skip it here.")]
# Part D: expressions through the bridge instead of the CET console.
s3 += [
    note("d-start", "Part D (optional): leave the mirror with Back, stand in the world."),
    wait_phase("d-wait-world", "gameplay"),
    run("d-photo", "photo.enter", continue_on_error=True),
    wait_phase("d-wait-photo", "photo_mode", 120000),
    run("d-menu", "photo.state", {"options": True}),
    ask("d-neutral", "Set expression Neutral and look-at off in the photo-mode menu."),
    camera("d-face-camera", preset="face"),
    run("d-hud", "photo.hud.hide"),
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
    run("d-hud-show", "photo.hud.hide", {"hidden": False}),
    ask("d-menu-sleeping", "Pick Static: Sleeping from the photo-mode expression menu yourself."),
    run("d-hud-again", "photo.hud.hide"),
    wait("d-sleeping-settle", 800),
    capture("d-menu-sleeping-shot", "face"),
    run("d-menu-after", "photo.state", {"options": True}),
    note("d-cet", "R1 (which facial setup photo mode uses) and XF.graph() still need the CET console lines on the session 3 card; they are optional."),
    run("d-exit", "photo.exit"),
    ask("wrap", "Done. Load the safety save to restore your usual look, the time of day and the save lock."),
]

session3 = {
    "schema": "xfb/session-script-1",
    "name": "session-3",
    "title": "Session 3: Glitter board, blink and creator checks",
    "card": "experiments/022-session-3/README.md",
    "requires": [
        "MO2 profile 'XF Studio diagnostic 2026-09-25' with XF Eye Artistry (the experiment 021 Glitter board) and XF Runtime Bridge (-writes build)",
        "a loaded save with V in the world, next to a mirror",
        "a fresh manual safety save (step p0-ready)",
        "session 2 done through the bridge (camera presets calibrated)",
    ],
    "steps": s3,
    "restore": [run("restore-photo-exit", "photo.exit", continue_on_error=True)],
}

for name, data in (("session-2.json", session2), ("session-3.json", session3)):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(name, len(data["steps"]), "steps")
