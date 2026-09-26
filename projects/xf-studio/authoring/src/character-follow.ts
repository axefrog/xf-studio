/**
 * Keeps the preview's shown V following the character context (browser-head-attachment.ts wires it): the resolved details are asked
 * for only when the context's request changes, never again for the same one (a failed V waits for `character.retry`; PREV-86), and
 * the head's facial shape follows the context's view once that view answers the current state.
 *
 * The saved-V service also writes the face (it applies a save's shape, or clears it for the default V). Whenever it changes the scene,
 * the view's shape is written again on top, so the context's view stays the one last writer of the face (PREV-87). DOM-free.
 */
import type { CharacterRequest } from "./character-detail-request";
import type { CreatorView } from "./cc-panel";

export type CharacterFollowPorts = {
  context: { detailRequest(): CharacterRequest; view(): Readonly<CreatorView> | null; viewCurrent(): boolean; subscribe(listener: () => void): () => void };
  details: { setCharacter(request: CharacterRequest): Promise<void> };
  /** The saved-V service: it changed the scene (a save applied or cleared). */
  savedV: { subscribe(listener: () => void): () => void };
  setFaceMorphs(morphs: readonly { region: string; target: string }[]): void;
};

/** Start following; returns the release. Follows once at once. */
export function followCharacter(ports: CharacterFollowPorts): () => void {
  let asked = "", faces = "";
  const shape = () => {
    const view = ports.context.view();
    if (!view || view.bodyGender !== "female" || !ports.context.viewCurrent()) return;
    const key = JSON.stringify(view.faceMorphs);
    if (key === faces) return;
    faces = key;
    ports.setFaceMorphs(view.faceMorphs);
  };
  const follow = () => {
    const request = ports.context.detailRequest(), key = JSON.stringify(request);
    if (key !== asked) { asked = key; void ports.details.setCharacter(request); }
    shape();
  };
  // The saved-V service wrote the face: what the view says goes on top again.
  const rewrite = () => { faces = ""; shape(); };
  const releases = [ports.context.subscribe(follow), ports.savedV.subscribe(rewrite)];
  follow();
  return () => { for (const release of releases.splice(0)) release(); };
}
