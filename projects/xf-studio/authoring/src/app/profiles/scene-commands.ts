/**
 * What a scene shows (profiles design §1.1, §3.6): `scene.setLook` and `scene.setSubject`, each naming the scene and the `gen` it was
 * resolved at, so a choice made from a stale menu never lands on a scene that shows something else meanwhile. The session holds what each
 * scene shows (`ProfileSessionState`); this applies the two actions over it, once the application has checked the scene and `gen` they name. Choosing a preset is `scene.setLook` (it replaced
 * `preset.select`); `look: null` shows no look.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import type { SubjectRef } from "../../platform/api/subjects";
import type { LookRef } from "../../library/collection-documents";

export type SceneAction =
  | { kind: "scene.setLook"; scene: string; sceneGen: number; look: LookRef | null }
  | { kind: "scene.setSubject"; scene: string; sceneGen: number; subject: SubjectRef | null };

/** The scenes a session holds: what each shows and its `gen`, and showing another look or subject (raising `gen`). */
export type ScenesPort = {
  scene(id: string): { readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number } | undefined;
  setLook(scene: string, look: LookRef | undefined): void;
  setSubject(scene: string, subject: SubjectRef | undefined): void;
};

export class SceneCommands {
  constructor(private readonly scenes: ScenesPort, private readonly exists: { look(ref: LookRef): boolean; subject(ref: SubjectRef): boolean }) {}
  /** A scene's `gen`, which a view action editing the scene names (undefined: the session has no such scene). */
  gen(scene: string): number | undefined { return this.scenes.scene(scene)?.gen; }
  capability(action: SceneAction): Capability {
    const scene = this.scenes.scene(action.scene);
    // Its `gen` is checked where every named target is (the application's check, the same rule as a capture's).
    if (!scene) return refusal("missing_target", "That scene is gone.");
    if (action.kind === "scene.setLook") {
      const look = action.look;
      if (look !== null && (typeof look !== "object" || typeof look.collection !== "string" || typeof look.look !== "string"))
        return refusal("invalid_value", "Choose a look.");
      if (look && !this.exists.look(look)) return refusal("missing_target", "That preset no longer exists.");
      return { available: true };
    }
    const subject = action.subject;
    if (subject !== null && (typeof subject !== "object" || typeof subject.kind !== "string" || typeof subject.id !== "string"))
      return refusal("invalid_value", "Choose a V.");
    if (subject && !this.exists.subject(subject)) return refusal("missing_target", "That V was deleted.");
    return { available: true };
  }
  dispatch(action: SceneAction): undefined {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (action.kind === "scene.setLook") this.scenes.setLook(action.scene, action.look ?? undefined);
    else this.scenes.setSubject(action.scene, action.subject ?? undefined);
    return undefined;
  }
}
