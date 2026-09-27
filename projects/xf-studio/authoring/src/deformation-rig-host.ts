/**
 * The player puppet's deformation rigs, read from the game the way the game loads them (knowledge/body-animation.md §3): the
 * third-person player entity (`PLAYER_ENTITIES`, with every ArchiveXL patch that targets it) lists animated components; the ones whose
 * control binding names another animated component (`controlBinding.bindName`: `root`) take that component's pose and solve their own
 * joints with their own graph (`deformations`: the body's muscle, twist and corrective joints; `breasts`) [resource]. Each is compiled
 * into a program (deformation-rig.ts) from the winning rig and graph. Nothing is named but the player entity: a mod that patches the
 * entity or replaces a rig or graph is read by archive precedence like every other resource.
 */
import { compileDeformationRig, DeformationRigError, type DeformationProgram } from "./deformation-rig";
import { PLAYER_ENTITIES } from "./clothing-resolver";
import { refFromHash, refFromPath } from "./depot-path";
import { asArray, cname, depotRef, HandleScope, isObject, packageChunks, type JsonObject } from "./red-json";
import type { ResourceGraph } from "./resource-graph";
import type { BodyGender } from "./character-resolver";

export type PuppetRig = { component: string; program: DeformationProgram };
export type PuppetRigs = { rigs: PuppetRig[]; notes: string[] };

/** The entity's animated components: `{name, rig, graph, bindName}` in stored order (compiled data first, then inline components). */
export function animatedComponents(root: JsonObject): { name: string; rig: string | null; graph: string | null; bindsTo: string }[] {
  const scope = new HandleScope(root);
  // Compiled components dereference handles within their own package; inline ones within the template.
  const compiledScope = isObject(root.compiledData) && isObject(root.compiledData.Data) ? new HandleScope(root.compiledData.Data) : scope;
  const inline = asArray(root.components).map(item => scope.data(item)).filter((item): item is JsonObject => !!item);
  const out: { name: string; rig: string | null; graph: string | null; bindsTo: string }[] = [];
  const chunks = [...packageChunks(root.compiledData).map(chunk => ({ chunk, scope: compiledScope })), ...inline.map(chunk => ({ chunk, scope }))];
  for (const { chunk, scope: handles } of chunks) {
    if (chunk.$type !== "entAnimatedComponent") continue;
    // An inline copy may refer to a binding handle written first inside the compiled package.
    const binding = handles.data(chunk.controlBinding) ?? compiledScope.data(chunk.controlBinding);
    const path = (value: unknown) => { const ref = depotRef(value); return ref ? ref.path ?? ref.hash : null; };
    out.push({ name: cname(chunk.name), rig: path(chunk.rig), graph: path(chunk.graph), bindsTo: binding ? cname(binding.bindName) : "" });
  }
  return out;
}

const refOf = (text: string) => /^[0-9]+$/.test(text) ? refFromHash(text) : refFromPath(text);

/** Compile the deformation rigs of the player puppet for a body gender. Failures become plain notes, never errors. */
export async function puppetDeformationRigs(graph: ResourceGraph, gender: BodyGender, log?: (line: string) => void): Promise<PuppetRigs> {
  const notes: string[] = [];
  const ref = refFromPath(PLAYER_ENTITIES[gender]);
  const entity = await graph.load(ref, "ent");
  if (!entity) return { rigs: [], notes: ["The player entity couldn't be read, so the body's helper joints follow the limbs they sit on."] };
  const components = animatedComponents(entity.root);
  for (const patch of graph.patchesFor(ref.hash)) {
    const source = await graph.load(refFromHash(patch.source, patch.sourcePath), "ent");
    if (source) components.push(...animatedComponents(source.root));
  }
  // A later definition of a component (a patch) wins over an earlier one of the same name.
  const byName = new Map(components.map(component => [component.name, component]));
  const secondary = [...byName.values()].filter(component => component.rig && component.graph && component.bindsTo &&
    component.bindsTo !== component.name && byName.has(component.bindsTo));
  // A rig bound to another secondary rig (`breasts` to `deformations`) runs after it.
  const depth = (component: (typeof secondary)[number], seen = new Set<string>()): number => {
    const parent = secondary.find(other => other.name === component.bindsTo);
    if (!parent || seen.has(parent.name)) return 0;
    seen.add(component.name);
    return 1 + depth(parent, seen);
  };
  secondary.sort((a, b) => depth(a) - depth(b));
  const rigs: PuppetRig[] = [];
  for (const component of secondary) {
    if (!component.rig || !component.graph) continue;
    const [rig, animGraph] = await Promise.all([graph.load(refOf(component.rig), "rig"), graph.load(refOf(component.graph), "animgraph")]);
    if (!rig || !animGraph) { notes.push(`The player's ${component.name} rig couldn't be read, so the joints it solves follow the limbs they sit on.`); continue; }
    try {
      const program = compileDeformationRig(rig.root, animGraph.root, { rig: graph.named(refOf(component.rig)).path ?? component.rig,
        graph: graph.named(refOf(component.graph)).path ?? component.graph });
      rigs.push({ component: component.name, program });
      if (program.skipped.length) notes.push(`The player's ${component.name} rig uses parts XF Studio doesn't evaluate yet (${program.skipped.join(", ")}).`);
    } catch (error) {
      if (!(error instanceof DeformationRigError)) throw error;
      // The technical reason goes to the log; the note stays plain.
      log?.(`${component.name} rig: ${error.message}`);
      notes.push(`The player's ${component.name} rig isn't evaluated yet, so the joints only it moves hold the pose the body's animation and its other rigs give them.`);
    }
  }
  return { rigs, notes };
}
