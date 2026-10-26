# ST8 capture investigation

26 October 2026. Summary of the ST8 rerun's saved captures, telemetry and
plugin/CET logs, compared with the earlier styling run. No game was launched
for this investigation. Private evidence locations and identifiers are omitted.

## What the evidence establishes

- **[runtime] Both runs enabled the native overlay at load.** Earlier ST8's
  `overlay-state.json` and the rerun's snapshots say `enabled_at_load:true`,
  `enabled:false`, `switched_off:true`. The rerun's plugin config agrees.
  Loading with the overlay disabled is not the distinction between these runs.
- **[runtime + source] The row setup selects the CET line correctly.** The rows
  switch the XF box off live and call `ui.hud {show:false,cet_label:true}`.
  Their `is-line` / `is-paused` checks passed. The ink panel takes precedence,
  then a drawable XF box, then the CET line (`ChooseStatusSurface`,
  `native/src/core/InkUi.cpp`). The telemetry snapshots collected after row
  cleanup can say `status_surface:ink_panel`: cleanup resets the HUD. They
  must not replace the checks taken before the probes.
- **[runtime] Lua did submit the line.** ST8-dark-auto's catch-up includes
  repeated `ui.consumer` records with
  `drawn:true`, `surface:cet_line`, heading “XF Runtime Bridge · XF Studio
  connected · changes allowed”, rectangle `[12,12,597,86]`. Earlier records
  include the transitions through `drawn:false` while surfaces settle.
  Connected and paused rows also carry positive CET-line draw receipts.
  `cet_panel.surface` is the last body drawn, not a GPU read-back.
- **[runtime] The saved probes contain scene pixels, not the line.** All use
  `printwindow`; the first auto probe crops `[0,0,1333,237]`, enclosing the
  consumer rectangle. Visual inspection confirms no line in the crop. The
  approximately 12% plate-colour match is dark scene, with approximately zero
  Text-colour pixels. This is not evidence that the crop missed `[12,12]`.
  The detector correctly rejects these pictures; its whole-crop colour
  thresholds do not prove why a surface is absent.
- **[runtime] Focus changed, but does not explain all three failures.** All
  auto probes report `foreground:false`. All connected probes report true;
  paused starts true and becomes false. Thus focus alone is insufficient.
  The only CET open/close log events match ST13's deliberate key presses,
  between auto and connected. The
  ST8 `cet-closed` checks and overlay snapshots say false. No recorded CET
  open or lasting surface change ties the mouse bump after load to ST8.
  Camera motion cannot move a screen-space ImGui window. Ordinary mouse input
  is not exhaustively recorded, so its exact timing cannot be reconstructed.
- **[runtime] ST13's PASS stands within its scope.** It checks `cet_open`
  false/true/false, not line pixels. It uses the same live-disabled overlay
  host, which continues reporting CET state. The log confirms its transitions;
  PASS is not proof of rendered CET pixels or the omitted Reload all mods test.

## Change and remaining commissioning

**[source]** `cet/xf_runtime_bridge/init.lua` draws only when the bridge is
enabled, `cetLabel` is true, CET is closed, and the HUD frame names `cet_line`.
Its positive consumer receipt occurs after the body submits the text. No
bridge-side draw-rule failure or Lua error is established by this evidence.

**[inference]** The discrepancy lies after Lua submission, in rendering or
capture. PrintWindow's window image is insufficient evidence of this CET
surface; neither receipts nor saved pixels distinguish a missed GPU draw from
an omitted overlay in that image. The generator now explicitly requests the
screen route for CET-line probes, stills and bursts. `capture.surface` forwards
that route. The existing screen adapter refuses focus loss before or during a
grab, so background pictures cannot silently stand in for on-screen evidence.
The detector thresholds and surface precedence are unchanged.

A maintainer session must confirm the line in the displayed screen pixels,
with the game foreground throughout, and compare PrintWindow against screen
if the discrepancy persists. Until then this is an evidence-route correction,
not a claim that a GPU or CET rendering defect has been repaired.

Knowledge used: [ink UI](../../../knowledge/ink-ui.md),
[game lifecycle control](../../../knowledge/game-lifecycle-control.md).
