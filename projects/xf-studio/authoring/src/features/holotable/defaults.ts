/**
 * The Holotable module's default layout (profiles design §4.2): read-only data, offered in New tab ▸ under the module while its
 * experiment is on (compose/layout-defaults.ts `studioLayoutDefaults`). Recordings, the replay and its details side by side; no 3D view
 * of V, so the fragment holds no graph nodes.
 */
import type { DefaultLayoutContribution } from "../../platform/api";

export const HOLOTABLE_DEFAULTS: readonly DefaultLayoutContribution[] = [{
  "id": "default",
  "name": "Holotable",
  "description": "Recordings, the replay over Night City, and what it shows.",
  "fragment": {
    "schema": "xfs/layout-fragment-1",
    "tab": {
      "name": "Holotable",
      "dock": {
        "format": "xfs/dock",
        "version": 1,
        "state": {
          "wide": {
            "floating": [],
            "root": {
              "kind": "split", "id": "s-root", "axis": "row",
              "children": [
                { "kind": "group", "id": "g-recordings", "panels": ["holotable.recordings"], "active": "holotable.recordings" },
                { "kind": "group", "id": "g-view", "panels": ["holotable.view"], "active": "holotable.view" },
                { "kind": "group", "id": "g-details", "panels": ["holotable.details"], "active": "holotable.details" }
              ],
              "sizes": [0.2, 0.56, 0.24]
            },
            "closed": ["activity", "settings", "help"]
          },
          "compact": {
            "floating": [],
            "root": {
              "kind": "split", "id": "s-root", "axis": "column",
              "children": [
                { "kind": "group", "id": "g-view", "panels": ["holotable.view"], "active": "holotable.view" },
                { "kind": "group", "id": "g-side", "panels": ["holotable.recordings", "holotable.details"], "active": "holotable.recordings" }
              ],
              "sizes": [0.62, 0.38]
            },
            "closed": ["activity", "settings", "help"]
          }
        }
      }
    },
    "subjects": [],
    "looks": [],
    "nodes": [],
    "views": [],
    "panels": [
      { "key": "holotable.recordings", "type": "holotable.recordings" },
      { "key": "holotable.view", "type": "holotable.view" },
      { "key": "holotable.details", "type": "holotable.details" },
      { "key": "activity", "type": "activity" },
      { "key": "settings", "type": "settings" },
      { "key": "help", "type": "help" }
    ]
  }
}];
