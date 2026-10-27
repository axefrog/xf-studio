/** Module services use the same registry as families. Optional registrations are checked at call time, including captured facades. */
import { asyncActionTable, familyId, type AsyncSystemFamily } from "../api/feature";
import type { StudioModule, ModuleService } from "../api/module";
import type { ExperimentRegistration } from "../api/experiments";
import type { AnyOwner, Registry } from "./registry";
export function moduleActionOwner(module: StudioModule, experiment?: string) {
  return { owner: "system", async: true, id: familyId(module.id), label: module.label, module: module.id, experiment,
    actions: asyncActionTable(Object.fromEntries(Object.entries(module.actions ?? {}).map(([kind, descriptor]) => [kind,
      { ...descriptor, async: true as const, cancellable: false }]))) } satisfies AsyncSystemFamily & { module: string; experiment?: string };
}
export function liveModuleActions(base: Registry<AnyOwner>, source: { registrationGeneration(): number; registrations(): readonly ExperimentRegistration[]; onRegistrationsChanged(listener: () => void): () => void }) {
  let disposed = false;
  let generation = -1, lifetimes = new Map<string, { registration: ExperimentRegistration; token: object }>();
  const current = () => {
    if (disposed) return lifetimes;
    const next = source.registrationGeneration();
    if (next !== generation) {
      lifetimes = new Map(source.registrations().map(registration => {
        const old = lifetimes.get(registration.module.id);
        return [registration.module.id, old?.registration === registration ? old : { registration, token: {} }];
      }));
      generation = next;
    }
    return lifetimes;
  };
  // Observe every withdrawal, even when no captured facade is called while the module is off.
  const unsubscribe = source.onRegistrationsChanged(current);
  const registry = base.withLiveOwners({ generation: () => source.registrationGeneration(),
    owners: () => source.registrations().filter(r => r.module?.actions).map(r => moduleActionOwner(r.module, r.module.id)) });
  const bind = <F extends ModuleService>(service: F): F => {
    const lifetime = current().get(service.module)?.token;
    const allowed = (action: { kind: string }) => {
      const live = current().get(service.module);
      const route = registry.routeAsync(action.kind);
      return lifetime && live?.token === lifetime && live.registration.service === service && route.ok && route.owner.id === service.module ? service.capability(action)
        : { available: false as const, code: "unavailable" as const, reason: live
          ? `This ${service.module} registration has ended. Reopen the view to use it.`
          : `${service.module} is switched off. Turn the experiment on to use it.` };
    };
    return { ...service, capability: allowed, dispatch: async action => {
      const cap = allowed(action);
      return cap.available ? service.dispatch(action) : { ok: false, code: cap.code, message: cap.reason };
    } } as F;
  };
  return { registry, bind, dispose() { if (!disposed) { disposed = true; unsubscribe(); lifetimes.clear(); } } };
}
