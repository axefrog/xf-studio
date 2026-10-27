/** Only each layer's own keys: Holotable caps this map at 16 entries. */
const keys: Record<string, string[]> = {
  places: ['mood', "who's here", 'refuge', 'about'],
  detail: [], people: ['doing', 'wants', 'planning', 'believes', 'with', 'who', 'about'],
  groups: ['leaders', 'intends', 'keeping to its rules', 'wants'], items: ['holder'],
  ties: ['strength'], events: ['what happened', 'who', 'placement'], beliefs: ['belief'],
  stories: ['now', 'so far', 'could go', 'kind', 'thread'], director: ['decision', 'story', 'checks', 'score'],
  intentions: ['stage', 'warned', 'why'], placement: ['stage', 'staging'],
};
export function facetTitles(layer: string): Record<string, string> {
  return Object.fromEntries((keys[layer.startsWith('people-') ? 'people' : layer] ?? []).map((k) => [k, k[0].toUpperCase() + k.slice(1)]));
}
