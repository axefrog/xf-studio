# Experiment 027: lip sync from audio and a transcript (proof of concept)

**27 September 2026. Offline only; no game launch, nothing installed, no audio committed.** Question: can open tools plus our own rules produce a clip in the game's lip-sync channel whose solved motion looks like the game's own? Facts it rests on: [lip sync](../../knowledge/lipsync.md). Plan it feeds: [lip-sync design](../../research/animation/lipsync-design.md).

## Inputs (all local, none committed)

| Input | Where it came from |
|---|---|
| A 6.0 s English line, 16 kHz mono WAV | Windows speech synthesis (`System.Speech`, the default desktop voice) speaking a line written for the test. Synthetic, made on this machine; not a game voice and not a real person's voice |
| Its transcript | The same text, given to Rhubarb as `--dialogFile` |
| Phone timing | Rhubarb Lip Sync 1.14.0 (`D:/Dev/tools/rhubarb/1.14.0/`, MIT), `-r pocketSphinx --extendedShapes GHX --logLevel Debug`: the log's `##phone[a-b]: X` lines, 40 ARPAbet phones. It guessed a pronunciation for one slang word |
| Rig, facial setup | The female basehead skeleton and facial setup in the local idle intake (`research/consumers/cc-idle/json/`, see [CC idle](../../research/animation/cc-idle.md)) |
| Solver | The pinned, unmodified IO Suite facial solver (`7a4ee793`), loaded as the Studio's bakes load it |
| Comparison | Two clips of V's English lip-sync set for `q004_04b_after_tutorial` (serialised privately with WolvenKit CLI 9.0.1), decoded to float tracks |

## Method

[`lipsync_poc.py`](lipsync_poc.py), our own code:

1. **Visemes.** Each phone maps to one of 17 viseme targets written over the game's control names (jaw open, lips together, lower-lip suck, purse, funnel, stretch, corner stretch, corner up, upper raise, tongue lift, base up and back, tip up). The table is a design choice, tuned only against the numbers below.
2. **JALI-style timing and strength.** Onset 120 ms before the sound (150 ms for lip-heavy phones), apex held to 75 % of the phone, then decay; bilabials always close, and narrow the jaw their neighbours open; tongue-only phones add no lip shape. Jaw (JA) and lip (LI) strength per phone from its intensity (vowels) or its high-frequency energy (consonants), compared within its class. Controls combine by maximum.
3. **The game's channel.** The poses go into the `…LipsyncPoseOutput` tracks; `lipSyncEnvelope` and `muzzleLips` fade in over 0.4 s and out over 0.5 s; `jaliJaw`/`jaliLips` carry smoothed JA/LI; each override weight mutes its pose by the lip-sync value (and the lip-corner family by at least half the envelope, as vanilla clips do); loud vowels lift the brows a little. Output: additive values per frame at 30 fps, `AdditiveFromRefPose`, as vanilla lip-sync clips are.
4. **Measure.** Solve every frame, pose the joints, and measure the lip gap (the two middle upper/lower lip joint pairs), the mouth width (corner joints) and the jaw joint's rotation, relative to rest; the same for the vanilla clips.

```text
python tools/memory_guard.py --limit 2 -- python experiments/027-lipsync-poc/lipsync_poc.py \
  --wav <line.wav> --phones <rhubarb debug log> [--vanilla <v.anims.json> --clip f_142541A57329F000]
```

Peak memory 0.7 GB; about 12 s, almost all of it the per-frame Python solve of both clips.

## Results

| Measure (relative to rest) | Generated | Vanilla `f_142541A57329F000` (3.9 s) | Vanilla `m_142534CFEA29F000` (4.67 s) |
|---|---|---|---|
| Animated tracks | 58 | — | — |
| Lip gap, median / 90th percentile while open | 4.3 / 10.7 mm | 4.0 / 8.4 mm | 5.0 / 9.1 mm |
| Lip gap, maximum | 14.8 mm | 11.4 mm | 11.1 mm |
| Mouth width change | −14.3 to +8.6 mm | −12.0 to +10.6 mm | −5.1 to +9.8 mm |
| Jaw joint rotation, maximum | 10.0° | 6.6° | 10.0° |
| Lip gap at the middle of each of the 3 bilabials | 0.11, 0.16, 0.24 mm | — | — |

Two tuning passes were needed: the first jaw scale opened the mouth to 22.8 mm (twice vanilla), and without corner-up in the spread visemes the mouth barely widened (+3 mm against vanilla's +10 mm).

**Reading.** The generated clip moves the solved face through the same ranges as the game's own clips, and closes the lips on bilabials. This supports the design's claim that JALI-style curves over the game's own lip-sync channel are reachable with open tools [offline]. It says nothing yet about how natural the motion looks, and nothing about the game.

## Limits

- One synthetic voice, one line, English only; Rhubarb's recogniser is English-only (its phonetic mode is language-independent but coarser).
- The metrics are joint distances, not mesh or visual checks. The motion has not been watched: the Studio can play baked clips and still expressions but has no player for an arbitrary track clip yet (phase 1 of the design).
- No lexical stress, pitch or word prominence; no tongue or throat detail beyond the viseme table; symmetric.
- Solved with the female basehead setup, while the vanilla clips are authored against the male player skeleton and V's face rig names the male player setup ([facial expressions](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)).
- Outputs (`generated/`: the clip as JSON, per-frame metrics, the report) are ignored and stay local.
