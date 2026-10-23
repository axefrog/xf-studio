/**
 * The library's immutable, content-addressed document kinds (profiles design §2.2): written once, each by its own command, and never
 * removed by a conflict's resolution. Decoded saves now; later blob kinds join here.
 */
import { SAVED_V_DOCUMENT } from "../character/character-document";

export const IMMUTABLE_DOCUMENT_KINDS: ReadonlySet<string> = new Set([SAVED_V_DOCUMENT]);
export const immutableDocumentKind = (kind: string) => IMMUTABLE_DOCUMENT_KINDS.has(kind);
