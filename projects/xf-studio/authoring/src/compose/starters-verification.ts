/** Visual specimens for the starter menu, installed only in the isolated ?verify=1 workspace. They use the real owner and its commands. */
import type { ShapeStarters } from "../app/starters/shape-starters";
import { STARTER_DOCUMENT } from "../app/starters/shape-starters";
import type { DocumentOutbox } from "../platform/core/document-outbox";

/**
 * Own starters for the menu captures: one with a name long enough to wrap in a narrow menu (it becomes the default, so the Default
 * mark sits on a long row), and two with the same name saved in different minutes (the menu then tells them apart by when each was saved).
 * Every shape is one of the contributed ones, saved through the owner as a person's Save shape as starter would.
 */
export function startersFixtures(starters: ShapeStarters, outbox: DocumentOutbox, base = 1_800_000_000_000) {
  const shapeOf = (id: string) => starters.shapeOf(id)!;
  const made: string[] = [];
  const save = (name: string, shape: string, seconds: number) => {
    const result = starters.dispatch({ kind: "create", name, shape: shapeOf(shape) });
    if (!result.ok) throw Error("The capture starter couldn't be saved.");
    const ref = { kind: STARTER_DOCUMENT, id: result.id }, value = outbox.document(ref)!.value as Record<string, unknown>;
    outbox.commit("starters.capture-time", [{ ...ref, value: { ...value, createdAt: base + seconds * 1000, savedAt: base + seconds * 1000 } }]);
    made.push(result.id);
  };
  save("Evening wing with a long name that wraps in a narrow menu", "classic-wing", 5);
  save("Soft smudge", "lower-lash-smudge", 25);
  save("Soft smudge", "lower-lash-smudge", 85);
  starters.setDefault(made[0]!);
  return made;
}
