import type { Layer2 } from './layer2.ts';
import { actingArgument } from './pattern-lint.ts';

/** S1 owns known agent roles; new pack kinds declare theirs through function fills. */
export function agentRoles(l2: Layer2, kind: string): string[] {
  const registered = l2.worldRegistry.agentRoles?.(kind) ?? [];
  if (registered.length) return registered;
  const declared = (l2.k.eventKinds.eventKind(kind)?.fills ?? []).flatMap((f) => {
    const arg = actingArgument({ fn: f.fn, args: {} }, l2.reg.vocabulary ?? { functions: {}, relations: {}, tokenPrecedence: [] });
    return arg && f.args[arg] ? f.args[arg].split('|') : [];
  });
  return declared.length ? [...new Set(declared)] : ['actor', 'protagonist', 'promiser'];
}
