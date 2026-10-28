import { readRecipe } from "../../legacy/eye-makeup/recipe-schema";
/** Transitional projection for the concrete makeup editor; the workspace owner stores registered feature data. */
import { emptyRecipe, type Recipe } from "../../engines/layered-makeup/recipe";
import type { FieldSelection } from "../../engines/layered-makeup/field-selection";
import type { GlitterChoices } from "../../engines/layered-makeup/glitter-model";
import type { DocumentState } from "../authoring/authoring-document";
import type { DocumentHistory } from "../authoring/makeup-document";
import type { Look, LookMemory, PartMemory } from "../../platform/api";
import type { NewerPolicy } from "../../platform/core/document";
import type { LiveFeatureState } from "../../platform/core/live-features";
import { freshWorkspace as fresh, parseWorkspace as parse, serializeWorkspace as serialize, loadWorkspace as load,
  type WorkspaceState as LookWorkspaceState, type LoadedWorkspace as LoadedLookWorkspace } from "./workspace-state";
import type { DocumentModel as LookDocumentModel, RestoreWarnings } from "./collection-workspace";
export * from "./workspace-state";
export * from "./collection-workspace";
export { emptyRecipe } from "../../engines/layered-makeup/recipe";
export type DocumentModel = LookDocumentModel & { readonly live: string };
export type EditorMemory = { active: number; selected: number; fieldSelection?: FieldSelection; history: DocumentHistory; historyTrimmed?: boolean };
export type WorkspaceState = Omit<LookWorkspaceState, "history" | "liveFeatures" | "featureMemory"> & {
  recipe: Recipe; active: number; selected: number; history: DocumentHistory; historyTrimmed?: boolean;
  fieldSelection: FieldSelection; glitterChoices: GlitterChoices; defaultStarter?: string;
  liveFeatures?: Record<string, LiveFeatureState>;
};
export type LoadedWorkspace = Omit<LoadedLookWorkspace, "state"> & { state: WorkspaceState };
function liveId(model: LookDocumentModel): string {
  if (!model.live || !model.parts.feature(model.live)) throw Error("This composition has no legacy makeup editor.");
  return model.live;
}
export const emptyMemory = (): EditorMemory => ({ active: 0, selected: 0, history: [] });

/** The live document's memory in a look's memory (defaults when the look has none); its history is the look's. */
export function liveMemory(memory: LookMemory | undefined, model: DocumentModel): EditorMemory {
  const entry = memory?.[liveId(model)] as PartMemory<{ active: number; selected: number; fieldSelection?: FieldSelection }> | undefined;
  const history = model.parts.lookHistory(memory);
  return { active: entry?.editor.active ?? 0, selected: entry?.editor.selected ?? 0, history,
    ...(history.trimmed ? { historyTrimmed: true } : {}),
    ...(entry?.editor.fieldSelection ? { fieldSelection: entry.editor.fieldSelection } : {}) };
}
/**
 * A look's memory with the live document's memory and the look's Undo history replaced; other
 * features' memory is kept. Whole recipes (the older form) become the look history here.
 */
export function withLiveMemory(memory: LookMemory | undefined, editor: EditorMemory, model: LookDocumentModel): LookMemory {
  const { active, selected, fieldSelection, history, historyTrimmed } = editor;
  const data = Array.isArray(history)
    ? model.parts.lookHistory({ [liveId(model)]: { editor: {}, history, ...(historyTrimmed ? { historyTrimmed: true as const } : {}) } })
    : historyTrimmed && !history.trimmed ? { ...history, trimmed: true as const } : history;
  return model.parts.withLookHistory({ ...memory, [liveId(model)]: { editor: { active, selected, ...(fieldSelection ? { fieldSelection } : {}) } } },
    data);
}
/** The live document's part of a look, or undefined when the look does not have one (or is locked: this build cannot read it). */
export function livePart(look: Pick<Look, "parts" | "locked"> | undefined, model: DocumentModel): Recipe | undefined {
  return look?.locked ? undefined : look?.parts[liveId(model)]?.body as Recipe | undefined;
}
/** A look's parts with the live document's part set; an empty recipe is not added to a look that had none. */
export function withLivePart(look: Look, recipe: Recipe, model: LookDocumentModel): Look["parts"] {
  const { parts } = model, live = liveId(model);
  if (!look.parts[live] && !recipe.layers.length) return look.parts;
  return { ...look.parts, [live]: parts.readPart(live, parts.envelope(live, recipe), false) };
}

/** Project only the old editor's fields; editor construction remains with CORE-03 slice 4. */
export function makeupLookState(state: DocumentState, model: DocumentModel) {
  const live = liveId(model), own = state.features?.[live], editor = own?.editor as Partial<EditorMemory> | undefined;
  const others = { ...state.features }; delete others[live];
  return { recipe: (own?.part as Recipe | undefined) ?? emptyRecipe(), active: editor?.active ?? 0, selected: editor?.selected ?? 0,
    fieldSelection: editor?.fieldSelection ?? {}, history: state.history ?? model.parts.lookHistory(undefined),
    ...(state.history?.trimmed ? { historyTrimmed: true } : {}),
    ...(Object.keys(others).length ? { liveFeatures: others } : {}), ...(state.locked ? { liveLocked: state.locked } : {}) };
}
/** The old editor's fields over the same look data. No recipe is manufactured by the workspace owner. */
export function makeupWorkspace(state: LookWorkspaceState, model: DocumentModel): WorkspaceState {
  const live = liveId(model), { liveFeatures, featureMemory, ...view } = state;
  const wide = { ...featureMemory }; const preferences = wide[live] as { choices?: GlitterChoices; defaultStarter?: string } | undefined; delete wide[live];
  const otherFeatures = { ...view.otherFeatures, ...(Object.keys(wide).length ? { features: wide } : {}) };
  return { ...view, ...makeupLookState({ features: liveFeatures, history: state.history, locked: state.liveLocked }, model),
    glitterChoices: preferences?.choices ?? {},
    ...(preferences?.defaultStarter !== undefined ? { defaultStarter: preferences.defaultStarter } : {}),
    ...(Object.keys(otherFeatures).length ? { otherFeatures } : {}) };
}
/** Accept released in-memory callers at the adapter boundary; the generic workspace never reads a recipe. */
export function lookWorkspace(state: WorkspaceState | LookWorkspaceState, model: LookDocumentModel): LookWorkspaceState {
  if (!("recipe" in state)) return state;
  const live = liveId(model), { recipe, active, selected, fieldSelection, glitterChoices, defaultStarter, liveFeatures, history,
    ...view } = state;
  const memory = withLiveMemory(undefined, { active, selected, fieldSelection, history, historyTrimmed: state.historyTrimmed }, model);
  return { ...view, history: model.parts.lookHistory(memory), liveFeatures: { ...liveFeatures,
    [live]: { part: recipe, editor: { active, selected, fieldSelection } } },
    featureMemory: { ...state.otherFeatures?.features, [live]: { choices: glitterChoices, ...(defaultStarter === undefined ? {} : { defaultStarter }) } } };
}
export function freshWorkspace(recipe: Recipe): WorkspaceState {
  const base = fresh();
  return { ...base, recipe, active: 0, selected: 0, fieldSelection: {}, glitterChoices: {} };
}
export function parseWorkspace(value: unknown, model: DocumentModel, warnings?: RestoreWarnings, newer: NewerPolicy = "refuse"): WorkspaceState {
  return makeupWorkspace(parse(value, model, warnings, newer), model);
}
export function loadWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, model: DocumentModel): LoadedWorkspace {
  const result = load(storage, verification, model);
  return { ...result, state: makeupWorkspace(result.state, model) };
}
/** Released startup defaults projected back onto the neutral workspace, without another owner. */
export function loadLookWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, model: DocumentModel): LoadedLookWorkspace {
  const result = loadWorkspace(storage, verification, model);
  return { ...result, state: lookWorkspace(result.state, model) };
}
export function serializeWorkspace(state: WorkspaceState, model: DocumentModel, options: { lookLevel?: boolean } = {}) {
  return serialize(lookWorkspace(state, model), model, options);
}

/** Compatibility callers edit the primary part through their recipe field; these are only the other parts. */
export function liveFeatureStates(look: Pick<Look, "parts"> | undefined, memory: LookMemory | undefined,
  model: DocumentModel): Record<string, LiveFeatureState> | undefined {
  const others = model.parts.features().filter(feature => feature !== model.live);
  if (!others.length) return undefined;
  // Sparse: a feature the look lacks and has no memory of adds nothing, so a workspace that never used a second feature reads
  // exactly as it did while eye makeup was alone.
  const states = others.flatMap(feature => {
    const part = look ? model.parts.part(look, feature) : undefined;
    if (part === undefined && !memory?.[feature]) return [];
    return [[feature, { ...(part === undefined ? {} : { part: structuredClone(part) }),
      ...(memory?.[feature] ? { editor: structuredClone(memory[feature].editor) } : {}) }] as const];
  });
  return states.length ? Object.fromEntries(states) : undefined;
}
/**
 * `look` and its memory with the other live features' state written back: a part is set (or removed
 * when the feature's document has none), and its editor memory replaces the stored one; a feature whose
 * document is empty and that the look never had stays absent (looks are sparse).
 */
export function withLiveFeatures(look: Look, memory: LookMemory, states: Readonly<Record<string, LiveFeatureState>> | undefined,
  model: DocumentModel): { parts: Look["parts"]; memory: LookMemory } {
  // Live states are sparse (`LiveFeatures.export`): a registered feature missing from them is blank, so a part Undo removed goes too.
  const registered = model.parts.features().filter(feature => feature !== model.live);
  if (!states && !registered.length) return { parts: look.parts, memory };
  const parts = { ...look.parts }, next = { ...memory };
  for (const feature of new Set([...registered, ...Object.keys(states ?? {})])) {
    const state: LiveFeatureState = states?.[feature] ?? {};
    if (feature === model.live || !model.parts.feature(feature)) continue;
    if (state.part !== undefined) parts[feature] = model.parts.readPart(feature, model.parts.envelope(feature, state.part), false);
    else delete parts[feature];
    if ((state.part !== undefined || next[feature]) && "editor" in state) next[feature] = { ...next[feature], editor: structuredClone(state.editor) };
  }
  return { parts, memory: next };
}

/** Released callers may still supply a portable recipe; normalize it at the workspace boundary. */
export function makeupEditingState(workspace: WorkspaceState, composition: { documents: LookDocumentModel }) {
  const state = lookWorkspace({ ...workspace, recipe: readRecipe(workspace.recipe) }, composition.documents);
  return { features: state.liveFeatures, history: state.history, locked: state.liveLocked };
}
