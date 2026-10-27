/** The real makeup adapter with its real registered codec, for fixtures that used its former defaults. */
export * from "../../src/app/authoring/makeup-document";
import { AuthoringDocument as MakeupDocument, type DocumentState, type DocumentParts, type DocumentHistoryOptions } from "../../src/app/authoring/makeup-document";
import { EYE_MAKEUP } from "../../src/features/eye-makeup";
import { RECIPE_HISTORY } from "../../src/legacy/eye-makeup/editor-actions";

export class AuthoringDocument extends MakeupDocument {
  constructor(initial: DocumentState, parts: Omit<DocumentParts, "module"> = RECIPE_HISTORY, options: DocumentHistoryOptions = {}) {
    super(initial, { ...parts, module: EYE_MAKEUP }, options);
  }
}
