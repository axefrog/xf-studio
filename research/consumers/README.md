# CCXL consumer study

Three installed reference mods were selectively extracted and converted with WolvenKit CLI 8.17.4. Inputs stayed unchanged; raw resources and JSON are isolated here for research. [Structured inspection](inspection.json) records file types, counts and representative dynamic references. Extraction omitted textures and other irrelevant binary payloads.

| Consumer | Observed structure | What it proves / does not prove |
|---|---|---|
| Hair Profiles CCXL | 13 selected files; patch mesh with 45 appearances and 11 template entries; external material templates use `*...{material}.hp` and context base-material references; female and male CCXL registration | Real use of shared material templates, scopes/patches and explicit UI palette definitions. Does not prove arbitrary custom makeup switchers become context attributes. |
| Photoreal Eyes CCXL | 4 selected files; 32 appearance stubs, one `@eyes` material entry; template uses `Soft` `*...{material}_d.xbm` and `_n.xbm`; patches player eye scopes | Concrete 32-to-1 material-template reduction. Uses `eye.mt`, so it is not evidence that eye-makeup decal blend ordering works. |
| Heterochromia Eyes - CCXL | 8 selected files; male/female left/right `.app` variants with 2 definitions each and morph-skinned components; split-eye meshes have 107 appearances/108 entries | Independent component/selection routing reference; also shows a functioning consumer may still contain substantial static material enumeration. |

Photoreal Eyes appearance stubs include the `blood_gradient_black` expansion-source tag; compare the patch-mesh path with a standalone Eye Artistry mesh before copying conventions. Hair Profiles' `.xl` uses explicit `resource.patch` scopes and language resources.

Mod metadata/source archive paths and profile membership: [MO2 inventory](../../inventory/mo2-mods.json). These are third-party assets used locally for study. They are excluded from project releases; any later asset reuse needs an explicit provenance/license decision.

Tool lesson: WolvenKit's `convert serialize -o` requires the output directory to exist and can report an error without a useful nonzero exit status. Verify expected output files, not only the process exit code. Directory serialization flattens filenames into `-o`; isolate consumers and check duplicate basenames before using it on a larger source tree.
