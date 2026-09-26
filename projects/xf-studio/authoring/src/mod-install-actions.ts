/**
 * "Add to my mod manager" and "Show in folder" after Build (UI-82): the DOM-free application service a view drives through
 * `StudioPresentationPort.modInstall`. A view names a built mod by its product ID; the service finds that product's verified
 * build in the latest Build result and asks the host (mod-install-host.ts, `/api/mod-install`), which decides every path.
 *
 * - `modInstall.review` asks for the plan: exactly what would be added and where, or why it can't be now (read only).
 * - `modInstall.apply` is the person's consent to that reviewed plan: it sends the plan's token, and the host refuses when
 *   anything the plan named changed since (then the view reviews again). It is never dispatched without a review.
 * - `modInstall.reveal` opens the build's folder in the file manager, for installing it by hand.
 *
 * Nothing here changes a recipe, the library or Undo.
 */
import { refusal, type Capability } from "./platform/api";
import { MOD_INSTALL_DESCRIPTORS } from "./studio-action-descriptors";

export const MOD_INSTALL_PLAN = "xfs/mod-install-plan-1" as const;
export const MOD_INSTALL_RESULT = "xfs/mod-install-result-1" as const;
export type ModInstallRoute = "mo2" | "direct";
/** What the host's `install` would do, in plain words, and whether it can now (mod-install-host.ts). */
export type ModInstallPlan = {
  schema: typeof MOD_INSTALL_PLAN;
  candidateId: string;
  modName: string;
  route: ModInstallRoute;
  /** "Mod Organizer 2 (profile “Default”)" or "your game folder". */
  place: string;
  /** Each change, exactly as it would be made. */
  changes: string[];
  /** What to know first (an older version of this mod still switched on); never a condition. */
  notes: string[];
  /** Why it can't be done now, with the one next step; null when it can. Nothing is changed while it is set. */
  blocked: string | null;
  /** Whether this replaces the files XF Studio added for this mod before. */
  replacing: boolean;
  /** Ties consent to this plan: `install` refuses when anything named here changed since. */
  token: string;
};
export type ModInstallResult = { schema: typeof MOD_INSTALL_RESULT; candidateId: string; modName: string; route: ModInstallRoute;
  /** The plain outcome, and the next step (start the game from Mod Organizer 2). */
  message: string };

export type ModInstallAction = { kind: "modInstall.review"; product: string } | { kind: "modInstall.apply"; product: string } |
  { kind: "modInstall.reveal"; product: string };
/** One built mod of the latest Build: its product, its verified build (candidate) and name. */
export type BuiltMod = { product: string; candidateId: string; modName: string };
export type ModInstallState = {
  busy: { kind: ModInstallAction["kind"]; product: string } | null;
  /** The reviewed plan per product, for the build it was made for. */
  plans: Record<string, ModInstallPlan>;
  /** What happened last per product: added (with the host's plain message), or refused/failed (plain, with its code). */
  outcomes: Record<string, { ok: true; message: string; candidateId: string } | { ok: false; code: string; message: string; candidateId: string }>;
};
export type ModInstallOutcome = { ok: true; message: string } | { ok: false; code: string; message: string };
export type ModInstallTransport = (body: { action: "plan" | "install" | "reveal"; candidateId: string; token?: string }) =>
  Promise<{ ok: boolean; status: number; data: unknown }>;

const UNREACHABLE = "XF Studio couldn't reach its installer. Restart XF Studio and try again.";

export class ModInstallActions {
  private state: ModInstallState = { busy: null, plans: {}, outcomes: {} };
  private listeners = new Set<() => void>();
  /**
   * @param transport the host endpoint, or null where this host can't install (then every action says so).
   * @param builds the mods the latest Build made (the files service's current result).
   */
  constructor(private readonly transport: ModInstallTransport | null, private readonly builds: () => readonly BuiltMod[]) {}
  descriptors() { return structuredClone(MOD_INSTALL_DESCRIPTORS); }
  /** A detached copy; plans and outcomes for a build no longer current are left out. */
  snapshot(): Readonly<ModInstallState> {
    const current = new Map(this.builds().map(build => [build.product, build.candidateId]));
    const keep = <T extends { candidateId: string }>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([product, value]) => current.get(product) === value.candidateId));
    return structuredClone({ busy: this.state.busy, plans: keep(this.state.plans), outcomes: keep(this.state.outcomes) });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<ModInstallState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private build(product: string) { return this.builds().find(build => build.product === product); }

  capability(action: ModInstallAction): Capability {
    if (!(action?.kind in MOD_INSTALL_DESCRIPTORS)) return refusal("invalid_value", "Unknown command.");
    if (!this.transport) return refusal("unavailable", "Adding mods for you isn't available here. Show the mod's folder and copy it by hand.");
    const build = this.build(action.product);
    if (!build) return refusal("missing_target", "Build this mod first.");
    if (this.state.busy) return refusal("busy", this.state.busy.kind === "modInstall.apply" ? "A mod is being added. Wait for it to finish."
      : "XF Studio is checking where the mod would go. Wait a moment.");
    // One build is added once; Build again for a newer copy (Show in folder stays offered).
    const outcome = this.state.outcomes[action.product];
    if (action.kind !== "modInstall.reveal" && outcome?.ok && outcome.candidateId === build.candidateId)
      return refusal("invalid_value", `${build.modName} is already added from this build. Build again to add a newer copy.`);
    if (action.kind === "modInstall.apply") {
      const plan = this.state.plans[action.product];
      if (!plan || plan.candidateId !== build.candidateId) return refusal("needs_input", "Review what will be added first.");
      if (plan.blocked) return refusal("unavailable", plan.blocked);
    }
    return { available: true };
  }

  async dispatch(action: ModInstallAction): Promise<ModInstallOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
    const build = this.build(action.product)!;
    this.publish({ busy: { kind: action.kind, product: action.product } });
    const outcomes = () => ({ ...this.state.outcomes });
    try {
      if (action.kind === "modInstall.review") {
        const answer = await this.transport!({ action: "plan", candidateId: build.candidateId });
        const plan = answer.data as ModInstallPlan;
        if (!answer.ok || plan?.schema !== MOD_INSTALL_PLAN || plan.candidateId !== build.candidateId) return this.fail(action.product, build.candidateId, answer);
        this.publish({ busy: null, plans: { ...this.state.plans, [action.product]: plan } });
        return { ok: true, message: plan.blocked ?? "" };
      }
      if (action.kind === "modInstall.reveal") {
        const answer = await this.transport!({ action: "reveal", candidateId: build.candidateId });
        if (!answer.ok) return this.fail(action.product, build.candidateId, answer, false);
        this.publish({ busy: null });
        return { ok: true, message: "" };
      }
      const plan = this.state.plans[action.product]!;
      const answer = await this.transport!({ action: "install", candidateId: build.candidateId, token: plan.token });
      const done = answer.data as ModInstallResult;
      if (!answer.ok || done?.schema !== MOD_INSTALL_RESULT) {
        // A plan that no longer matches is dropped, so the view reviews again before another try.
        const code = (answer.data as { code?: string } | null)?.code;
        if (code === "stale_plan") { const plans = { ...this.state.plans }; delete plans[action.product]; this.state = { ...this.state, plans }; }
        return this.fail(action.product, build.candidateId, answer);
      }
      this.publish({ busy: null, outcomes: { ...outcomes(), [action.product]: { ok: true, message: done.message, candidateId: build.candidateId } } });
      return { ok: true, message: done.message };
    } catch {
      this.publish({ busy: null, outcomes: { ...outcomes(), [action.product]: { ok: false, code: "transport", message: UNREACHABLE, candidateId: build.candidateId } } });
      return { ok: false, code: "transport", message: UNREACHABLE };
    }
  }

  private fail(product: string, candidateId: string, answer: { data: unknown }, record = true): ModInstallOutcome {
    const data = answer.data as { code?: unknown; error?: unknown } | null;
    const code = typeof data?.code === "string" ? data.code : "install_failed";
    const message = typeof data?.error === "string" ? data.error : "XF Studio couldn't add this mod, so nothing was changed. Try again.";
    this.publish({ busy: null, ...(record ? { outcomes: { ...this.state.outcomes, [product]: { ok: false, code, message, candidateId } } } : {}) });
    return { ok: false, code, message };
  }
}

/**
 * The mods the latest Build made, from the files service's result (`package` of kind `packageBuild`): each product's ID, its
 * verified build's candidate ID (the folder name the host gave it) and its mod name. None after a Check or before any Build.
 */
export function builtModsOf(result: { kind: string; result: { products: readonly { productId: string; modName: string; package?: string }[] } } | undefined): BuiltMod[] {
  if (result?.kind !== "packageBuild") return [];
  return result.result.products.flatMap(product => {
    const candidateId = product.package?.split(/[\\/]/).filter(Boolean).at(-1);
    return candidateId ? [{ product: product.productId, candidateId, modName: product.modName }] : [];
  });
}
