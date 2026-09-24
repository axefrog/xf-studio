# XF Studio

**Make Cyberpunk 2077 your own.** XF Studio is a project for authoring and customizing the game, beginning with your own V and growing toward other parts of the game over time. Eye makeup is the first working feature, not the limit of the studio. Today you can draw layered makeup directly on a character's face, tune colour and finish, arrange complete presets, and save them in a local library. The goal for this first feature is to bring an authored collection into the game through one eye-makeup selector.

The current eye-makeup editor is a working prototype. It supports head and UV editing, Bézier and softness controls, whole-shape and warp adjustments, a deforming preview, saved-character import, recipe and collection files, and PNG mask export. Its browser finish previews include experimental looks; they are not all game materials. **Check mod export** reports unsupported active details before packaging. **Build mod files** can produce a private, independently verified candidate from the supported content, currently Matte, Satin and Metallic. A private diagnostic package is installed in a new MO2 profile but has not been launched or verified in the game. There is no public release or installed desktop trial yet. See [current state](docs/status.md) and the [collection-to-mod guide](research/authoring/studio-to-mod-pipeline.md) for the precise boundaries.

## Try the local editor

The editor needs [Bun](https://bun.sh/) and locally prepared Cyberpunk 2077 assets. The repository intentionally excludes game files, extracted mod resources, personal saves, databases and credentials, so a fresh clone alone cannot show the full character preview. Follow the [asset intake and setup notes](projects/xf-studio/authoring/README.md#actual-asset-intake), then from `projects/xf-studio/authoring` run:

```powershell
bun install --frozen-lockfile
bun start
```

Open [127.0.0.1:4317](http://127.0.0.1:4317/) while the server runs. The [editor guide](projects/xf-studio/authoring/README.md#use) covers controls, local storage and verification. Work with a separate `?verify=1` browser workspace when testing changes to avoid touching an active draft.

## Projects

| Project | Where it stands |
|---|---|
| [XF Studio](projects/xf-studio/README.md) | Broad Cyberpunk authoring vision, starting with eye-makeup creation for V. Further character and game areas are future work to define one feature at a time. |
| [Photo Mode Tools](projects/xf-photo-mode-tools/README.md) | Independent peer project. Its clean implementation is still at the research stage. |

The repository also keeps [focused experiments](experiments/), [source-grounded research](research/) and [validation notes](docs/validation.md) beside the projects. [Community credits](docs/community-credits.md) record what we learned from other creators and the boundaries on reuse. Contributors can start with the [developer orientation](docs/developer-orientation.md) and [working rules](AGENTS.md).

XF Studio was previously called XF Appearance Studio and XF Eye Artistry. The project now lives at `projects/xf-studio`; older data identifiers remain for compatibility. [The naming contract](projects/xf-studio/data/naming.md) explains which new resources use `xfs_`.
