/**
 * The Save Explorer's default layouts (profiles design §4.2; experiment 044 decision M1): read-only data, offered in New tab ▸ under the module.
 * Arranged in the Studio and printed by the verification-only command `xfStudioTabAsDefault`; replace it the same way. The composition
 * checks it against the panels and view tools the build has (`compose/layout-defaults.ts`).
 */
import type { DefaultLayoutContribution } from "../../platform/api";

export const SAVE_EXPLORER_DEFAULTS: readonly DefaultLayoutContribution[] = [{
  "id": "default",
  "name": "Save Explorer",
  "description": "The Save Explorer on its own, to look inside your saves.",
  "fragment": {
    "schema": "xfs/layout-fragment-1",
    "tab": {
      "name": "Save Explorer",
      "dock": {
        "format": "xfs/dock",
        "version": 1,
        "state": {
          "wide": {
            "floating": [],
            "root": {"kind":"group","id":"g-saves","panels":["save-explorer.explorer"],"active":"save-explorer.explorer"},
            "closed": ["activity","settings","help"]
          },
          "compact": {
            "floating": [],
            "root": {"kind":"group","id":"g-saves","panels":["save-explorer.explorer"],"active":"save-explorer.explorer"},
            "closed": ["activity","settings","help"]
          }
        }
      }
    },
    "subjects": [],
    "looks": [],
    "nodes": [],
    "views": [],
    "panels": [
      {"key":"save-explorer.explorer","type":"save-explorer.explorer"},
      {"key":"activity","type":"activity"},
      {"key":"settings","type":"settings"},
      {"key":"help","type":"help"}
    ]
  }
}];
