/**
 * The engine's type list the Studio ships (`rtti-subset.json`, from the RTTI dump), as a type oracle source
 * (engines/red-object/type-oracle.ts): every enum and bitfield name, the sliced classes and their property names. Pure data; the
 * composition hands it to the save explorer and the save reader, so the engines never import the dump themselves.
 */
import type { EngineTypes } from "../engines/red-object/type-oracle";
import subset from "./rtti-subset.json";

type ClassRow = [parent: string, props: [name: string, type: string][]];

let memo: EngineTypes | undefined;
/** The shipped engine type list (built once). */
export function engineTypes(): EngineTypes {
  if (memo) return memo;
  const classes = subset.classes as unknown as Record<string, ClassRow>;
  const properties = new Set<string>();
  for (const row of Object.values(classes)) for (const [name] of row[1]) properties.add(name);
  memo = Object.freeze({ enums: Object.freeze(Object.keys(subset.enums)), bitfields: Object.freeze(Object.keys(subset.bitfields)),
    classes: Object.freeze(Object.keys(classes)), properties: Object.freeze([...properties]) });
  return memo;
}
