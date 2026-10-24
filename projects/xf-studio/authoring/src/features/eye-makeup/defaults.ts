/**
 * Eye makeup's default layouts (profiles design §4.2; experiment 044 decision M1): read-only data, offered in New tab ▸ under the module.
 * Arranged in the Studio and printed by the verification-only command `xfStudioTabAsDefault`; replace it the same way. The composition
 * checks it against the panels and view tools the build has (`compose/layout-defaults.ts`).
 */
import type { DefaultLayoutContribution } from "../../platform/api";

export const EYE_MAKEUP_DEFAULTS: readonly DefaultLayoutContribution[] = [{
  "id": "default",
  "name": "Eye makeup",
  "description": "Your V in 3D beside the UV map, with the layers, presets and every makeup inspector.",
  "fragment": {
    "schema": "xfs/layout-fragment-1",
    "tab": {
      "name": "Eye makeup",
      "dock": {
        "format": "xfs/dock",
        "version": 1,
        "state": {
          "wide": {
            "floating": [],
            "root": {
              "kind": "split",
              "id": "s-root",
              "axis": "row",
              "children": [
                {
                  "kind": "split",
                  "id": "s-left",
                  "axis": "column",
                  "children": [
                    {"kind":"group","id":"g-collection","panels":["presets","library","package"],"active":"presets"},
                    {"kind":"group","id":"g-layers","panels":["layers","history"],"active":"layers"}
                  ],
                  "sizes": [0.4,0.6]
                },
                {"kind":"group","id":"g-head","panels":["view:view1"],"active":"view:view1"},
                {
                  "kind": "split",
                  "id": "s-right",
                  "axis": "column",
                  "children": [
                    {"kind":"group","id":"g-uv","panels":["uv"],"active":"uv"},
                    {
                      "kind": "group",
                      "id": "g-inspect",
                      "panels": ["finish","shape","edge","warp","character","lighting","motion","quality"],
                      "active": "finish"
                    }
                  ],
                  "sizes": [0.42,0.58]
                }
              ],
              "sizes": [0.21,0.37,0.42]
            },
            "closed": ["activity","settings","help"]
          },
          "compact": {
            "floating": [],
            "root": {
              "kind": "split",
              "id": "s-root",
              "axis": "column",
              "children": [
                {
                  "kind": "split",
                  "id": "s-stage",
                  "axis": "row",
                  "children": [
                    {"kind":"group","id":"g-head","panels":["view:view1"],"active":"view:view1"},
                    {"kind":"group","id":"g-uv","panels":["uv"],"active":"uv"}
                  ],
                  "sizes": [0.38,0.62]
                },
                {
                  "kind": "split",
                  "id": "s-lower",
                  "axis": "row",
                  "children": [
                    {"kind":"group","id":"g-stack","panels":["layers","history","presets","library","package"],"active":"layers"},
                    {
                      "kind": "group",
                      "id": "g-inspect",
                      "panels": ["finish","shape","edge","warp","character","lighting","motion","quality"],
                      "active": "finish"
                    }
                  ],
                  "sizes": [0.42,0.58]
                }
              ],
              "sizes": [0.56,0.44]
            },
            "closed": ["activity","settings","help"]
          }
        }
      }
    },
    "subjects": [{"key":"v1","kinds":["character"]}],
    "looks": [{"key":"look1"}],
    "nodes": [
      {
        "key": "scene1",
        "slot": "scene",
        "kind": "character",
        "state": {
          "eyeShape": 9,
          "normals": true,
          "motion": {"idle":false,"idleTime":0,"idlePaused":false,"idleBody":true,"idleFace":true,"blink":0,"blinkPlaying":false}
        },
        "subject": "v1",
        "look": "look1"
      },
      {"key":"camera1","slot":"camera","kind":"orbit","state":{}},
      {
        "key": "lights1",
        "slot": "lights",
        "kind": "studio",
        "state": {
          "setup": "soft",
          "setups": [],
          "creatorLighting": {"intensity":"isotropic","cone":"full","exposure":0.46},
          "exposure": 1.2,
          "lightAngle": 329,
          "studioLights": {"environment":1,"key":1,"elevation":21.52659393903945,"fill":1,"rim":0,"neutral":false}
        }
      },
      {"key":"display1","slot":"display","state":{"brows":true,"lashes":true,"hair":true,"piercings":true}},
      {"key":"tools1","slot":"tools","state":{"on":{"eye-makeup.surface":true,"eye-makeup.wire":false}}}
    ],
    "views": [{"key":"view1","scene":"scene1","camera":"camera1","lights":"lights1","display":"display1","tools":"tools1"}],
    "panels": [
      {"key":"presets","type":"presets"},
      {"key":"library","type":"library"},
      {"key":"package","type":"package"},
      {"key":"layers","type":"layers"},
      {"key":"history","type":"history"},
      {"key":"uv","type":"uv"},
      {"key":"finish","type":"finish"},
      {"key":"shape","type":"shape"},
      {"key":"edge","type":"edge"},
      {"key":"warp","type":"warp"},
      {"key":"character","type":"character"},
      {"key":"lighting","type":"lighting"},
      {"key":"motion","type":"motion"},
      {"key":"quality","type":"quality"},
      {"key":"activity","type":"activity"},
      {"key":"settings","type":"settings"},
      {"key":"help","type":"help"}
    ]
  }
}];
