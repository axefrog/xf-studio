/**
 * The Expressions module's default layouts (profiles design §4.2; experiment 044 decision M1): read-only data, offered in New tab ▸ under the module.
 * Arranged in the Studio and printed by the verification-only command `xfStudioTabAsDefault`; replace it the same way. The composition
 * checks it against the panels and view tools the build has (`compose/layout-defaults.ts`).
 */
import type { DefaultLayoutContribution } from "../../platform/api";

export const EXPRESSIONS_DEFAULTS: readonly DefaultLayoutContribution[] = [{
  "id": "default",
  "name": "Expressions",
  "description": "Your V in 3D beside the expression controls and your expression sets.",
  "fragment": {
    "schema": "xfs/layout-fragment-1",
    "tab": {
      "name": "Expressions",
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
                {"kind":"group","id":"g-head","panels":["view:view1"],"active":"view:view1"},
                {"kind":"group","id":"g-expressions","panels":["expressions.controls","expressions.sets"],"active":"expressions.controls"}
              ],
              "sizes": [0.55,0.45]
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
                {"kind":"group","id":"g-head","panels":["view:view1"],"active":"view:view1"},
                {"kind":"group","id":"g-expressions","panels":["expressions.controls","expressions.sets"],"active":"expressions.controls"}
              ],
              "sizes": [0.55,0.45]
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
      {"key":"tools1","slot":"tools","state":{"on":{"eye-makeup.surface":false,"eye-makeup.wire":false}}}
    ],
    "views": [{"key":"view1","scene":"scene1","camera":"camera1","lights":"lights1","display":"display1","tools":"tools1"}],
    "panels": [
      {"key":"expressions.controls","type":"expressions.controls"},
      {"key":"expressions.sets","type":"expressions.sets"},
      {"key":"activity","type":"activity"},
      {"key":"settings","type":"settings"},
      {"key":"help","type":"help"}
    ]
  }
}];
